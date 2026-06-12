import { DM_INBOX_REFRESH_TTL_MS } from './nostrDmCache';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

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
 * Whether this refresh may bypass the freshness TTL. Two callers qualify:
 * user-intent `force` refreshes (pull-to-refresh, follow-toggle), and the
 * automated cold-start backfill (#751) — the backfill fires immediately after
 * the capped first pass COMPLETED and stamped the cursor, so without a TTL
 * bypass it would be suppressed for a full window and the inbox would sit at
 * the 200-wrap slice.
 */
export function bypassesFreshnessTtl(opts: RefreshDmInboxOptions | undefined): boolean {
  return opts?.force === true || opts?.backfill === true;
}

/**
 * Whether to bypass the #743 negative-result skip-set. ONLY user-intent
 * refreshes qualify: `force` (a newly-followed contact's older wraps must be
 * re-evaluated on the next pull-to-refresh) and `includeNonFollows` (the dev
 * "Following only=off" toggle disables the follow gate, so wraps skipped as
 * non-follows must be re-surfaced — Copilot finding on #744). The automated
 * cold-start backfill must NOT bypass: it used to run as `force`, which
 * re-paid the schnorr + NIP-44 decrypt for every persisted skip-set wrap
 * (group rumors + non-followed senders — ~510 measured) on EVERY cold start,
 * the bulk of the 28-30 s circuit-1 freeze (#846).
 */
export function shouldBypassSkipSet(opts: RefreshDmInboxOptions | undefined): boolean {
  return opts?.force === true || opts?.includeNonFollows === true;
}

/**
 * Whether the kind-4 relay fetch should drop its `since` floor. Only a
 * NON-cold user `force` does — a follow-toggle / pull-to-refresh wants older
 * kind-4 from the newly-followed contact back. Cold start keeps the floor
 * even under force (the on-mount enforce-flip refresh doesn't need the full
 * kind-4 backlog — that was the ~11 s cold remainder, #751). The backfill
 * keeps it too: the NIP-04 plaintext cache is memory-only
 * (nostrSecretKeyCache.ts), so refetching the kind-4 backlog re-decrypted all
 * of it (~212 measured) on every cold start (#846).
 */
export function shouldDropK4Since(
  opts: RefreshDmInboxOptions | undefined,
  isColdStart: boolean,
): boolean {
  return opts?.force === true && !isColdStart;
}

/**
 * Whether the completion of a refresh should advance the freshness cursor.
 * The refresh task RESOLVES (never rejects) on abort — it early-returns
 * internally on `signal.aborted` — so the `await task` site runs in both the
 * completed and aborted cases. We stamp ONLY when the refresh was NOT aborted,
 * so an interrupted refresh leaves the next one a genuine cold start.
 *
 * IMPORTANT — pass "did this refresh fail to complete its work", NOT
 * `signal.aborted` read at the stamp site. Those differ in a race: a refresh
 * can finish (commit + persist) and then have its `AbortController` aborted in
 * the SAME tick (the user navigates away the instant it resolves). Reading
 * `signal.aborted` afterward would see `true` and skip the stamp, wrongly
 * making the NEXT refresh a cold start that bypasses the freshness TTL even
 * though a refresh genuinely completed. Callers therefore track a
 * `refreshCompleted` flag set after the commit and pass `!refreshCompleted`
 * here — a post-completion abort can't flip it (#788 review).
 */
export function shouldStampCursor(aborted: boolean): boolean {
  return !aborted;
}
