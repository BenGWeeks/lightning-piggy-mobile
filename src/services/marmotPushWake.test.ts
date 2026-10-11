jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  defineTask: jest.fn(),
}));
jest.mock('./notificationService', () => ({
  dismissNotificationsFor: jest.fn(async () => 0),
  dropMarmotPushAlerts: jest.fn(async () => undefined),
  PLACEHOLDER_MATCH_MS: 60_000,
  fireMessageNotification: jest.fn(async () => 'id'),
  lastMarmotNotificationAt: jest.fn(() => 0),
}));

import * as TaskManager from 'expo-task-manager';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetPushWakeForTests,
  handleMarmotPushWake,
  lastMarmotTrafficAt,
  MARMOT_PUSH_WAKE_TASK,
  noteMarmotCommit,
  noteMarmotGroupTraffic,
  placeholderOutcome,
  postGenericPushAlert,
  settlePushPlaceholders,
  type MarmotTraffic,
  type WakeDeps,
} from './marmotPushWake';
import {
  __resetNotificationHistoryForTests,
  listNotifications,
  recordNotification,
} from './notificationHistory';
import * as notificationService from './notificationService';
import { dismissNotificationsFor, fireMessageNotification } from './notificationService';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
/** A decrypted app event: a peer's DM message unless overridden. */
const traffic = (createdAtSec: number, o: Partial<MarmotTraffic> = {}): MarmotTraffic => ({
  createdAtSec,
  fromMe: false,
  message: true,
  conversationPubkey: PEER,
  ...o,
});

// Clears a pending debounced settle timer, which would keep Jest alive.
afterEach(() => __resetPushWakeForTests());

function deps(over: Partial<WakeDeps> = {}): WakeDeps & { notified: number } {
  const d = {
    notified: 0,
    isForeground: () => false,
    hasLiveSession: () => false,
    lastNotifiedAt: () => 0,
    wait: async () => undefined,
    now: () => 10_000,
    notify: async () => {
      d.notified++;
    },
    ...over,
  };
  return d;
}

describe('handleMarmotPushWake', () => {
  it('defines its task at module load (so a headless start can run it)', () => {
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      MARMOT_PUSH_WAKE_TASK,
      expect.any(Function),
    );
  });

  it('in the foreground, stays silent only when the app showed the message', async () => {
    const shown = deps({ isForeground: () => true, lastNotifiedAt: () => 9_000 });
    expect(await handleMarmotPushWake(shown)).toBe('covered');
    // e.g. a push for another signed-in account: nothing on screen covers it.
    const unseen = deps({ isForeground: () => true, now: () => 100_000, lastNotifiedAt: () => 0 });
    expect(await handleMarmotPushWake(unseen)).toBe('notified');
  });

  it('posts the generic alert straight away when the app is not running', async () => {
    const wait = jest.fn(async () => undefined);
    const d = deps({ wait });
    expect(await handleMarmotPushWake(d)).toBe('notified');
    expect(d.notified).toBe(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('lets a running session cover it with the detailed notification', async () => {
    let last = 0;
    const d = deps({
      hasLiveSession: () => true,
      lastNotifiedAt: () => last,
      wait: async () => {
        last = 10_500; // the session notified during the grace period
      },
    });
    expect(await handleMarmotPushWake(d)).toBe('covered');
    expect(d.notified).toBe(0);
  });

  it('is covered when the session showed the message just BEFORE the push (usual order)', async () => {
    const wait = jest.fn(async () => undefined);
    const d = deps({ hasLiveSession: () => true, lastNotifiedAt: () => 9_000, wait });
    expect(await handleMarmotPushWake(d)).toBe('covered');
    expect(wait).not.toHaveBeenCalled();
    expect(d.notified).toBe(0);
  });

  it('falls back to the generic alert when the running session stayed quiet', async () => {
    const d = deps({ hasLiveSession: () => true, lastNotifiedAt: () => 10_000 - 16_000 });
    expect(await handleMarmotPushWake(d)).toBe('notified');
    expect(d.notified).toBe(1);
  });

  it('handles overlapping wakes one at a time', async () => {
    let notified = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const d = deps({
      notify: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        notified++;
        inFlight--;
      },
    });
    await Promise.all([handleMarmotPushWake(d), handleMarmotPushWake(d)]);
    expect(notified).toBe(2);
    expect(maxInFlight).toBe(1);
  });

  it('the generic alert replaces an earlier one and routes to Messages', async () => {
    await postGenericPushAlert();
    expect(dismissNotificationsFor).toHaveBeenCalledWith({ genericMessages: true });
    // kind 'dm' with no thread id = a no-thread ping → the Messages list.
    expect(fireMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dm', threadId: '__push__', data: { marmotPush: true } }),
    );
  });

  it('a real Marmot alert landing while the generic one is posted replaces it (just-posted rows only)', async () => {
    const last = notificationService.lastMarmotNotificationAt as jest.Mock;
    last.mockReturnValueOnce(0).mockReturnValueOnce(12_345);
    const drop = notificationService.dropMarmotPushAlerts as jest.Mock;
    drop.mockClear();
    await postGenericPushAlert();
    // Windowed by time — never "every placeholder".
    expect(drop).toHaveBeenCalledWith(undefined, expect.any(Number));
  });

  it('traffic landing while it is posted settles it rather than dropping it', async () => {
    await AsyncStorage.clear();
    __resetNotificationHistoryForTests();
    __resetPushWakeForTests();
    const drop = notificationService.dropMarmotPushAlerts as jest.Mock;
    drop.mockClear();
    (fireMessageNotification as jest.Mock).mockImplementationOnce(async () => {
      noteMarmotGroupTraffic(ME, traffic(Date.now() / 1000, { fromMe: true }));
      return 'id';
    });
    await postGenericPushAlert();
    expect(drop).not.toHaveBeenCalled();
  });

  it('leaves the generic alert alone when nothing landed meanwhile', async () => {
    const drop = notificationService.dropMarmotPushAlerts as jest.Mock;
    drop.mockClear();
    await postGenericPushAlert();
    expect(drop).not.toHaveBeenCalled();
  });
});

describe('the wake task and notification-watcher pushes', () => {
  // The task (registered once at module load) also sees the watcher's pushes
  // and taps on them: those must never post a Marmot "New message".
  const task = () =>
    (TaskManager.defineTask as jest.Mock).mock.calls.find(
      (c) => c[0] === MARMOT_PUSH_WAKE_TASK,
    )?.[1] as (body: { data: unknown; error: unknown }) => Promise<void>;

  it('ignores a watcher push and a tap on a watcher alert', async () => {
    (fireMessageNotification as jest.Mock).mockClear();
    await task()({ data: { data: { source: 'lp-watcher', category: 'zap' } }, error: null });
    await task()({
      data: {
        actionIdentifier: 'default',
        notification: { request: { identifier: 'lp-dm', content: { data: null } } },
      },
      error: null,
    });
    expect(fireMessageNotification).not.toHaveBeenCalled();
  });

  it('ignores a tap on any other notification too (a response is not a wake)', async () => {
    (fireMessageNotification as jest.Mock).mockClear();
    await task()({
      data: {
        actionIdentifier: 'default',
        notification: { request: { identifier: 'uuid', content: { data: { kind: 'payment' } } } },
      },
      error: null,
    });
    expect(fireMessageNotification).not.toHaveBeenCalled();
  });
});

describe('push placeholders: replaced or retracted only on evidence (never lost)', () => {
  const T = 1_800_000_000_000;
  const placeholder = (at: number) =>
    recordNotification(
      ME,
      { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
      at,
    );
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetNotificationHistoryForTests();
    __resetPushWakeForTests();
    (dismissNotificationsFor as jest.Mock).mockClear();
  });

  it('fresh group traffic the live session received covers the push', async () => {
    const d = deps({ hasLiveSession: () => true, lastTrafficAt: () => 9_500 });
    expect(await handleMarmotPushWake(d)).toBe('covered');
    expect(d.notified).toBe(0);
    const stale = deps({ hasLiveSession: () => true, now: () => 100_000, lastTrafficAt: () => 1 });
    expect(await handleMarmotPushWake(stale)).toBe('notified');
  });

  it('counts only live traffic for cover: backfill, replays and future-dated events never cover', () => {
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 3600), T); // an hour-old backfill
    expect(lastMarmotTrafficAt()).toBe(0);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 + 3600), T); // sender-controlled future
    expect(lastMarmotTrafficAt()).toBe(0);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 5), T);
    expect(lastMarmotTrafficAt()).toBe(T);
  });

  it('a commit (invite, admin change) covers a wake but never settles a placeholder', async () => {
    jest.useFakeTimers();
    try {
      const now = Date.now();
      await placeholder(now);
      noteMarmotCommit(now);
      expect(lastMarmotTrafficAt()).toBe(now);
      await jest.advanceTimersByTimeAsync(5_000);
    } finally {
      jest.useRealTimers();
    }
    expect(await listNotifications(ME)).toHaveLength(1);
  });

  it("a backfill that doesn't reach the placeholder's message keeps it", async () => {
    await placeholder(T);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 10 * 60, { conversationPubkey: PEER }), T + 1000);
    expect(await settlePushPlaceholders(ME)).toEqual([]);
    const [row] = await listNotifications(ME);
    expect(row.data).toEqual({ marmotPush: true });
  });

  it("a peer's message (live or backfilled, alerting or not) turns it into that conversation's row, in place", async () => {
    const { id } = await placeholder(T);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 5, { conversationPubkey: PEER }), T + 1000);
    expect(await settlePushPlaceholders(ME)).toEqual([]);
    const rows = await listNotifications(ME);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      kind: 'dm',
      read: false,
      data: { conversationPubkey: PEER, conversationProtocol: 'marmot' },
    });
    expect(rows[0].data.marmotPush).toBeUndefined();
    expect(dismissNotificationsFor).not.toHaveBeenCalled();
  });

  it('a group message points it at the group', async () => {
    await placeholder(T);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 5, { groupId: 'marmot:g' }), T + 1000);
    await settlePushPlaceholders(ME);
    expect((await listNotifications(ME))[0]).toMatchObject({
      kind: 'group',
      data: { groupId: 'marmot:g' },
    });
  });

  it('only our own or non-message traffic in its window retracts it (tray too)', async () => {
    const { id } = await placeholder(T);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 5, { fromMe: true }), T + 1000);
    noteMarmotGroupTraffic(ME, traffic(T / 1000 - 4, { message: false }), T + 1000);
    expect(await settlePushPlaceholders(ME)).toEqual([id]);
    expect(dismissNotificationsFor).toHaveBeenCalledWith({ historyIds: [id] });
    expect(await listNotifications(ME)).toHaveLength(0);
  });

  it("another account's traffic never touches this account's placeholder", async () => {
    await placeholder(T);
    noteMarmotGroupTraffic('b'.repeat(64), traffic(T / 1000 - 5, { fromMe: true }), T + 1000);
    await settlePushPlaceholders(ME);
    expect(await listNotifications(ME)).toHaveLength(1);
  });

  it('placeholderOutcome: peer message wins over own traffic; empty window keeps', () => {
    const at = (s: number, o: Partial<{ fromMe: boolean; message: boolean }> = {}) => ({
      at: T + s * 1000,
      fromMe: false,
      message: true,
      conversationPubkey: PEER,
      ...o,
    });
    expect(placeholderOutcome(T, [])).toEqual({ kind: 'keep' });
    expect(placeholderOutcome(T, [at(-120)])).toEqual({ kind: 'keep' }); // before the window
    expect(placeholderOutcome(T, [at(30)])).toEqual({ kind: 'keep' }); // after it was posted
    expect(placeholderOutcome(T, [at(-3, { fromMe: true })])).toEqual({ kind: 'retract' });
    expect(placeholderOutcome(T, [at(-3, { fromMe: true }), at(-2)])).toEqual({
      kind: 'replace',
      conversationPubkey: PEER,
    });
  });
});

describe('a push wake caused by our own send (e.g. from another of our devices)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetNotificationHistoryForTests();
    __resetPushWakeForTests();
  });

  it('is covered when the only new traffic is our own message — no generic "New message"', async () => {
    noteMarmotGroupTraffic(ME, traffic(Date.now() / 1000, { fromMe: true }));
    const d = deps({
      hasLiveSession: () => true,
      now: () => Date.now(),
      lastTrafficAt: lastMarmotTrafficAt,
    });
    expect(await handleMarmotPushWake(d)).toBe('covered');
    expect(d.notified).toBe(0);
  });

  it('retracts a headless generic alert once the session decrypts that self-authored message', async () => {
    const posted = Date.now();
    await recordNotification(
      ME,
      { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
      posted,
    );
    noteMarmotGroupTraffic(ME, traffic((posted - 5_000) / 1000, { fromMe: true }), posted + 1_000);
    await settlePushPlaceholders(ME);
    expect(await listNotifications(ME)).toHaveLength(0);
  });
});
