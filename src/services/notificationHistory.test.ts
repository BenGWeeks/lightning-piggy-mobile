import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recordNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeNotificationHistory,
  pruneHistory,
  MAX_ENTRIES,
  MAX_AGE_MS,
  __resetNotificationHistoryForTests,
  clearNotificationHistory,
  removeNotificationsWhere,
  type NotificationHistoryEntry,
} from './notificationHistory';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const T = Date.now();

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetNotificationHistoryForTests();
});

it('records newest first, per account, without a message body for DMs and groups', async () => {
  await recordNotification(
    A,
    { kind: 'dm', title: 'Little Piggy', body: 'secret text', data: { conversationPubkey: B } },
    T + 1000,
  );
  await recordNotification(
    A,
    { kind: 'payment', title: 'Payment received', body: '+21 sats' },
    T + 2000,
  );
  await recordNotification(
    B,
    { kind: 'group', title: 'Piggy Pals', body: 'group secret', data: { groupId: 'g1' } },
    T + 3000,
  );

  const a = await listNotifications(A);
  expect(a.map((e) => e.title)).toEqual(['Payment received', 'Little Piggy']);
  expect(a[0].body).toBe('+21 sats');
  expect(a[1].body).toBeUndefined();
  expect(JSON.stringify(a)).not.toContain('secret');
  expect(a.every((e) => !e.read)).toBe(true);

  const b = await listNotifications(B);
  expect(b).toHaveLength(1);
  expect(b[0].body).toBeUndefined();
});

it('is a no-op without an active account', async () => {
  await recordNotification(null, { kind: 'dm', title: 'x', body: 'y' });
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});

it('keeps concurrent records (serialised writes)', async () => {
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      recordNotification(A, { kind: 'zap', title: `z${i}`, body: '' }, T + i),
    ),
  );
  expect(await listNotifications(A)).toHaveLength(10);
});

it('marks one or all as read and notifies subscribers', async () => {
  await recordNotification(A, { kind: 'zap', title: 'one', body: '' }, T + 1000);
  await recordNotification(A, { kind: 'zap', title: 'two', body: '' }, T + 2000);
  const listener = jest.fn();
  const unsubscribe = subscribeNotificationHistory(listener);

  const [first] = await listNotifications(A);
  await markNotificationRead(A, first.id);
  expect((await listNotifications(A)).map((e) => e.read)).toEqual([true, false]);

  await markAllNotificationsRead(A);
  expect((await listNotifications(A)).every((e) => e.read)).toBe(true);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('drops entries older than 30 days and keeps at most 200', () => {
  const now = 10 * MAX_AGE_MS;
  const entry = (createdAt: number): NotificationHistoryEntry => ({
    id: String(createdAt),
    kind: 'zap',
    title: 't',
    data: {},
    createdAt,
    read: false,
  });
  const old = entry(now - MAX_AGE_MS - 1);
  const recent = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(now - i));
  const pruned = pruneHistory([old, ...recent], now);
  expect(pruned).toHaveLength(MAX_ENTRIES);
  expect(pruned).not.toContain(old);
  expect(pruned[0].createdAt).toBe(now);
});

it('ignores a retried notification with the same source key (#1143 review)', async () => {
  const payment = {
    kind: 'payment' as const,
    title: 'Payment received',
    body: '+21 sats',
    historyKey: 'payment:w1:abc',
  };
  await recordNotification(A, payment, T + 1);
  await recordNotification(A, payment, T + 2);
  await recordNotification(A, { ...payment, historyKey: 'payment:w1:def' }, T + 3);
  expect(await listNotifications(A)).toHaveLength(2);
});

it('clears an account through the write queue, so a pending record cannot recreate it', async () => {
  const pending = recordNotification(A, { kind: 'zap', title: 'late', body: '' }, T + 1);
  const cleared = clearNotificationHistory(A);
  await Promise.all([pending, cleared]);
  expect(await listNotifications(A)).toEqual([]);
});

describe('per-thread collapse (phantom bursts)', () => {
  const dm = (title: string, at: number) =>
    recordNotification(
      A,
      {
        kind: 'dm',
        title,
        body: 'x',
        data: { conversationPubkey: B },
        collapseKey: `dm:nip04:${B}`,
      },
      at,
    );

  it('updates the unread row of a thread instead of stacking one per message', async () => {
    const first = await dm('New message', T + 1000);
    const second = await dm('New message', T + 2000);
    const third = await dm('Nodie', T + 3000);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    const list = await listNotifications(A);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: first.id, title: 'Nodie', count: 3, createdAt: T + 3000 });
  });

  it('starts a new row once the thread row has been read', async () => {
    const first = await dm('New message', T + 1000);
    await markNotificationRead(A, first.id);
    const next = await dm('New message', T + 2000);
    expect(next.id).not.toBe(first.id);
    expect(await listNotifications(A)).toHaveLength(2);
  });

  it('never merges different threads, or rows without a collapse key', async () => {
    await dm('New message', T + 1000);
    await recordNotification(
      A,
      {
        kind: 'dm',
        title: 'Max',
        body: 'x',
        data: { conversationPubkey: 'c'.repeat(64) },
        collapseKey: 'dm:nip17:c',
      },
      T + 2000,
    );
    await recordNotification(A, { kind: 'dm', title: 'New message', body: 'x' }, T + 3000);
    await recordNotification(A, { kind: 'dm', title: 'New message', body: 'x' }, T + 4000);
    expect(await listNotifications(A)).toHaveLength(4);
  });
});

describe('removeNotificationsWhere', () => {
  it('removes only matching rows of that account and reports their ids', async () => {
    const { id } = await recordNotification(
      A,
      { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
      T + 1000,
    );
    await recordNotification(A, { kind: 'dm', title: 'Nodie', body: 'x' }, T + 2000);
    await recordNotification(
      B,
      { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
      T + 3000,
    );
    const removed = await removeNotificationsWhere(A, (e) => e.data.marmotPush === true);
    expect(removed).toEqual([id]);
    expect((await listNotifications(A)).map((e) => e.title)).toEqual(['Nodie']);
    expect(await listNotifications(B)).toHaveLength(1);
  });

  it('skips the write (and listener churn) when nothing matches', async () => {
    await recordNotification(A, { kind: 'dm', title: 'Nodie', body: 'x' }, T + 1000);
    const listener = jest.fn();
    subscribeNotificationHistory(listener);
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    const writesBefore = setItem.mock.calls.length;
    expect(await removeNotificationsWhere(A, () => false)).toEqual([]);
    expect(setItem.mock.calls.length).toBe(writesBefore);
    expect(listener).not.toHaveBeenCalled();
  });
});
