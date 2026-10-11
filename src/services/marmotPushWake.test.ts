jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  defineTask: jest.fn(),
}));
jest.mock('./notificationService', () => ({
  dismissNotificationsFor: jest.fn(async () => 0),
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
  noteMarmotGroupTraffic,
  PLACEHOLDER_MATCH_MS,
  postGenericPushAlert,
  settlePushPlaceholders,
  type WakeDeps,
} from './marmotPushWake';
import {
  __resetNotificationHistoryForTests,
  listNotifications,
  recordNotification,
} from './notificationHistory';
import * as notificationService from './notificationService';
import { dismissNotificationsFor, fireMessageNotification } from './notificationService';

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

  it('a real Marmot alert landing while the generic one is posted clears it', async () => {
    const last = notificationService.lastMarmotNotificationAt as jest.Mock;
    last.mockReturnValueOnce(0).mockReturnValueOnce(12_345);
    (dismissNotificationsFor as jest.Mock).mockClear();
    await postGenericPushAlert();
    expect(dismissNotificationsFor).toHaveBeenLastCalledWith({ marmotPushAlerts: true });
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

describe('pushes for traffic that shows nothing (phantom "New message")', () => {
  const OWNER = 'a'.repeat(64);
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetNotificationHistoryForTests();
    __resetPushWakeForTests();
    (dismissNotificationsFor as jest.Mock).mockClear();
  });

  it('fresh group traffic the live session received covers the push (e.g. an invite commit)', async () => {
    const d = deps({ hasLiveSession: () => true, lastTrafficAt: () => 9_500 });
    expect(await handleMarmotPushWake(d)).toBe('covered');
    expect(d.notified).toBe(0);
    // Traffic long before the push says nothing about it.
    const stale = deps({ hasLiveSession: () => true, now: () => 100_000, lastTrafficAt: () => 1 });
    expect(await handleMarmotPushWake(stale)).toBe('notified');
  });

  it('counts only live traffic: backfill, replays and future-dated events never cover', () => {
    const now = 1_800_000_000_000;
    noteMarmotGroupTraffic(OWNER, now / 1000 - 3600, now); // an hour-old backfill
    expect(lastMarmotTrafficAt()).toBe(0);
    noteMarmotGroupTraffic(OWNER, now / 1000 + 3600, now); // sender-controlled future
    expect(lastMarmotTrafficAt()).toBe(0);
    noteMarmotGroupTraffic(OWNER, now / 1000 - 5, now);
    expect(lastMarmotTrafficAt()).toBe(now);
  });

  it('settles only the placeholders the traffic can stand for', async () => {
    const T = Date.now();
    const placeholder = (at: number) =>
      recordNotification(
        OWNER,
        { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
        at,
      );
    const covered = await placeholder(T);
    await placeholder(T + 10 * 60_000); // posted long after this traffic: another push
    await recordNotification(OWNER, { kind: 'dm', title: 'Nodie', body: 'x' }, T);
    const removed = await settlePushPlaceholders(OWNER, T - PLACEHOLDER_MATCH_MS / 2);
    expect(removed).toEqual([covered.id]);
    expect(dismissNotificationsFor).toHaveBeenCalledWith({ historyIds: [covered.id] });
    const left = await listNotifications(OWNER);
    expect(left.map((e) => e.title).sort()).toEqual(['New message', 'Nodie']);
    expect(left.find((e) => e.title === 'New message')?.createdAt).toBe(T + 10 * 60_000);
  });

  it('group traffic settles a placeholder in one debounced pass', async () => {
    jest.useFakeTimers();
    try {
      const now = Date.now();
      await recordNotification(
        OWNER,
        { kind: 'dm', title: 'New message', body: 'x', data: { marmotPush: true } },
        now,
      );
      for (let i = 0; i < 5; i++)
        noteMarmotGroupTraffic(OWNER, Math.floor(now / 1000) - 3 + i, now);
      await jest.advanceTimersByTimeAsync(2_000);
    } finally {
      jest.useRealTimers();
    }
    await listNotifications(OWNER);
    expect(await listNotifications(OWNER)).toHaveLength(0);
  });
});
