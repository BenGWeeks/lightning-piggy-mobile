import { initialiseBackgroundRelayAccount } from './backgroundRelayAccount';
import { canonicalMessageTarget } from '../utils/notificationRouting';
// What a Marmot push does when it lands (MIP-05 receive side).
//
// The notification server knows nothing about the message, so a push is
// only "something arrived for you". iOS: Transponder sends a generic APNs
// alert ("New message"), shown by the OS. Android: FCM delivers a data-only
// message to this task — even when the app was swiped away — and we post
// the same generic alert ourselves, unless the app already said it:
//   - background but still running: if the session showed a Marmot message
//     just before (the usual order) or within a short grace period after,
//     that covers it; otherwise post the generic alert — and the session
//     clears it if the real message turns up later;
//   - not running (headless): post the generic alert straight away.
// The generic alert is a "no-thread" message ping: tapping it opens the
// Messages list, and opening that list clears it (#1142).
//
// A push only says "group traffic arrived", and not all traffic is a message
// worth an alert: White Noise also wakes members after an invite commit, and
// the message may be one the app shows without alerting (already on screen,
// our own, deleted). So fresh group traffic the live session received around
// the push covers it too. And the generic alert is a placeholder, never
// deleted in the hope another row is written: when the real message alerts it
// replaces it; once the session has decrypted the traffic it stood for, a
// peer's message turns it into that conversation's row (in place), and only
// traffic that positively shows nothing — our own message, a reaction or
// other non-message — retracts it.
//
// `defineTask` must run in the global scope on every JS start — hence the
// side-effect import from index.ts.

import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import {
  listNotifications,
  rewriteNotifications,
  type NotificationHistoryEntry,
} from './notificationHistory';
import {
  dismissNotificationsFor,
  dropMarmotPushAlerts,
  fireMessageNotification,
  lastMarmotNotificationAt,
  marmotMessageShown,
  PLACEHOLDER_MATCH_MS,
} from './notificationService';
import { isWatcherTaskPayload } from './watcherPushReceive';

export const MARMOT_PUSH_WAKE_TASK = 'lp-marmot-push-wake';
/** How long a running session gets to post the detailed notification. */
const LIVE_SESSION_GRACE_MS = 6_000;
/** The sender publishes the message BEFORE the trigger, so a running app
 * has often shown it already when the push lands — look back this far.
 * A push carries no message id, so this is a heuristic: kept short so an
 * earlier, unrelated alert rarely stands in for this one. */
const COVERED_LOOKBACK_MS = 15_000;
/** Group traffic sent within this long is live, not a backfill or replay. */
const FRESH_TRAFFIC_MS = 120_000;
const PLACEHOLDER_SKEW_MS = 5_000;
const SETTLE_DEBOUNCE_MS = 1_500;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** Recent decrypted events kept for matching placeholders (bounded). */
const TRAFFIC_KEEP = 300;

// Set by marmotPushRegistration while the app has a Marmot session (kept
// as a flag so this module — loaded at every JS start, headless included —
// never pulls in the MLS stack).
let liveSession = false;
export function setLiveMarmotSession(live: boolean): void {
  liveSession = live;
}

/** One decrypted Marmot app event, as far as a push placeholder cares. */
export interface MarmotTraffic {
  /** The event's own time (sender-controlled; checked for plausibility). */
  createdAtSec: number;
  fromMe: boolean;
  /** A chat message — not a reaction, edit, delete, push token… */
  message: boolean;
  /** Where it shows: the 1:1 peer, or the group. */
  conversationPubkey?: string;
  groupId?: string;
  /** The app-event id — a message that already has its own row is skipped. */
  messageId?: string;
}
type Seen = MarmotTraffic & { owner: string; at: number };

// When the live session last received fresh group traffic (wall-clock ms).
let lastTrafficAt = 0;
export const lastMarmotTrafficAt = (): number => lastTrafficAt;
let recent: Seen[] = [];
// Unknown at start: a headless run (another JS context) may have posted one.
let placeholdersMayExist = true;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
// Accounts whose session is still draining its backfill: what a placeholder
// stood for may not be decrypted yet, so nothing is settled until it's done.
const catchingUp = new Set<string>();

/** Debounced (each event restarts it) and held while catching up. */
function scheduleSettle(owner: string): void {
  if (!placeholdersMayExist) return;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (!catchingUp.has(owner)) void settlePushPlaceholders(owner);
  }, SETTLE_DEBOUNCE_MS);
}

/** Set by the session: true from start until every group's backfill has
 * drained (its live subscription opened). Clearing it settles. */
export function setMarmotCatchingUp(owner: string, catching: boolean): void {
  if (catching) catchingUp.add(owner);
  else if (catchingUp.delete(owner)) scheduleSettle(owner);
}

/**
 * The Marmot session decrypted an app event (live or from a backfill). O(1)
 * per event; matching it against placeholders is one debounced pass.
 */
export function noteMarmotGroupTraffic(owner: string, t: MarmotTraffic, now = Date.now()): void {
  const at = t.createdAtSec * 1000;
  if (!Number.isFinite(at) || at > now + MAX_FUTURE_SKEW_MS) return; // sender-controlled
  if (at >= now - FRESH_TRAFFIC_MS) lastTrafficAt = now;
  recent.push({ ...t, owner, at });
  if (recent.length > TRAFFIC_KEEP) recent = recent.slice(-TRAFFIC_KEEP);
  scheduleSettle(owner);
}

/**
 * The session processed a commit (e.g. an invite — White Noise pushes for
 * those too). Only covers a wake arriving now; it never settles a
 * placeholder: a commit says nothing about the message one stood for.
 */
export function noteMarmotCommit(now = Date.now()): void {
  lastTrafficAt = now;
}

export type PlaceholderOutcome =
  | { kind: 'keep' }
  | { kind: 'retract' }
  | { kind: 'replace'; conversationPubkey?: string; groupId?: string; messageId?: string };

/**
 * Pure: what decrypted traffic (the session has caught up) says about a
 * placeholder posted at `postedAt`. Only events sent shortly before it was
 * posted can be what woke us. A peer's message without a row of its own →
 * the placeholder becomes that conversation's row; otherwise (our own or
 * non-message events, or messages already alerted / on screen) → retract,
 * the real row exists or there's nothing to show; nothing in the window →
 * keep it (the message may still be on its way).
 */
export function placeholderOutcome(
  postedAt: number,
  traffic: readonly (Pick<
    Seen,
    'at' | 'fromMe' | 'message' | 'conversationPubkey' | 'groupId' | 'messageId'
  > & {
    shown?: boolean;
  })[],
): PlaceholderOutcome {
  const window = traffic.filter(
    (t) => t.at >= postedAt - PLACEHOLDER_MATCH_MS && t.at <= postedAt + PLACEHOLDER_SKEW_MS,
  );
  const peer = window
    .filter((t) => t.message && !t.fromMe && !t.shown)
    .sort((a, b) => b.at - a.at)[0];
  if (peer)
    return {
      kind: 'replace',
      conversationPubkey: peer.conversationPubkey,
      groupId: peer.groupId,
      ...(peer.messageId ? { messageId: peer.messageId } : {}),
    };
  return window.length > 0 ? { kind: 'retract' } : { kind: 'keep' };
}

/**
 * Settle `owner`'s generic push alerts against the traffic decrypted so far:
 * replaced in place or retracted per `placeholderOutcome`, never deleted on a
 * guess. Returns the retracted row ids.
 */
export async function settlePushPlaceholders(owner: string): Promise<string[]> {
  const traffic = recent
    .filter((t) => t.owner === owner)
    .map((t) => ({ ...t, shown: !!t.messageId && marmotMessageShown(t.messageId) }));
  const removed = await rewriteNotifications(owner, (e) => {
    if (e.data.marmotPush !== true) return e;
    const outcome = placeholderOutcome(e.createdAt, traffic);
    if (outcome.kind === 'keep') return e;
    if (outcome.kind === 'retract') return null;
    return replacedPlaceholder(e, outcome);
  });
  if (removed.length) await dismissNotificationsFor({ historyIds: removed });
  const left = await listNotifications(owner).catch(() => []);
  placeholdersMayExist = left.some((e) => e.data.marmotPush === true);
  return removed;
}

/** The placeholder row, now naming where its message is (a tap opens it). */
function replacedPlaceholder(
  e: NotificationHistoryEntry,
  to: { conversationPubkey?: string; groupId?: string; messageId?: string },
): NotificationHistoryEntry {
  const rest = { ...e.data };
  delete rest.marmotPush;
  const target = canonicalMessageTarget({
    ...to,
    protocol: 'marmot',
    threadKind: to.conversationPubkey ? 'dm' : 'group',
  });
  return {
    ...e,
    kind: target.threadKind,
    data: { ...rest, ...target, conversationProtocol: 'marmot' },
  };
}

export type WakeOutcome = 'covered' | 'notified';

export interface WakeDeps {
  isForeground: () => boolean;
  hasLiveSession: () => boolean;
  lastNotifiedAt: () => number;
  /** When the live session last received fresh group traffic. */
  lastTrafficAt?: () => number;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  notify: () => Promise<void>;
}

/** "New message" with no thread: a tap opens the Messages list. */
export async function postGenericPushAlert(): Promise<void> {
  const before = lastMarmotNotificationAt();
  const trafficBefore = lastTrafficAt;
  // One generic alert at a time: a burst of pushes replaces it, not stacks.
  await dismissNotificationsFor({ genericMessages: true });
  await fireMessageNotification({
    kind: 'dm',
    // Sentinel — never the thread on screen, so never suppressed.
    threadId: '__push__',
    title: 'New message',
    body: 'Open Lightning Piggy to read',
    // Marked so the real Marmot notification can replace it.
    data: { marmotPush: true, protocol: 'marmot' },
  });
  placeholdersMayExist = true;
  // The real message alerted while we were posting: it already tried to
  // replace us before we existed, so step aside (rows posted just now only).
  if (lastMarmotNotificationAt() !== before) {
    await dropMarmotPushAlerts(undefined, Date.now() - PLACEHOLDER_SKEW_MS);
  } else if (lastTrafficAt !== trafficBefore) {
    // Traffic landed meanwhile: the debounced, catch-up-gated settle (never
    // here, inline) matches us against it once it has all decrypted.
    const owner = recent[recent.length - 1]?.owner;
    if (owner) scheduleSettle(owner);
  }
}

const defaultDeps: WakeDeps = {
  isForeground: () => AppState.currentState === 'active',
  hasLiveSession: () => liveSession,
  lastNotifiedAt: lastMarmotNotificationAt,
  lastTrafficAt: lastMarmotTrafficAt,
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
  // Only evidence counts — the app having shown a Marmot message (alert or
  // open thread), or its live session having received fresh group traffic
  // (an invite commit, a message it shows without alerting). Being in the
  // foreground alone proves nothing: the push may be for another signed-in
  // account, or beat the session.
  const since = arrived - COVERED_LOOKBACK_MS;
  const covered = () => {
    const traffic = deps.lastTrafficAt?.() ?? 0; // 0 = none seen yet
    return deps.lastNotifiedAt() >= since || (traffic > 0 && traffic >= since);
  };
  if (deps.hasLiveSession() || deps.isForeground()) {
    if (covered()) return 'covered';
    await deps.wait(LIVE_SESSION_GRACE_MS);
    if (covered()) return 'covered';
  }
  await deps.notify();
  return 'notified';
}

if (!TaskManager.isTaskDefined(MARMOT_PUSH_WAKE_TASK)) {
  TaskManager.defineTask(MARMOT_PUSH_WAKE_TASK, async ({ data, error }) => {
    if (error) return;
    // A tap on any notification (Android runs the task for those too) is a
    // response, not a wake — it must never post a "New message".
    if (data && typeof data === 'object' && 'actionIdentifier' in data) return;
    // The task sees every push (and, on Android, taps on them): the
    // notification watcher's pushes post their own alert and wake nothing.
    if (isWatcherTaskPayload(data)) return;
    try {
      if (!(await initialiseBackgroundRelayAccount())) return;
      await handleMarmotPushWake();
    } catch (e) {
      if (__DEV__) console.warn('[MarmotPush] wake handling failed:', e);
    }
  });
}

/** Test-only reset of the traffic / placeholder state. */
export function __resetPushWakeForTests(): void {
  lastTrafficAt = 0;
  recent = [];
  catchingUp.clear();
  placeholdersMayExist = true;
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
}
