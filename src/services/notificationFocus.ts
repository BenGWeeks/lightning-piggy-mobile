// Foreground-suppression state (#279), split from notificationService: which
// screen the user is looking at, so a message (or find-log) alert for exactly
// that thread (or cache) stays quiet. No dependencies — the trigger paths and
// the navigation focus sync both read / drive it.

// We never want to buzz the user about the very thread they're staring
// at. The app root drives `setNotificationsForeground` from AppState, and
// the open Conversation / GroupConversation screens drive
// `setActiveThread` on focus / blur. A message trigger then skips the
// notification only when the app is foreground AND the active thread is
// the one the message belongs to. Payments are never suppressed — money
// arriving is always worth surfacing.
let appInForeground = true;
let activeThreadId: string | null = null;
// #740: same idea as `activeThreadId` but keyed on the cache coordinate
// (`<kind>:<pubkey>:<d>`) so a find-log fired while the user is on that
// exact HuntPiggyDetail screen stays quiet. Kept independent of the
// thread id so a cache and a DM thread never collide on the same value.
let activeCacheCoord: string | null = null;

/** Called by the app root on AppState change. */
export function setNotificationsForeground(active: boolean): void {
  appInForeground = active;
}

/**
 * Called by Conversation / GroupConversation screens on focus (with the
 * partner pubkey or group id) and on blur (with `null`).
 */
export function setActiveThread(threadId: string | null): void {
  activeThreadId = threadId;
}

/** True when the app is foreground AND the user is viewing `threadId`. */
export function isThreadActivelyViewed(threadId: string): boolean {
  return appInForeground && activeThreadId === threadId;
}

/**
 * Called by HuntPiggyDetail / the navigation focus sync on focus (with the
 * cache coord) and on blur (with `null`). Mirrors `setActiveThread` (#740).
 */
export function setActiveCache(cacheCoord: string | null): void {
  activeCacheCoord = cacheCoord;
}

/** True when the app is foreground AND the user is viewing `cacheCoord`. */
export function isCacheActivelyViewed(cacheCoord: string): boolean {
  return appInForeground && activeCacheCoord === cacheCoord;
}

/** Test hook: back to "foreground, nothing open". */
export function __resetNotificationFocusForTests(): void {
  appInForeground = true;
  activeThreadId = null;
  activeCacheCoord = null;
}
