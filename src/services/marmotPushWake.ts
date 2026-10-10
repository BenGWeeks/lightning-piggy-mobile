// What a Marmot push does when it lands (MIP-05 receive side).
//
// The notification server knows nothing about the message, so a push is
// only "something arrived for you". iOS: Transponder sends a generic APNs
// alert ("New message"), shown by the OS. Android: FCM delivers a data-only
// message to this task — even when the app was swiped away — and we post
// the same generic alert ourselves, unless the app already said it:
//   - foreground: the live Marmot session shows the real message → nothing;
//   - background but still running: if the session showed a Marmot message
//     just before (the usual order) or within a short grace period after,
//     that covers it; otherwise post the generic alert — and the session
//     clears it if the real message turns up later;
//   - not running (headless): post the generic alert straight away.
// The generic alert is a "no-thread" message ping: tapping it opens the
// Messages list, and opening that list clears it (#1142).
//
// `defineTask` must run in the global scope on every JS start — hence the
// side-effect import from index.ts.

import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import {
  dismissNotificationsFor,
  fireMessageNotification,
  lastMarmotNotificationAt,
} from './notificationService';

export const MARMOT_PUSH_WAKE_TASK = 'lp-marmot-push-wake';
/** How long a running session gets to post the detailed notification. */
const LIVE_SESSION_GRACE_MS = 6_000;
/** The sender publishes the message BEFORE the trigger, so a running app
 * has often shown it already when the push lands — look back this far. */
const COVERED_LOOKBACK_MS = 30_000;

// Set by marmotPushRegistration while the app has a Marmot session (kept
// as a flag so this module — loaded at every JS start, headless included —
// never pulls in the MLS stack).
let liveSession = false;
export function setLiveMarmotSession(live: boolean): void {
  liveSession = live;
}

export type WakeOutcome = 'foreground' | 'covered' | 'notified';

export interface WakeDeps {
  isForeground: () => boolean;
  hasLiveSession: () => boolean;
  lastNotifiedAt: () => number;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  notify: () => Promise<void>;
}

/** "New message" with no thread: a tap opens the Messages list. */
export async function postGenericPushAlert(): Promise<void> {
  // One generic alert at a time: a burst of pushes replaces it, not stacks.
  await dismissNotificationsFor({ genericMessages: true });
  await fireMessageNotification({
    kind: 'dm',
    // Sentinel — never the thread on screen, so never suppressed.
    threadId: '__push__',
    title: 'New message',
    body: 'Open Lightning Piggy to read',
    // Marked so the real Marmot notification can replace it.
    data: { marmotPush: true },
  });
}

const defaultDeps: WakeDeps = {
  isForeground: () => AppState.currentState === 'active',
  hasLiveSession: () => liveSession,
  lastNotifiedAt: lastMarmotNotificationAt,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  notify: postGenericPushAlert,
};

// Wakes are handled one at a time: two overlapping pushes must not both find
// no alert and both post one.
let wakeChain: Promise<unknown> = Promise.resolve();

export function handleMarmotPushWake(deps: WakeDeps = defaultDeps): Promise<WakeOutcome> {
  const arrived = deps.now();
  const run = wakeChain.then(() => handleOne(deps, arrived));
  wakeChain = run.catch(() => undefined);
  return run;
}

async function handleOne(deps: WakeDeps, arrived: number): Promise<WakeOutcome> {
  if (deps.isForeground()) return 'foreground';
  if (deps.hasLiveSession()) {
    if (deps.lastNotifiedAt() >= arrived - COVERED_LOOKBACK_MS) return 'covered';
    await deps.wait(LIVE_SESSION_GRACE_MS);
    if (deps.isForeground() || deps.lastNotifiedAt() >= arrived - COVERED_LOOKBACK_MS) {
      return 'covered';
    }
  }
  // Re-checked right before posting: the real message may have just landed.
  if (deps.lastNotifiedAt() >= arrived - COVERED_LOOKBACK_MS && deps.hasLiveSession()) {
    return 'covered';
  }
  await deps.notify();
  return 'notified';
}

if (!TaskManager.isTaskDefined(MARMOT_PUSH_WAKE_TASK)) {
  TaskManager.defineTask(MARMOT_PUSH_WAKE_TASK, async ({ error }) => {
    if (error) return;
    try {
      await handleMarmotPushWake();
    } catch (e) {
      if (__DEV__) console.warn('[MarmotPush] wake handling failed:', e);
    }
  });
}
