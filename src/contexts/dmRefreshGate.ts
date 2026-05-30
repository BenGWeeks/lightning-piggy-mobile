import { DM_INBOX_REFRESH_TTL_MS } from './nostrDmCache';

/**
 * Pure freshness-cursor logic for `refreshDmInbox` (#788). The hook holds a
 * single `dmInboxLastRefreshAt` cursor (`performance.now()` of the last
 * COMPLETED refresh, `0` before any has finished) that drives three
 * decisions. Extracting them keeps `useDmInbox` under the file-size cap and,
 * more importantly, makes the cold-start ↔ abort interaction unit-testable
 * without standing up the whole hook + relay/decrypt stack.
 *
 * The load-bearing invariant: an ABORTED refresh must not advance the cursor.
 * If it did, the next refresh would (a) see `isColdStart === false` and skip
 * the cold-start macro-task yield (#788), and (b) be wrongly suppressed by the
 * TTL freshness gate even though no refresh ever completed.
 */

/**
 * Cold start = the first refresh of the session, i.e. no refresh has yet
 * COMPLETED and advanced the cursor. `force` does NOT exclude a cold start —
 * the real cold load is MessagesScreen's on-mount focus refresh; the
 * cold-start wrap cap + macro-task yield must apply to it. (#751/#788)
 */
export function isColdStartRefresh(lastRefreshAt: number): boolean {
  return lastRefreshAt === 0;
}

/**
 * Whether to skip the refresh entirely because a previous one COMPLETED within
 * the freshness TTL. `force` callers (pull-to-refresh) always bypass it; the
 * Messages-tab `useFocusEffect` uses the default path so tab-bouncing doesn't
 * re-fire expensive relay+decrypt work. `now` is injected for testability.
 */
export function shouldSkipForFreshness(
  lastRefreshAt: number,
  force: boolean,
  now: number,
): boolean {
  if (force) return false;
  if (lastRefreshAt <= 0) return false;
  return now - lastRefreshAt < DM_INBOX_REFRESH_TTL_MS;
}

/**
 * Whether the completion of a refresh should advance the freshness cursor.
 * The refresh task RESOLVES (never rejects) on abort — it early-returns
 * internally on `signal.aborted` — so the `await task` site runs in both the
 * completed and aborted cases. We therefore stamp ONLY when the signal was not
 * aborted, so an interrupted refresh leaves the next one a genuine cold start.
 */
export function shouldStampCursor(aborted: boolean): boolean {
  return !aborted;
}
