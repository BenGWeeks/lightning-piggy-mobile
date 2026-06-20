/**
 * Pure helpers for the Places-screen cache-first hydration.
 *
 * The data layer (`btcMapService`) owns *where* the cached merchant set
 * lives (in-memory mirror + on-disk envelope). This module owns the
 * small, pure *decisions* the screen needs on top of that mirror:
 *
 *   - given a seed snapshot (cached places + anchor), should the screen
 *     start in its loading state, or paint immediately?
 *   - is a cached snapshot stale enough that the background revalidation
 *     should actually replace it?
 *   - has a background revalidation produced genuinely-empty results
 *     (so the "No places nearby" empty state is now legitimate)?
 *
 * Keeping these as pure functions means they're unit-testable without a
 * React renderer or AsyncStorage — the screen + hook just wire them up.
 * Mirrors the stale-while-revalidate shape the Geo-caches rail and the
 * Explore hub already use (`peekCachedCachesSync` / `peekCachedPlacesSync`).
 */

import type { BtcMapPlace } from '../services/btcMapService';

/**
 * Default staleness window for a cached Places snapshot. Matches the BTC
 * Map SWR TTL in `btcMapService` (1 h) — a snapshot older than this is
 * still painted instantly (cache-first), but treated as stale so the
 * screen knows the background revalidation is worth surfacing.
 */
export const PLACES_CACHE_TTL_MS = 60 * 60 * 1000;

/** A synchronous snapshot of the cached Places state, read off the
 * in-memory mirror at mount time. `fetchedAtMs` is optional — older
 * persisted envelopes predate it, in which case staleness can't be
 * computed and the snapshot is treated as stale (refresh anyway). */
export interface PlacesCacheSnapshot {
  places: BtcMapPlace[];
  anchor: { lat: number; lon: number } | null;
  fetchedAtMs?: number | null;
}

/**
 * True when the snapshot has at least one cached place to paint. Drives
 * the seed for `loading` — when we already have something to show there
 * is no skeleton/spinner, only a quiet background refresh.
 */
export const hasCachedPlaces = (snapshot: PlacesCacheSnapshot): boolean =>
  snapshot.places.length > 0;

/**
 * Initial `loading` value for the screen. We're only "loading" (blank,
 * spinner-worthy) when there is genuinely nothing cached to paint. With
 * a warm cache the list renders immediately and the refresh happens in
 * the background without a loading state.
 */
export const shouldStartLoading = (snapshot: PlacesCacheSnapshot): boolean =>
  !hasCachedPlaces(snapshot);

/**
 * Whether a painted cached snapshot is stale enough to warrant the
 * background revalidation actually replacing it. Returns true when:
 *   - there's no fetch timestamp (legacy envelope — always revalidate), or
 *   - the snapshot is older than `ttlMs`.
 * A fresh snapshot (younger than the TTL) is still revalidated on an
 * explicit pull-to-refresh; this only governs the implicit on-open case.
 */
export const isSnapshotStale = (
  snapshot: PlacesCacheSnapshot,
  now: number = Date.now(),
  ttlMs: number = PLACES_CACHE_TTL_MS,
): boolean => {
  const fetchedAt = snapshot.fetchedAtMs;
  if (typeof fetchedAt !== 'number') return true;
  return now - fetchedAt >= ttlMs;
};

/**
 * Decide whether the "No places nearby" empty state is legitimate.
 *
 * Cache-first contract: NEVER flash the empty state while a cache
 * exists. The empty state is only honest when BOTH the cached set is
 * empty AND a completed fetch returned nothing. While a fetch is still
 * in flight, or whenever any cached place is available to paint, this
 * returns false so the user sees content (or a spinner), never a false
 * "nothing here".
 */
export const shouldShowEmptyState = (args: {
  cachedCount: number;
  fetchedCount: number;
  fetchSettled: boolean;
}): boolean => args.cachedCount === 0 && args.fetchSettled && args.fetchedCount === 0;

/**
 * Reconcile a freshly-fetched set against the currently-shown one.
 * Cache-first rule: a successful fetch is authoritative and replaces the
 * shown set — UNLESS it came back empty while we already have something
 * cached to show (transient/offline blip), in which case we keep the
 * existing list rather than blanking it. Returns the array the screen
 * should render.
 */
export const reconcileFetchedPlaces = (
  shown: BtcMapPlace[],
  fetched: BtcMapPlace[],
): BtcMapPlace[] => {
  if (fetched.length === 0 && shown.length > 0) return shown;
  return fetched;
};
