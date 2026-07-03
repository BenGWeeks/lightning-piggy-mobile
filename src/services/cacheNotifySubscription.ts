/**
 * cacheNotifySubscription — live foreground subscriptions for activity
 * against the active user's published geo-caches (#740, #760).
 *
 * Two public surfaces, both mirroring the shape of `dmLiveSubscription`:
 *
 *   - `subscribeCacheCommentsForCoords` — kind-1111 NIP-22 comments,
 *     matched on the `#A` uppercase root pointer.
 *   - `subscribeCacheFoundLogsForCoords` — kind-7516 NIP-GC found-logs,
 *     matched on the `#a` lowercase cache pointer (`buildFoundLog` in
 *     `nostrPlacesService.ts` writes `["a", coord]`, NOT `A`).
 *
 * Both return a teardown function the caller invokes on cleanup. Empty
 * `cacheCoords` short-circuits — a filter with no tag values would be a
 * free firehose request and most relays reject it.
 *
 * The events are public (no decryption), so unlike the DM live sub there
 * is no signer dependency. The single filter shape is
 *
 *   { kinds: [<kind>], '<#a | #A>': cacheCoords, since: now - 7d, limit }
 *
 * The 7-day floor matches the DM live sub: enough that "I haven't opened
 * the app for a week" still catches recent activity, capped so cold-start
 * restream cost stays bounded even if the user owns many caches. Per-event
 * freshness is gated by the caller using `subOpenedAtSec`-style timestamp
 * checks (same pattern as DMs), NOT by EOSE — so a slow relay replaying
 * backlog late cannot reintroduce a notification flood.
 */
import type { VerifiedEvent } from 'nostr-tools';
import type { Filter } from 'nostr-tools/filter';
import { pool, trackRelays } from './nostrService';
import { GC_COMMENT_KIND, GC_FOUND_LOG_KIND } from './nostrPlacesService';

// Match the dmLiveSubscription cap — past 7 days is a different problem
// (handled by background detect-and-ping with a separate seen-set).
const CACHE_LIVE_SUB_MAX_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

// Cap the relay response so a cache with a viral comment / find thread
// cannot pin the JS thread on sub open. 500 is more than enough to catch
// any realistic burst and is what we'd want to surface in the inbox-style
// "new finds" notification path anyway.
const CACHE_LIVE_SUB_LIMIT = 500;

export interface CacheNotifySubscriptionInput {
  /** The active viewer's hex pubkey. Tracked for invariants and future
   * per-account dedup; the filter itself uses `cacheCoords` not pubkey
   * (finders can be anyone, including non-followed users). */
  viewerPubkey: string;
  /** Read relays the subscription opens against. */
  relays: string[];
  /** `<kind>:<pubkey>:<d>` addressable coordinates of the caches the
   * viewer owns. Empty → the subscription is a no-op (no filter armed). */
  cacheCoords: string[];
  /** Fires for every event matching the filter. The caller is responsible
   * for freshness gating, dedup, and notification fire. */
  onEvent: (event: VerifiedEvent) => void;
}

/**
 * Shared internal: open a single kind-filtered cache-activity sub keyed on
 * the given tag and return a teardown function. `tag` is `#A` (uppercase
 * NIP-22 root pointer, comments) or `#a` (lowercase NIP-GC cache pointer,
 * found-logs).
 */
function subscribeCacheActivity(
  input: CacheNotifySubscriptionInput,
  kind: number,
  tag: '#A' | '#a',
): () => void {
  if (input.cacheCoords.length === 0) {
    // No caches — nothing to watch. Returning a no-op closer keeps the
    // caller's effect cleanup simple.
    return () => {};
  }
  trackRelays(input.relays);
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - CACHE_LIVE_SUB_MAX_LOOKBACK_SECONDS;
  const filter: Filter = {
    kinds: [kind],
    since: sinceSec,
    limit: CACHE_LIVE_SUB_LIMIT,
  };
  // Assign the `#a` / `#A` tag filter separately — a computed-key literal
  // mixing it with the numeric `since` / `limit` widens the inferred index
  // signature past Filter's `#${string}: string[]` shape.
  filter[tag] = input.cacheCoords;
  const sub = pool.subscribeMany(input.relays, filter, {
    onevent: (e) => input.onEvent(e as VerifiedEvent),
  });
  return () => {
    try {
      sub.close();
    } catch {
      // best-effort — same swallow as the DM live sub.
    }
  };
}

/**
 * Open the live kind-1111 comment subscription for the viewer's caches and
 * return a teardown function. Matched on `#A` (uppercase NIP-22 root).
 */
export function subscribeCacheCommentsForCoords(input: CacheNotifySubscriptionInput): () => void {
  return subscribeCacheActivity(input, GC_COMMENT_KIND, '#A');
}

/**
 * Open the live kind-7516 found-log subscription for the viewer's caches
 * and return a teardown function. Matched on `#a` (lowercase NIP-GC cache
 * pointer) — `buildFoundLog` writes `["a", coord]`, so the uppercase `#A`
 * filter used for comments would never match a found-log (#760).
 */
export function subscribeCacheFoundLogsForCoords(input: CacheNotifySubscriptionInput): () => void {
  return subscribeCacheActivity(input, GC_FOUND_LOG_KIND, '#a');
}
