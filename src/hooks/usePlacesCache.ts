import { useCallback, useState } from 'react';
import {
  type BtcMapPlace,
  type FetchPlacesResult,
  getCachedPlaces,
  peekCachedAnchorSync,
  peekCachedFetchedAtSync,
  peekCachedPlacesSync,
} from '../services/btcMapService';
import {
  type PlacesCacheSnapshot,
  reconcileFetchedPlaces,
  shouldStartLoading,
} from '../utils/placesCache';

/**
 * Cache-first hydration for the Places screen.
 *
 * `PlacesScreen` used to mount cold every visit — `places: []`, `pos:
 * null`, `loading: true` — and waited on a GPS fix + a BTC Map round-trip
 * before anything could paint. Because the sorted list is gated on `pos`,
 * the user saw a flash of the empty "No places nearby" state on every
 * open. This hook mirrors the stale-while-revalidate pattern the Explore
 * hub (`ExploreHomeScreen`) and the Geo-caches rail already use:
 *
 *   1. **Synchronous seed** — read the in-memory mirror
 *      (`peekCachedPlacesSync` / `peekCachedAnchorSync`) in the `useState`
 *      initialisers so the very first render already has the last-known
 *      places + anchor position. No `useEffect → setState` round-trip.
 *   2. **Background revalidate** — the screen still fires its live
 *      `fetchPlacesInBboxResult` on mount; `applyFetched` reconciles the
 *      result against what's shown. An authoritative fetch replaces the
 *      cache even when empty (a genuinely empty area clears the list); an
 *      offline/error blip keeps the cached list rather than blanking it.
 *   3. **Async warm-up fallback** — `seedFromCacheAsync` covers the cold
 *      start where disk hydration hasn't populated the mirror yet: it
 *      awaits `getCachedPlaces()` and seeds only if we're still empty.
 *
 * The pure decisions (loading seed, reconciliation, empty-state gating)
 * live in `src/utils/placesCache.ts` so they're unit-tested without a
 * renderer; this hook is the thin React wiring.
 */
export interface UsePlacesCacheResult {
  /** Cached + (after revalidation) live merchant set to render. */
  places: BtcMapPlace[];
  setPlaces: React.Dispatch<React.SetStateAction<BtcMapPlace[]>>;
  /** Last-known user position the cache was anchored at. Seeds `pos` so
   * the distance-sorted list renders before GPS resolves. */
  seededPos: { lat: number; lon: number } | null;
  /** True only when there is genuinely nothing cached to paint. */
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** Reconcile a freshly-fetched result into the shown list (cache-first:
   * an authoritative empty clears the list, but an offline/error fetch
   * never blanks an existing list). */
  applyFetched: (fetched: FetchPlacesResult) => void;
  /** Cold-start fallback — await the disk-hydrated cache and seed the
   * list if it's still empty. Safe to call before the live fetch. */
  seedFromCacheAsync: () => Promise<void>;
}

const readSnapshot = (): PlacesCacheSnapshot => ({
  places: peekCachedPlacesSync(),
  anchor: peekCachedAnchorSync(),
  fetchedAtMs: peekCachedFetchedAtSync(),
});

export const usePlacesCache = (): UsePlacesCacheResult => {
  // Seed synchronously off the in-memory mirror so the first paint shows
  // the last-known places + anchor — no empty flash, no spinner when warm.
  const [places, setPlaces] = useState<BtcMapPlace[]>(() => peekCachedPlacesSync());
  const [seededPos] = useState<{ lat: number; lon: number } | null>(() => peekCachedAnchorSync());
  const [loading, setLoading] = useState<boolean>(() => shouldStartLoading(readSnapshot()));

  const applyFetched = useCallback((fetched: FetchPlacesResult) => {
    setPlaces((prev) => reconcileFetchedPlaces(prev, fetched));
  }, []);

  const seedFromCacheAsync = useCallback(async () => {
    try {
      const cached = await getCachedPlaces();
      if (cached.length > 0) {
        setPlaces((prev) => (prev.length > 0 ? prev : cached));
      }
    } catch {
      // Best-effort — the live fetch is the authoritative path.
    }
  }, []);

  return {
    places,
    setPlaces,
    seededPos,
    loading,
    setLoading,
    applyFetched,
    seedFromCacheAsync,
  };
};
