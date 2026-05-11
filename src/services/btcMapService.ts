/**
 * Read-only consumer of Bitcoin-accepting merchant data. Originally
 * hit `api.btcmap.org/v3/places` but that endpoint returned 404 by
 * mid-2025; v4 strips OSM tags + ignores bbox, v2 is bulky. So we
 * query **Overpass** directly against OpenStreetMap — the underlying
 * commons BTC Map curates. Same data, more reliable transport. We
 * never write back: merchant data lives in OSM (see project memory
 * `BTC Map runs the commons (Nathan)`). The exported type stays
 * `BtcMapPlace` so all callers / tests keep working.
 *
 * Closes part of #467.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Overpass interpreter — queries OpenStreetMap directly. BTC Map's
// own data is harvested from this same OSM commons (see project
// memory `BTC Map runs the commons (Nathan)`), so going to OSM
// upstream gives equivalent merchant coverage with a stable public
// HTTP surface. Main host first, mirrors as fallbacks.
const OVERPASS_HOSTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const FETCH_TIMEOUT_MS = 45_000;
const TILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
// AsyncStorage key — namespaced so it's grepable + obviously
// invalidatable from devtools. Persists the in-memory tile cache
// so a successful Overpass fetch survives mirror outages later in
// the week (the public mirrors return 406/504/403 unpredictably).
const TILE_CACHE_STORAGE_KEY = '@lp:btcmap-tile-cache';

export interface BtcMapPlace {
  id: number;
  lat: number;
  lon: number;
  /** OSM tags pulled through. We surface the shape we care about and
   * leave the rest as Record so callers can dig for additional keys. */
  tags: Record<string, string> & {
    name?: string;
    'addr:street'?: string;
    'addr:city'?: string;
    'addr:postcode'?: string;
    'payment:bitcoin'?: 'yes' | 'no';
    'payment:lightning'?: 'yes' | 'no';
    'payment:lightning_contactless'?: 'yes' | 'no';
    'payment:onchain'?: 'yes' | 'no';
    'contact:phone'?: string;
    'contact:website'?: string;
    'contact:email'?: string;
    /** Lightning Address. Several conventions exist in OSM tags; we read
     * the first one we find. */
    'payment:lightning_address'?: string;
    lud16?: string;
  };
  /**
   * Last time a community member confirmed the merchant still accepts
   * Bitcoin. Surfaced as "Verified N days ago" in MerchantDetail.
   */
  verified_at?: string | null;
}

interface CachedTile {
  fetchedAt: number;
  places: BtcMapPlace[];
}

/**
 * Bounding box in `[minLon, minLat, maxLon, maxLat]` order. Matches the
 * BTC Map API parameter order, which itself matches the GeoJSON convention.
 */
export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Cache key keyed by the rounded bbox (4 decimal places ≈ 11 m precision)
 * so adjacent viewports share the same cache entry instead of triggering
 * a fresh network call on every pan-by-a-pixel.
 */
// Coarse cache key — round bbox bounds to 2 decimal places (~1 km
// precision) so adjacent viewports during normal map panning share a
// cache entry. Per Copilot review on PR #488: 4-decimal precision
// generated a new key on every pixel-pan, bloating AsyncStorage.
const tileKey = (bbox: Bbox): string =>
  [
    bbox.minLon.toFixed(2),
    bbox.minLat.toFixed(2),
    bbox.maxLon.toFixed(2),
    bbox.maxLat.toFixed(2),
  ].join(',');

// LRU-style bounded cache. JS `Map` preserves insertion order, so
// dropping the oldest key when we exceed `TILE_CACHE_MAX_ENTRIES`
// keeps the most-recently-fetched tiles in memory + on disk.
const TILE_CACHE_MAX_ENTRIES = 32;
const tileCache = new Map<string, CachedTile>();
const touchCacheEntry = (key: string, entry: CachedTile): void => {
  // Re-insert so the LRU order tracks recent use.
  tileCache.delete(key);
  tileCache.set(key, entry);
  if (tileCache.size > TILE_CACHE_MAX_ENTRIES) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
};

const isFresh = (entry: CachedTile): boolean => Date.now() - entry.fetchedAt < TILE_CACHE_TTL_MS;

// One-shot AsyncStorage hydration. Runs on first `fetchPlacesInBbox`
// call, not at module load, because RN evaluates this file early in
// the bundle and AsyncStorage's native module may not be ready yet.
// The promise is cached so we never double-hydrate.
let hydratePromise: Promise<void> | null = null;
const hydrateFromStorage = async (): Promise<void> => {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(TILE_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, CachedTile>;
      for (const [k, entry] of Object.entries(parsed)) {
        if (entry && isFresh(entry)) touchCacheEntry(k, entry);
      }
    } catch {
      // Corrupt or unreadable storage shouldn't break merchant fetch —
      // we'll just hit Overpass and re-persist on success.
    }
  })();
  return hydratePromise;
};

// Serialise the live cache out to AsyncStorage. Best-effort; failures
// are silent because the in-memory cache still serves the session.
const persistToStorage = (): void => {
  const obj: Record<string, CachedTile> = {};
  tileCache.forEach((v, k) => {
    obj[k] = v;
  });
  AsyncStorage.setItem(TILE_CACHE_STORAGE_KEY, JSON.stringify(obj)).catch(() => {});
};

/**
 * Fetch merchants in a bounding box. Returns cached results if a recent
 * fetch covered the same key. Caller should debounce on map-pan/zoom so
 * we're not hammering the API on every gesture frame.
 */
export const fetchPlacesInBbox = async (bbox: Bbox): Promise<BtcMapPlace[]> => {
  await hydrateFromStorage();
  const key = tileKey(bbox);
  const cached = tileCache.get(key);
  if (cached && isFresh(cached)) {
    return cached.places;
  }

  // Overpass QL — fetch every OSM node OR way whose tags indicate
  // Bitcoin acceptance, in the requested bbox. We union three
  // selectors because OSM contributors haven't settled on one tag:
  //   payment:bitcoin=yes   — most common modern convention
  //   currency:XBT=yes      — older "XBT is the ISO ticker for BTC" school
  //   payment:lightning=yes — Lightning-specific
  // `out center;` collapses ways to a representative point so we get
  // lat/lon regardless of geometry type. `[timeout:35]` matches our
  // client-side timeout so the server doesn't hold connections
  // open past when the client gave up.
  const bb = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const ql = `[out:json][timeout:35];
(
  node["payment:bitcoin"="yes"](${bb});
  node["currency:XBT"="yes"](${bb});
  node["payment:lightning"="yes"](${bb});
  way["payment:bitcoin"="yes"](${bb});
  way["currency:XBT"="yes"](${bb});
  way["payment:lightning"="yes"](${bb});
);
out center;`;

  // Race through Overpass mirrors. Some 406 React Native fetches on
  // certain Accept-Encoding combinations, others 504 under load; the
  // public-mirror landscape changes month-to-month. First success wins.
  let lastError: Error | null = null;
  for (const host of OVERPASS_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // POST with `text/plain` body = raw QL — the format every Overpass
      // mirror documents and that sidesteps Accept-Encoding negotiation
      // headaches the `data=` form runs into from React Native's fetch.
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
        body: ql,
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = new Error(`Overpass ${res.status} from ${host}`);
        continue;
      }
      const json = (await res.json()) as {
        elements?: Array<{
          type: 'node' | 'way' | 'relation';
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };
      const places: BtcMapPlace[] = (json.elements ?? [])
        .map((el) => {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat === undefined || lon === undefined) return null;
          const tags = el.tags ?? {};
          const verified_at: string | null =
            tags['check_date'] ??
            tags['check_date:payment:bitcoin'] ??
            tags['check_date:currency:XBT'] ??
            null;
          return { id: el.id, lat, lon, tags, verified_at } as BtcMapPlace;
        })
        .filter((p): p is BtcMapPlace => p !== null);
      touchCacheEntry(key, { fetchedAt: Date.now(), places });
      persistToStorage();
      return places;
    } catch (e) {
      lastError = e as Error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Overpass: no mirrors reachable');
};

/**
 * Resolve a Lightning Address from a place's OSM tags. Tries common
 * tag variants in order; returns null if none present. Purely a tag
 * lookup — we never invent or normalise the address (callers handle
 * presentation + validation).
 */
export const lightningAddressOf = (place: BtcMapPlace): string | null =>
  place.tags['payment:lightning_address'] ?? place.tags.lud16 ?? null;

export const acceptsLightning = (place: BtcMapPlace): boolean =>
  place.tags['payment:lightning'] === 'yes' ||
  place.tags['payment:lightning_contactless'] === 'yes';

export const acceptsOnchain = (place: BtcMapPlace): boolean =>
  place.tags['payment:onchain'] === 'yes' || place.tags['payment:bitcoin'] === 'yes';

/**
 * Human-readable address synthesised from the tags BTC Map / OSM
 * exposes. Falls back to lat/lon if no address tags are set.
 */
export const formatAddress = (place: BtcMapPlace): string => {
  const parts = [place.tags['addr:street'], place.tags['addr:city'], place.tags['addr:postcode']]
    .filter(Boolean)
    .join(', ');
  return parts || `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;
};

/**
 * Days since the place was last community-verified, or null if never
 * verified. UI surfaces this as "Verified 3 days ago" — when null we
 * display nothing rather than implying staleness.
 */
export const daysSinceVerified = (place: BtcMapPlace): number | null => {
  if (!place.verified_at) return null;
  const ts = Date.parse(place.verified_at);
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1_000));
};

/**
 * Test-only escape hatch — the in-memory tile cache survives across
 * unit-test invocations otherwise, leading to flaky tests when one test
 * primes a key that another expects to be cold.
 */
export const __resetCacheForTest = (): void => {
  tileCache.clear();
  hydratePromise = null;
};
