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

import {
  handleMarmotPushWake,
  MARMOT_PUSH_WAKE_TASK,
  postGenericPushAlert,
  type WakeDeps,
} from './marmotPushWake';
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

  it('stays silent in the foreground — the live session shows the message', async () => {
    const d = deps({ isForeground: () => true });
    expect(await handleMarmotPushWake(d)).toBe('foreground');
    expect(d.notified).toBe(0);
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
