/**
 * Read-only consumer of Bitcoin-accepting merchant data sourced from
 * BTC Map's v4 REST API. BTC Map curates merchants from the OSM
 * commons (see project memory `BTC Map runs the commons (Nathan)`) —
 * we never write back.
 *
 * History: this file previously hit `/v3/places?bbox=…` (gone), then
 * pivoted to Overpass when v4 looked broken. Issue #52 in
 * `teambtcmap/btcmap-api` clarified that v4 returns only `{id}` by
 * default and tags must be requested individually with a source
 * prefix (e.g. `osm:payment:lightning`). With the explicit field list
 * below v4 is the right transport: one global fetch, week-long cache,
 * no bbox param (filter client-side). Stable, no rate-limit pain, no
 * Overpass-mirror roulette.
 *
 * Closes part of #467.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const BTCMAP_V4_PLACES_URL = 'https://api.btcmap.org/v4/places';

// v4 returns one prefixed field per requested OSM key. The prefix
// (`osm:`) names the upstream data source — v4 is designed to fuse
// multiple sources later, so the prefix is required even when only
// OSM is in play. We pull every tag a caller in this codebase reads,
// plus `verified_at` for the "Verified N days ago" UI hint.
const V4_FIELDS = [
  'id',
  'lat',
  'lon',
  'verified_at',
  'osm:name',
  'osm:addr:street',
  'osm:addr:city',
  'osm:addr:postcode',
  'osm:payment:bitcoin',
  'osm:payment:lightning',
  'osm:payment:lightning_contactless',
  'osm:payment:onchain',
  'osm:contact:phone',
  'osm:contact:website',
  'osm:contact:email',
  'osm:payment:lightning_address',
  'osm:lud16',
].join(',');

const FETCH_TIMEOUT_MS = 45_000;
const DATASET_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
// AsyncStorage key — namespaced so it's grepable + obviously
// invalidatable from devtools. A single global dataset cache; v4 has
// no bbox parameter so we fetch the whole world and filter in memory.
const DATASET_STORAGE_KEY = '@lp:btcmap-dataset-v4';

export interface BtcMapPlace {
  id: number;
  lat: number;
  lon: number;
  /** OSM tags pulled through (un-prefixed). We surface the shape we
   * care about and leave the rest as Record so callers can dig for
   * additional keys. */
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

interface CachedDataset {
  fetchedAt: number;
  places: BtcMapPlace[];
}

/**
 * Bounding box in `[minLon, minLat, maxLon, maxLat]` order. Matches the
 * GeoJSON convention. (BTC Map v4 has no bbox parameter — this is used
 * for client-side filtering of the cached dataset.)
 */
export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

let memoryDataset: CachedDataset | null = null;

const isFresh = (entry: CachedDataset): boolean => Date.now() - entry.fetchedAt < DATASET_TTL_MS;

const inBbox = (p: BtcMapPlace, b: Bbox): boolean =>
  p.lon >= b.minLon && p.lon <= b.maxLon && p.lat >= b.minLat && p.lat <= b.maxLat;

// v4 returns each tag as `osm:<key>` at the top level. Reshape into the
// historical `BtcMapPlace.tags` map so downstream code (acceptsLightning,
// formatAddress, etc.) keeps working without per-call rewrites.
const reshape = (raw: Record<string, unknown>): BtcMapPlace | null => {
  const id = raw['id'];
  const lat = raw['lat'];
  const lon = raw['lon'];
  if (typeof id !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') return null;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('osm:')) tags[k.slice(4)] = v;
  }
  const verified_at = typeof raw['verified_at'] === 'string' ? (raw['verified_at'] as string) : null;
  return { id, lat, lon, tags, verified_at };
};

// One-shot AsyncStorage hydration. Runs on first `fetchPlacesInBbox`
// call, not at module load, because RN evaluates this file early in
// the bundle and AsyncStorage's native module may not be ready yet.
let hydratePromise: Promise<void> | null = null;
const hydrateFromStorage = async (): Promise<void> => {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(DATASET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CachedDataset;
      if (parsed && Array.isArray(parsed.places) && isFresh(parsed)) {
        memoryDataset = parsed;
      }
    } catch {
      // Corrupt or unreadable storage shouldn't break merchant fetch —
      // we'll just hit v4 and re-persist on success.
    }
  })();
  return hydratePromise;
};

const persistToStorage = (dataset: CachedDataset): void => {
  AsyncStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(dataset)).catch(() => {});
};

// Fetch the full v4 dataset with our explicit field list, reshape into
// BtcMapPlace, cache. v4 has no bbox param so this pull is global —
// roughly 28k places, ~3 MB JSON. Fine for a weekly refresh.
const fetchDataset = async (): Promise<CachedDataset> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${BTCMAP_V4_PLACES_URL}?fields=${encodeURIComponent(V4_FIELDS)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`BTC Map v4 ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>[];
    const places = (Array.isArray(json) ? json : [])
      .map(reshape)
      .filter((p): p is BtcMapPlace => p !== null);
    const dataset: CachedDataset = { fetchedAt: Date.now(), places };
    memoryDataset = dataset;
    persistToStorage(dataset);
    return dataset;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch merchants in a bounding box. Returns cached results if the
 * global dataset is still fresh; otherwise refreshes from v4 and then
 * filters. Caller should debounce on map-pan/zoom so we're not
 * re-filtering on every gesture frame (the filter itself is O(n)
 * over ~28k items — millisecond-fast, but still worth debouncing).
 */
export const fetchPlacesInBbox = async (bbox: Bbox): Promise<BtcMapPlace[]> => {
  await hydrateFromStorage();
  const dataset = memoryDataset && isFresh(memoryDataset) ? memoryDataset : await fetchDataset();
  return dataset.places.filter((p) => inBbox(p, bbox));
};

/**
 * Resolve a Lightning Address from a place's OSM tags. Tries common
 * tag variants in order; returns null if none present.
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
 * Test-only escape hatch — the in-memory dataset survives across
 * unit-test invocations otherwise.
 */
export const __resetCacheForTest = (): void => {
  memoryDataset = null;
  hydratePromise = null;
  // Also wipe the persisted copy — otherwise the next test hydrates
  // from AsyncStorage and never reaches the mocked fetch path.
  AsyncStorage.removeItem(DATASET_STORAGE_KEY).catch(() => {});
};
