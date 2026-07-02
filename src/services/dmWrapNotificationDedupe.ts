// Shared claim table so one gift wrap never yields two OS notifications.
// The foreground live DM sub (contexts/nostrLiveDmSub.ts) and the background
// watch (backgroundDmService.ts) can both be armed in the SAME JS context —
// the Android headless task runs in the app's existing React instance — so a
// fresh kind-1059 arrives at both callbacks. Whichever processes it first
// claims the wrap id here; the other skips its notification (#279).
const claimed = new Set<string>();

// Bounded so a long-lived watch session can't grow the set unboundedly.
// Insertion-ordered Set: when full, evict the oldest half in one pass.
const MAX_CLAIMED = 512;

/** True exactly once per wrap id — the caller that gets `true` fires. */
export function claimWrapNotification(wrapId: string | null | undefined): boolean {
  if (!wrapId) return true;
  if (claimed.has(wrapId)) return false;
  claimed.add(wrapId);
  if (claimed.size > MAX_CLAIMED) {
    let toDrop = MAX_CLAIMED / 2;
    for (const id of claimed) {
      if (toDrop-- <= 0) break;
      claimed.delete(id);
    }
  }
  return true;
}

/** Test hook: clear the claim table between tests. */
export function __resetForTests(): void {
  claimed.clear();
}
