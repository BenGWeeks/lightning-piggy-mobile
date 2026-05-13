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
import { File, Paths } from 'expo-file-system';

const BTCMAP_V4_PLACES_URL = 'https://api.btcmap.org/v4/places';

// Slim field list for the bulk dataset fetch. Pulled fields are
// strictly what the list / rail / map markers need:
//   - id / lat / lon : required by reshape
//   - osm:name : title (also used by the PlacesScreen search index)
//   - icon : rail glyph
//   - boosted_until : sort tie-break + "Featured" badge
//   - categories : PlacesScreen category-chip filter + search index
//   - osm:payment:lightning + osm:payment:bitcoin : payment chip
//   - osm:addr:street + osm:addr:city : address line + search index
//
// Rich fields (verified_at, lightning_address, cuisine, wheelchair,
// contact:*, opening_hours, etc.) land on PlaceDetail via a per-id
// lazy fetch (see fetchPlaceRich). Trimming this list cut the bulk
// response from ~22 MB / 7 s → ~5 MB / ~2 s on cold launch — see
// scripts/perf-explore-cold-start.sh.
const V4_FIELDS = [
  'id',
  'lat',
  'lon',
  'icon',
  'boosted_until',
  'categories',
  'osm:name',
  'osm:payment:lightning',
  'osm:payment:bitcoin',
  'osm:addr:street',
  'osm:addr:city',
].join(',');

// Rich field list — used by the per-id fetch from PlaceDetail. Mirrors
// what the detail screen actually renders (cuisine, wheelchair, contact
// links, opening hours, etc.).
const V4_FIELDS_RICH = [
  'id',
  'lat',
  'lon',
  'verified_at',
  'description',
  'icon',
  'osm_url',
  'categories',
  'boosted_until',
  'comments_count',
  'osm:cuisine',
  'osm:wheelchair',
  'osm:wheelchair:description',
  'osm:takeaway',
  'osm:delivery',
  'osm:outdoor_seating',
  'osm:brand',
  'osm:level',
  'osm:addr:floor',
  'osm:contact:twitter',
  'osm:contact:instagram',
  'osm:contact:telegram',
  'osm:contact:whatsapp',
  'phone',
  'email',
  'opening_hours',
  'osm:contact:facebook',
  'osm:name',
  'osm:description',
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
  'osm:opening_hours',
  'osm:payment:lightning_address',
  'osm:lud16',
  'created_at',
  'updated_at',
].join(',');

const FETCH_TIMEOUT_MS = 45_000;
const DATASET_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
// AsyncStorage key — namespaced so it's grepable + obviously
// invalidatable from devtools. A single global dataset cache; v4 has
// no bbox parameter so we fetch the whole world and filter in memory.
// Bumped to `v4s` (slim) when the bulk fetch was trimmed to list-only
// fields; legacy v4i caches are ignored on hydrate.
const DATASET_STORAGE_KEY = '@lp:btcmap-dataset-v4t';

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
    opening_hours?: string;
  };
  /**
   * Last time a community member confirmed the merchant still accepts
   * Bitcoin. Surfaced as "Verified N days ago" in MerchantDetail.
   */
  verified_at?: string | null;
  /**
   * Free-text summary of the merchant. BTC Map curates this when set;
   * otherwise we fall back to the OSM `description` tag. Empty string
   * is normalised to null so the UI can branch on truthiness cleanly.
   */
  description?: string | null;
  /**
   * BTC Map's curated category glyph name — e.g. `storefront`, `chalet`,
   * `cafe`, `bar`, `lodging`. Used by the UI to pick a matching Lucide
   * icon for the place row / detail header. Null when BTC Map hasn't
   * categorised the merchant.
   */
  icon?: string | null;
  /**
   * Direct link to the merchant's OpenStreetMap node. Surfaced as a
   * "Suggest an edit on OpenStreetMap →" affordance — the OSM web UI
   * is the canonical place to fix bad tags / addresses / payment flags.
   */
  osm_url?: string | null;
  /**
   * BTC Map's curated category list (e.g. `["cafe", "restaurant"]`).
   * Comes back empty for many listings — BTC Map only populates this
   * when their taxonomy team has classified the merchant.
   */
  categories?: string[] | null;
  /**
   * Top-level curated contact fields. BTC Map normalises these from
   * OSM + their own hand-fills, so we prefer them over `tags['contact:*']`
   * (which is often empty even when the curated field is set). Null when
   * not provided.
   */
  phone?: string | null;
  email?: string | null;
  opening_hours?: string | null;
  /**
   * Social profile URLs pulled from OSM `contact:<network>` tags.
   * Surfaced as a chip row on the contact section. Each is optional
   * and often null. `tags['contact:<network>']` carries the same value
   * if a caller would rather read straight from the bag.
   */
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  whatsappUrl?: string | null;
  /**
   * Unix-seconds timestamps for the listing lifecycle. Surfaced as
   * "Listed since" / "Last updated" hints on the detail page.
   */
  createdAt?: string | null;
  updatedAt?: string | null;
  /**
   * ISO timestamp until which the listing is "boosted" — BTC Map's
   * paid-feature mechanism. Surfaced as a "Featured" pill + a sort
   * tie-break (boosted wins within the same distance band).
   */
  boostedUntil?: string | null;
  /**
   * Number of community notes attached to the merchant on BTC Map.
   * Currently surfaced as a copy line ("N community notes"); could
   * link out to BTC Map's comments page in a follow-up.
   */
  commentsCount?: number | null;
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
  const verified_at =
    typeof raw['verified_at'] === 'string' ? (raw['verified_at'] as string) : null;
  // Prefer the curated top-level description; fall back to the raw OSM
  // tag if BTC Map hasn't normalised one for this place. Trim and treat
  // empty strings as missing.
  const rawDesc =
    typeof raw['description'] === 'string'
      ? (raw['description'] as string)
      : typeof tags['description'] === 'string'
        ? tags['description']
        : null;
  const description = rawDesc && rawDesc.trim().length > 0 ? rawDesc.trim() : null;
  const icon = typeof raw['icon'] === 'string' ? (raw['icon'] as string) : null;
  const osm_url = typeof raw['osm_url'] === 'string' ? (raw['osm_url'] as string) : null;
  const categories = Array.isArray(raw['categories'])
    ? (raw['categories'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : null;
  // Curated top-level fields > OSM-prefixed tag fallbacks. BTC Map
  // ships these only when their team or the OSM tag has them populated;
  // an empty string is normalised to null so the UI can branch cleanly.
  const pickStr = (k: string): string | null => {
    const v = raw[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return null;
  };
  const phone = pickStr('phone') ?? tags['contact:phone'] ?? null;
  const email = pickStr('email') ?? tags['contact:email'] ?? null;
  const opening_hours = pickStr('opening_hours') ?? tags['opening_hours'] ?? null;
  const facebookUrl = tags['contact:facebook'] ?? null;
  const twitterUrl = tags['contact:twitter'] ?? null;
  const instagramUrl = tags['contact:instagram'] ?? null;
  const telegramUrl = tags['contact:telegram'] ?? null;
  const whatsappUrl = tags['contact:whatsapp'] ?? null;
  const commentsCount =
    typeof raw['comments_count'] === 'number' ? (raw['comments_count'] as number) : null;
  const createdAt = pickStr('created_at');
  const updatedAt = pickStr('updated_at');
  const boostedUntil = pickStr('boosted_until');
  return {
    id,
    lat,
    lon,
    tags,
    verified_at,
    description,
    icon,
    osm_url,
    categories,
    phone,
    email,
    opening_hours,
    facebookUrl,
    twitterUrl,
    instagramUrl,
    telegramUrl,
    whatsappUrl,
    createdAt,
    updatedAt,
    boostedUntil,
    commentsCount,
  };
};

// File-system path for the cached dataset. AsyncStorage uses SQLite on
// Android with a per-row size limit (~2 MB practical, hard fail beyond)
// — the v4i dataset is ~22 MB so every persist was silently failing
// with SQLITE_FULL. Writing to the document sandbox via
// expo-file-system has no such limit and survives app upgrades.
const datasetFile = () => new File(Paths.document, 'btcmap-dataset-v4t.json');

// One-shot hydration. Runs on first `fetchPlacesInBbox` call, not at
// module load, because RN evaluates this file early in the bundle and
// the file-system module may not be ready yet.
let hydratePromise: Promise<void> | null = null;
const hydrateFromStorage = async (): Promise<void> => {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const f = datasetFile();
      if (!f.exists) {
        // Best-effort migration: if a prior install somehow squeezed
        // the dataset into AsyncStorage, honour it once then drop the
        // key so we stop poking SQLite for nothing on subsequent boots.
        const legacy = await AsyncStorage.getItem(DATASET_STORAGE_KEY).catch(() => null);
        if (legacy) {
          const parsed = JSON.parse(legacy) as CachedDataset;
          if (parsed && Array.isArray(parsed.places) && isFresh(parsed)) memoryDataset = parsed;
          AsyncStorage.removeItem(DATASET_STORAGE_KEY).catch(() => {});
        }
        return;
      }
      const raw = await f.text();
      const parsed = JSON.parse(raw) as CachedDataset;
      // Only populate memoryDataset if it's still empty — a parallel
      // network fetch may have raced ahead with fresher data.
      if (!memoryDataset && parsed && Array.isArray(parsed.places) && isFresh(parsed)) {
        memoryDataset = parsed;
      }
    } catch {
      // Corrupt or unreadable cache shouldn't break the merchant fetch —
      // we'll just hit v4 and re-persist on success.
    }
  })();
  return hydratePromise;
};

const persistToStorage = (dataset: CachedDataset): void => {
  try {
    const f = datasetFile();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(dataset));
  } catch {
    // Persist failures are non-fatal — memoryDataset still serves the
    // rest of the session, next launch will re-fetch over the network.
  }
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
  // Race: hydrate-from-disk vs network-fetch. Whichever populates
  // memoryDataset first wins.
  //
  // On Android, `File.text()` on the 13 MB slim cache blocks the JS
  // thread for ~19 s — slower than a fresh `fetchDataset` call (~7 s
  // network + ~400 ms JSON.parse). So we never `await` hydrate inside
  // the bbox call: `prefetchDataset()` (called on ExploreHome mount)
  // kicked it off in the background, and if it landed in time we use
  // it; otherwise we go straight to the network. Hydrate still settles
  // eventually and is useful for the offline-cold-start path (no
  // network), but never blocks the fast path.
  if (memoryDataset && isFresh(memoryDataset)) {
    return memoryDataset.places.filter((p) => inBbox(p, bbox));
  }
  const dataset = await fetchDataset();
  return dataset.places.filter((p) => inBbox(p, bbox));
};

/**
 * Fast path for screens that already know a `placeId` — checks the
 * in-memory dataset first, then hydrates from AsyncStorage, then
 * (last resort) refetches. Avoids the 28k-row filter+find that
 * PlaceDetailScreen was doing just to look up a single id.
 */
export const fetchPlaceById = async (id: number): Promise<BtcMapPlace | null> => {
  // Hot path — id already in the memory dataset.
  if (memoryDataset) {
    const hit = memoryDataset.places.find((p) => p.id === id);
    if (hit) return hit;
  }
  await hydrateFromStorage();
  if (memoryDataset) {
    const hit = memoryDataset.places.find((p) => p.id === id);
    if (hit) return hit;
  }
  // Cold path — pull the dataset and try once more.
  const dataset = memoryDataset && isFresh(memoryDataset) ? memoryDataset : await fetchDataset();
  return dataset.places.find((p) => p.id === id) ?? null;
};

/**
 * Resolve a Lightning Address from a place's OSM tags. Tries common
 * tag variants in order; returns null if none present.
 */
export const lightningAddressOf = (place: BtcMapPlace): string | null =>
  place.tags['payment:lightning_address'] ?? place.tags.lud16 ?? null;

/**
 * Fetch the rich field set for a single place by id. PlaceDetail
 * opens with the slim listing already in memory, then overlays the
 * rich shape (cuisine, contact links, opening_hours, …) onto it once
 * this resolves. Returns null on any failure — the slim record is
 * still usable.
 */
export const fetchPlaceRich = async (id: number): Promise<BtcMapPlace | null> => {
  try {
    const url = `${BTCMAP_V4_PLACES_URL}/${id}?fields=${encodeURIComponent(V4_FIELDS_RICH)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return reshape(json);
  } catch {
    return null;
  }
};

/**
 * Extract the OSM `<type>:<id>` token (e.g. `node:12062799158`) from a
 * place's `osm_url`. BTC Map URL routes use this shape — both the
 * verify-location form and the merchant landing page expect it. Returns
 * null when the URL doesn't match (malformed entries, ways/relations
 * we don't yet support).
 */
const osmRef = (place: BtcMapPlace): string | null => {
  if (!place.osm_url) return null;
  const m = place.osm_url.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/i);
  return m ? `${m[1].toLowerCase()}:${m[2]}` : null;
};

/**
 * BTC Map's community-verification form. Submitting it flags the merchant
 * to a "Shadowy Supertagger" who then pushes the new `survey:date` /
 * `check_date` tag back to OpenStreetMap; BTC Map re-ingests OSM every
 * ~10 minutes so the verify date refreshes on its own.
 *
 * No auth needed in our app — we just hand off to the existing web form.
 */
export const btcMapVerifyUrl = (place: BtcMapPlace): string | null => {
  const ref = osmRef(place);
  return ref ? `https://btcmap.org/verify-location?id=${ref}` : null;
};

/**
 * Public BTC Map landing page for the merchant — friendlier UX than the
 * raw OSM node URL for non-OSM users, and surfaces the "Suggest an
 * edit" / "Verify" affordances BTC Map already builds.
 */
export const btcMapMerchantUrl = (place: BtcMapPlace): string | null => {
  const ref = osmRef(place);
  return ref ? `https://btcmap.org/merchant/${ref}` : null;
};

export const acceptsLightning = (place: BtcMapPlace): boolean =>
  place.tags['payment:lightning'] === 'yes' ||
  place.tags['payment:lightning_contactless'] === 'yes';

/**
 * True when the listing has paid BTC Map to feature it for a window
 * that hasn't expired yet. Drives the "Featured" pill + a tie-break
 * in distance-sorted lists.
 */
export const isBoosted = (place: BtcMapPlace): boolean => {
  if (!place.boostedUntil) return false;
  const t = Date.parse(place.boostedUntil);
  return Number.isFinite(t) && t > Date.now();
};

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

// Warm the in-memory dataset from AsyncStorage without making any
// network call. Cheap, fire-and-forget — used by ExploreHomeScreen on
// mount so the hydrate (which includes a multi-MB JSON.parse) runs in
// parallel with location resolution. By the time `fetchPlacesInBbox`
// is called for real, the hydrate promise is already settled and the
// `await` is instant. Without this, the first bbox call serialises
// AsyncStorage read + parse before returning, which the user sees as
// "Places loads slowly" even though the cache is in place.
export const prefetchDataset = (): void => {
  hydrateFromStorage().catch(() => {});
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

/**
 * Public force-refresh — invalidates the in-memory + persisted cache
 * and pulls a fresh dataset from BTC Map v4. Called from the
 * pull-to-refresh handler on the Explore hub so newly-boosted listings
 * (or fresh verifications) show up without waiting 7 days for the TTL
 * to expire. Resolves with the new dataset.
 */
export const refreshDataset = async (): Promise<void> => {
  memoryDataset = null;
  hydratePromise = null;
  try {
    await AsyncStorage.removeItem(DATASET_STORAGE_KEY);
  } catch {
    // Best-effort wipe — even if it fails the next `fetchPlacesInBbox`
    // sees `memoryDataset === null` and goes to the network.
  }
};
