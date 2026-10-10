// Recognising and routing the notification watcher's pushes.
//
// The watcher sends a generic alert ("New message", "Zap received", …) with
// data `{ source: 'lp-watcher', category }`, collapsed per category
// (APNs thread-id / collapse-id and the FCM tag are `lp-<category>`). Which of
// those survive to JS depends on the platform and how the alert was posted:
//   - Android, app running: `content.data` carries the data;
//   - Android, posted by the OS while backgrounded: no data, but expo's
//     identifier for it carries the tag (`…foreign_notifications?tag=lp-dm&id=0`);
//   - iOS: expo only exposes `userInfo.body` as data, so it is null — but
//     `threadIdentifier` (and the collapse id as identifier) is `lp-<category>`.
// On iOS it also sends ONE silent background push when a device first
// registers (an admission check): data `{ source: 'lp-watcher', type:
// 'validate' }`, no alert. It is never shown and never wakes anything.
// Pure — no expo imports — so it's unit-testable and safe in a headless task.

// Type-only: the protocol module pulls in crypto, which a headless wake
// task has no use for.
import type { WatcherCategory } from './watcherRegistration';

export const WATCHER_SOURCE = 'lp-watcher';

const CATEGORIES: readonly string[] = ['dm', 'zap', 'mention', 'payment'];
const isCategory = (v: unknown): v is WatcherCategory =>
  typeof v === 'string' && CATEGORIES.includes(v);

const TAG = /^lp-(dm|zap|mention|payment)$/;
const FOREIGN_TAG = /[?&]tag=lp-(dm|zap|mention|payment)(?:&|$)/;

interface RequestLike {
  identifier?: string | null;
  content?: { data?: unknown; threadIdentifier?: string | null } | null;
}

/** The watcher's silent admission check (iOS, once per registration): a
 * notification request, or a background-task payload (`{ data, … }`). */
export function isWatcherValidation(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const o = input as { data?: unknown; content?: { data?: unknown } | null };
  const data = (o.content?.data ?? o.data ?? input) as { source?: unknown; type?: unknown } | null;
  return !!data && data.source === WATCHER_SOURCE && data.type === 'validate';
}

/** The watcher category of a notification request, or null if it isn't one. */
export function watcherCategoryOf(request: RequestLike | null | undefined): WatcherCategory | null {
  if (!request) return null;
  const data = request.content?.data as { source?: unknown; category?: unknown } | null | undefined;
  if (data?.source === WATCHER_SOURCE) return isCategory(data.category) ? data.category : null;
  const thread = request.content?.threadIdentifier ?? '';
  const id = request.identifier ?? '';
  const match = TAG.exec(thread) ?? TAG.exec(id) ?? FOREIGN_TAG.exec(id);
  return match ? (match[1] as WatcherCategory) : null;
}

/** Is a background-task payload (a received push, or a tap on one) the
 * watcher's? Those carry no Marmot message, so the Marmot wake ignores them. */
export function isWatcherTaskPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as {
    data?: { source?: unknown } | null;
    source?: unknown;
    notification?: { request?: RequestLike } | null;
  };
  if (p.data?.source === WATCHER_SOURCE || p.source === WATCHER_SOURCE) return true;
  return watcherCategoryOf(p.notification?.request) !== null;
}

/**
 * While the app is open, is the watcher's alert worth showing? Messages, zaps
 * and wallet activity are already on screen (live inbox, PaymentNotifier with
 * the real amount), and a "payment" may be the user's own send — the watcher
 * can't tell sent from received. Mentions have no live surface in the app, so
 * those still show.
 */
export const showWatcherPushInForeground = (category: WatcherCategory): boolean =>
  category === 'mention';

/** Tap target, in navigateFromNotification's terms: messages → the Messages
 * list, mentions → Notifications, zaps / wallet activity → Home (wallet). */
export function watcherTapData(category: WatcherCategory): { kind: string } {
  switch (category) {
    case 'dm':
      return { kind: 'dm' };
    case 'mention':
      return { kind: 'mention' };
    case 'zap':
    case 'payment':
      return { kind: 'payment' };
  }
}
