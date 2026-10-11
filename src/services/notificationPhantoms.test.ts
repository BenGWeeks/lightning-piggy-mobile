// Phantom / nameless "New message" alerts (#1279): per-thread collapse, push
// placeholders replaced (never lost), collapsed entries vs deletions. Split
// from notificationService.test.ts (file-size cap); same native mock.

const mockScheduleNotificationAsync = jest.fn().mockResolvedValue('notif-id');
const mockGetPresented = jest.fn().mockResolvedValue([]);
const mockDismiss = jest.fn().mockResolvedValue(undefined);
const mockGetScheduled = jest.fn().mockResolvedValue([]);
const mockCancel = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  getPresentedNotificationsAsync: () => mockGetPresented(),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getAllScheduledNotificationsAsync: () => mockGetScheduled(),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { SECRET: -1, PRIVATE: 0, PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { listNotifications, recordNotification } from './notificationHistory';
import {
  __resetForTests,
  dropMarmotPushAlerts,
  fireMessageNotification,
  notificationMatchesTarget,
  retractMarmotMessageNotifications,
  setNotificationsForeground,
  setActiveThread,
  threadCollapseKey,
} from './notificationService';

const lastScheduledContent = () => mockScheduleNotificationAsync.mock.calls.at(-1)?.[0]?.content;

beforeEach(async () => {
  mockScheduleNotificationAsync.mockClear();
  await AsyncStorage.clear();
  __resetForTests();
});

describe('phantom "New message" rows', () => {
  const OWNER = 'f'.repeat(64);
  const PEER = 'd'.repeat(64);

  it('keys message alerts by thread; generic pings and payments have no thread', () => {
    expect(
      threadCollapseKey('dm', {
        conversationPubkey: PEER.toUpperCase(),
        conversationProtocol: 'nip04',
      }),
    ).toBe(`dm:nip04:${PEER}`);
    expect(threadCollapseKey('dm', { conversationPubkey: PEER })).toBe(`dm:nip17:${PEER}`);
    expect(threadCollapseKey('group', { groupId: 'marmot:g' })).toBe('group:marmot:g');
    expect(threadCollapseKey('dm', { marmotPush: true })).toBeUndefined();
    expect(threadCollapseKey('dm', { wrapId: 'w' })).toBeUndefined();
    expect(threadCollapseKey('payment', { walletId: 'w' })).toBeUndefined();
  });

  it('a burst from one sender is one history row and one (replaced) tray entry', async () => {
    setNotificationsForeground(false);
    for (let i = 0; i < 3; i++) {
      await fireMessageNotification({
        owner: OWNER,
        kind: 'dm',
        threadId: PEER,
        title: 'New message',
        body: `m${i}`,
        data: { conversationPubkey: PEER, conversationProtocol: 'nip04' },
      });
    }
    const rows = await listNotifications(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
    const identifiers = mockScheduleNotificationAsync.mock.calls.map((c) => c[0].identifier);
    expect(identifiers).toEqual([rows[0].id, rows[0].id, rows[0].id]);
    expect(lastScheduledContent()?.data).toMatchObject({ historyId: rows[0].id });
  });

  it('matches a wrap alert and a set of history rows', () => {
    expect(notificationMatchesTarget({ wrapId: 'w1' }, { wrapId: 'w1' })).toBe(true);
    expect(notificationMatchesTarget({ wrapId: 'w2' }, { wrapId: 'w1' })).toBe(false);
    expect(notificationMatchesTarget({ historyId: 'h1' }, { historyIds: ['h0', 'h1'] })).toBe(true);
    expect(notificationMatchesTarget({}, { historyIds: ['h1'] })).toBe(false);
  });

  it('the real Marmot message replaces the generic push row in the history', async () => {
    setNotificationsForeground(false);
    await fireMessageNotification({
      owner: OWNER,
      kind: 'dm',
      threadId: '__push__',
      title: 'New message',
      body: 'x',
      data: { marmotPush: true },
    });
    expect(await listNotifications(OWNER)).toHaveLength(1);
    await fireMessageNotification({
      owner: OWNER,
      kind: 'dm',
      threadId: `marmot:${PEER}`,
      title: 'New message',
      body: 'hi',
      data: { conversationPubkey: PEER, conversationProtocol: 'marmot' },
    });
    await new Promise((r) => setTimeout(r, 0));
    await listNotifications(OWNER); // drains the history write queue
    const rows = await listNotifications(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ conversationPubkey: PEER });
  });

  it('a Marmot message shown on screen also clears the generic push row', async () => {
    await fireMessageNotification({
      owner: OWNER,
      kind: 'dm',
      threadId: '__push__',
      title: 'New message',
      body: 'x',
      data: { marmotPush: true },
    });
    setNotificationsForeground(true);
    setActiveThread('marmot-open');
    await fireMessageNotification({
      owner: OWNER,
      kind: 'dm',
      threadId: 'marmot-open',
      title: 'New message',
      body: 'hi',
      data: { conversationPubkey: PEER, conversationProtocol: 'marmot' },
    });
    await new Promise((r) => setTimeout(r, 0));
    await listNotifications(OWNER);
    expect(await listNotifications(OWNER)).toHaveLength(0);
  });
});

describe('review r2: placeholders are replaced, never lost', () => {
  const OWNER = 'f'.repeat(64);
  const T = Date.now();
  const placeholder = (at: number) =>
    recordNotification(
      OWNER,
      { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
      at,
    );

  it('a real Marmot alert drops only the placeholders its own message can stand for', async () => {
    await placeholder(T - 10 * 60_000); // an older push, for another message
    const mine = await placeholder(T + 2_000); // posted just after this message was sent
    await dropMarmotPushAlerts(OWNER, T);
    const left = await listNotifications(OWNER);
    expect(left.map((e) => e.id)).not.toContain(mine.id);
    expect(left).toHaveLength(1);
  });

  it('opening the Messages list (no time) drops them all', async () => {
    await placeholder(T - 10 * 60_000);
    await placeholder(T);
    await dropMarmotPushAlerts(OWNER);
    expect(await listNotifications(OWNER)).toHaveLength(0);
  });

  it('a collapsed tray entry says how many messages it stands for', async () => {
    setNotificationsForeground(false);
    const peer = 'e'.repeat(64);
    for (let i = 0; i < 2; i++)
      await fireMessageNotification({
        owner: OWNER,
        kind: 'dm',
        threadId: peer,
        title: 'New message',
        body: 'm',
        data: { conversationPubkey: peer, conversationProtocol: 'marmot', messageId: `m${i}` },
      });
    expect(lastScheduledContent()?.data).toMatchObject({ threadCount: 2, messageId: 'm1' });
  });

  it("deleting one message doesn't dismiss a collapsed entry that also stands for earlier ones", async () => {
    const ref = { owner: OWNER, groupId: 'marmot:g', messageId: 'm1', sender: null };
    const req = (threadCount?: number) => ({
      identifier: `n${threadCount ?? 1}`,
      content: {
        data: {
          owner: OWNER,
          marmotGroupId: 'marmot:g',
          messageId: 'm1',
          ...(threadCount ? { threadCount } : {}),
        },
      },
      trigger: { type: 'timeInterval' },
    });
    mockGetPresented.mockResolvedValueOnce([{ request: req(3) }, { request: req() }]);
    mockDismiss.mockClear();
    expect(await retractMarmotMessageNotifications([ref], { tray: true })).toBe(1);
    expect(mockDismiss).toHaveBeenCalledWith('n1');
    expect(mockDismiss).not.toHaveBeenCalledWith('n3');
  });
});
