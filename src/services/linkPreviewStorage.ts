// AsyncStorage-backed cache for OG link-preview metadata (#441).
//
// Mirrors the patterns established by `zapSenderProfileStorage`:
//   - in-memory mirror so reads after first hydration are sync-fast,
//   - single JSON blob in AsyncStorage,
//   - LRU-style cap so the blob can't grow unbounded,
//   - 24-hour TTL on read so stale-but-not-catastrophic OG metadata
//     (article retitle, image swap) doesn't stick forever.
//
// Cache key strips URL query params and fragments so UTM-tagged variants
// of the same article share one entry — `?utm_source=twitter` vs
// `?utm_source=primal` should not double the cache footprint.
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'link_previews_v1';

const TTL_MS = 24 * 60 * 60 * 1000;

// Each entry is bigger than a profile blob (description text + image URL
// + favicon URL), so cap lower than zapSenderProfile's 500 — 200 keeps
// the persisted JSON under ~150 KB in the worst case.
const MAX_ENTRIES = 200;

export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  siteName: string | null;
  domain: string;
}

interface Entry {
  preview: LinkPreview;
  // Epoch ms when written — used for TTL filtering AND LRU eviction.
  savedAt: number;
}

type CacheShape = Record<string, Entry>;

let memoryCache: CacheShape | null = null;

// Strip query and hash fragments from the URL so utm-tagged variants
// don't fragment the cache. Returns the original string when parsing
// fails (defensive — never throw on malformed input).
export function cacheKeyFor(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function load(): Promise<CacheShape> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as CacheShape) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function persist(cache: CacheShape): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage failure is non-fatal — the in-memory mirror still serves
    // the rest of this session, and the worst case is a re-fetch on
    // next launch.
  }
}

// Lookup a cached preview. Returns null when missing or when the cached
// entry has aged past TTL_MS.
export async function get(url: string): Promise<LinkPreview | null> {
  if (!url) return null;
  const cache = await load();
  const entry = cache[cacheKeyFor(url)];
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) return null;
  return entry.preview;
}

// Write-through after a successful OG fetch. Evicts the oldest entries
// when the cache crosses MAX_ENTRIES.
export async function set(url: string, preview: LinkPreview): Promise<void> {
  if (!url || !preview) return;
  const cache = await load();
  cache[cacheKeyFor(url)] = { preview, savedAt: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    // Sort by savedAt ascending → drop the oldest until we're back under cap.
    const sorted = keys.map((k) => [k, cache[k].savedAt] as const).sort((a, b) => a[1] - b[1]);
    const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const [k] of drop) delete cache[k];
  }

  await persist(cache);
}

// Test-only: wipe the in-memory cache so reloads re-read from storage.
export function __resetForTests(): void {
  memoryCache = null;
}

// Test-only: expose constants for parameterised tests.
export const __TEST__ = { TTL_MS, MAX_ENTRIES, STORAGE_KEY };
