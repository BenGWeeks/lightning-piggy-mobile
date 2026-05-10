/**
 * BTC Map HTTP client. Read-only consumer of api.btcmap.org/v3 — the
 * community-maintained directory of Bitcoin-accepting merchants, backed by
 * OpenStreetMap. We never write back; merchant data lives in the OSM
 * commons (see project memory `BTC Map runs the commons (Nathan)`).
 *
 * Closes part of #467.
 */

const BTCMAP_BASE = 'https://api.btcmap.org/v3';
const FETCH_TIMEOUT_MS = 10_000;
const TILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

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
const tileKey = (bbox: Bbox): string =>
  [
    bbox.minLon.toFixed(4),
    bbox.minLat.toFixed(4),
    bbox.maxLon.toFixed(4),
    bbox.maxLat.toFixed(4),
  ].join(',');

const tileCache = new Map<string, CachedTile>();

const isFresh = (entry: CachedTile): boolean => Date.now() - entry.fetchedAt < TILE_CACHE_TTL_MS;

/**
 * Fetch merchants in a bounding box. Returns cached results if a recent
 * fetch covered the same key. Caller should debounce on map-pan/zoom so
 * we're not hammering the API on every gesture frame.
 */
export const fetchPlacesInBbox = async (bbox: Bbox): Promise<BtcMapPlace[]> => {
  const key = tileKey(bbox);
  const cached = tileCache.get(key);
  if (cached && isFresh(cached)) {
    return cached.places;
  }

  const url =
    `${BTCMAP_BASE}/places?bbox=` + [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].join(',');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`BTC Map ${res.status}: ${res.statusText}`);
    }
    const places = (await res.json()) as BtcMapPlace[];
    tileCache.set(key, { fetchedAt: Date.now(), places });
    return places;
  } finally {
    clearTimeout(timer);
  }
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
};
