import {
  PLACES_CACHE_TTL_MS,
  type PlacesCacheSnapshot,
  hasCachedPlaces,
  isSnapshotStale,
  reconcileFetchedPlaces,
  shouldShowEmptyState,
  shouldStartLoading,
} from './placesCache';
import type { BtcMapPlace, FetchPlacesResult } from '../services/btcMapService';

const makePlace = (id: number): BtcMapPlace => ({
  id,
  lat: 51.5,
  lon: -0.1,
  tags: { name: `Place ${id}` },
});

const snapshot = (over: Partial<PlacesCacheSnapshot> = {}): PlacesCacheSnapshot => ({
  places: [],
  anchor: null,
  ...over,
});

describe('placesCache pure helpers', () => {
  describe('hasCachedPlaces / shouldStartLoading', () => {
    it('reports no cached places + starts loading when the mirror is empty', () => {
      const snap = snapshot({ places: [] });
      expect(hasCachedPlaces(snap)).toBe(false);
      expect(shouldStartLoading(snap)).toBe(true);
    });

    it('reports cached places + skips the loading spinner when warm', () => {
      const snap = snapshot({ places: [makePlace(1)] });
      expect(hasCachedPlaces(snap)).toBe(true);
      // The crux of the fix: a warm cache must NOT start in the loading
      // state, so the list paints immediately instead of a spinner/empty.
      expect(shouldStartLoading(snap)).toBe(false);
    });
  });

  describe('isSnapshotStale', () => {
    const now = 1_000_000_000_000;

    it('treats a legacy envelope without a timestamp as stale', () => {
      expect(isSnapshotStale(snapshot({ fetchedAtMs: undefined }), now)).toBe(true);
      expect(isSnapshotStale(snapshot({ fetchedAtMs: null }), now)).toBe(true);
    });

    it('treats a snapshot older than the TTL as stale', () => {
      const old = now - PLACES_CACHE_TTL_MS - 1;
      expect(isSnapshotStale(snapshot({ fetchedAtMs: old }), now)).toBe(true);
    });

    it('treats a snapshot exactly at the TTL boundary as stale', () => {
      const boundary = now - PLACES_CACHE_TTL_MS;
      expect(isSnapshotStale(snapshot({ fetchedAtMs: boundary }), now)).toBe(true);
    });

    it('treats a recent snapshot as fresh', () => {
      const recent = now - 1_000;
      expect(isSnapshotStale(snapshot({ fetchedAtMs: recent }), now)).toBe(false);
    });

    it('honours a custom TTL', () => {
      const fetchedAtMs = now - 5_000;
      expect(isSnapshotStale(snapshot({ fetchedAtMs }), now, 10_000)).toBe(false);
      expect(isSnapshotStale(snapshot({ fetchedAtMs }), now, 1_000)).toBe(true);
    });
  });

  describe('shouldShowEmptyState', () => {
    it('never shows empty while a cache exists', () => {
      expect(shouldShowEmptyState({ cachedCount: 3, fetchedCount: 0, fetchSettled: true })).toBe(
        false,
      );
    });

    it('never shows empty while a fetch is still in flight', () => {
      expect(shouldShowEmptyState({ cachedCount: 0, fetchedCount: 0, fetchSettled: false })).toBe(
        false,
      );
    });

    it('shows empty only when settled with nothing cached and nothing fetched', () => {
      expect(shouldShowEmptyState({ cachedCount: 0, fetchedCount: 0, fetchSettled: true })).toBe(
        true,
      );
    });

    it('does not show empty when a settled fetch returned results', () => {
      expect(shouldShowEmptyState({ cachedCount: 0, fetchedCount: 5, fetchSettled: true })).toBe(
        false,
      );
    });
  });

  describe('reconcileFetchedPlaces', () => {
    const result = (over: Partial<FetchPlacesResult>): FetchPlacesResult => ({
      ok: true,
      places: [],
      ...over,
    });

    it('replaces the shown list with a non-empty authoritative fetch', () => {
      const shown = [makePlace(1)];
      const fetched = [makePlace(2), makePlace(3)];
      expect(reconcileFetchedPlaces(shown, result({ ok: true, places: fetched }))).toBe(fetched);
    });

    it('clears the list when an authoritative fetch returns genuinely empty', () => {
      // Moving to an area with no merchants must blank the previous
      // area's list so the screen can reach its honest empty state —
      // an `ok: true` empty is "0 places here", not a transient blip.
      const shown = [makePlace(1)];
      expect(reconcileFetchedPlaces(shown, result({ ok: true, places: [] }))).toEqual([]);
    });

    it('keeps the cached list when the fetch failed (offline/error fallback)', () => {
      // `ok: false` means the request blipped and `places` is the stale
      // cache fallback — never blank an existing list on that.
      const shown = [makePlace(1)];
      expect(reconcileFetchedPlaces(shown, result({ ok: false, places: [] }))).toBe(shown);
    });

    it('keeps the cached list when a failed fetch returns its stale fallback', () => {
      const shown = [makePlace(1)];
      const stale = [makePlace(1)];
      // Even if the failed fetch carries a (stale) fallback array, the
      // already-shown list wins so the view never flickers.
      expect(reconcileFetchedPlaces(shown, result({ ok: false, places: stale }))).toBe(shown);
    });

    it('accepts an authoritative empty when nothing was shown', () => {
      expect(reconcileFetchedPlaces([], result({ ok: true, places: [] }))).toEqual([]);
    });

    it('uses a failed fetch fallback when nothing was shown yet', () => {
      // Cold start, no list yet: a failed fetch's cache fallback is still
      // better than empty, so surface it.
      const fallback = [makePlace(9)];
      expect(reconcileFetchedPlaces([], result({ ok: false, places: fallback }))).toBe(fallback);
    });
  });
});
