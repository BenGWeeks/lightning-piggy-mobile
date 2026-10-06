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
