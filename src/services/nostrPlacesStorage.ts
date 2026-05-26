import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParsedCache, ParsedEvent } from './nostrPlacesService';
import { isDevLeftover } from './devEventDenylist';

/**
 * AsyncStorage-backed cache of resolved NIP-GC kind 37516 cache
 * listings and NIP-52 kind 31923 events. Mirrors the BTC Map dataset
 * cache pattern (in-memory mirror, single JSON blob, capped size, TTL
 * read) so cold starts can show last-known content immediately while
 * live relay subscriptions backfill.
 *
 * Why bother? Live relay subs deliver fresh events fast (hundreds of
 * ms) but the user sees a blank rail for that gap. Persisting the last
 * stream lets us paint instantly and update in place as new events
 * land — the same pattern PR #508 used for NIP-17 DM wrap IDs.
 */

const CACHES_STORAGE_KEY = '@lp:nostr-caches-v1';
const EVENTS_STORAGE_KEY = '@lp:nostr-events-v1';
// 7-day TTL — caches / events drift slowly, and the live sub
// authoritatively backfills as soon as the user lands on the rail. A
// week stops the on-disk blob from drifting forever; longer than that
// and you risk holding expired cache listings indefinitely.
const TTL_MS = 7 * 24 * 60 * 60 * 1_000;
// LRU cap so the persisted blob can't grow unbounded. Most users will
// see <200 events / caches in their geohash window; 500 covers heavy
// urban usage with room to spare while keeping the blob well under
// ~200 KB.
const MAX_ENTRIES = 500;

interface CachedShape<T> {
  fetchedAt: number;
  items: T[];
}

let memCaches: CachedShape<ParsedCache> | null = null;
let memEvents: CachedShape<ParsedEvent> | null = null;
let hydratePromise: Promise<void> | null = null;

const isFresh = (entry: CachedShape<unknown> | null): boolean =>
  !!entry && Date.now() - entry.fetchedAt < TTL_MS;

const hydrate = async (): Promise<void> => {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const [cachesRaw, eventsRaw] = await Promise.all([
        AsyncStorage.getItem(CACHES_STORAGE_KEY),
        AsyncStorage.getItem(EVENTS_STORAGE_KEY),
      ]);
      // Re-apply the dev-leftover denylist on read: the ingestion-layer
      // filter (nostrPlacesPublisher) only blocks new events, so blobs
      // persisted before a signer was denylisted still carry it and
      // would paint on cold start otherwise (#699). When we drop any, also
      // rewrite the sanitized blob (fire-and-forget) so the on-disk copy is
      // actually cleaned rather than re-filtered on every cold start.
      if (cachesRaw) {
        const parsed = JSON.parse(cachesRaw) as CachedShape<ParsedCache>;
        if (Array.isArray(parsed.items) && isFresh(parsed)) {
          const before = parsed.items.length;
          parsed.items = parsed.items.filter((c) => !isDevLeftover(c.hiderPubkey));
          memCaches = parsed;
          if (parsed.items.length < before) {
            AsyncStorage.setItem(CACHES_STORAGE_KEY, JSON.stringify(parsed)).catch(() => {});
          }
        }
      }
      if (eventsRaw) {
        const parsed = JSON.parse(eventsRaw) as CachedShape<ParsedEvent>;
        if (Array.isArray(parsed.items) && isFresh(parsed)) {
          const before = parsed.items.length;
          parsed.items = parsed.items.filter((e) => !isDevLeftover(e.organiserPubkey));
          memEvents = parsed;
          if (parsed.items.length < before) {
            AsyncStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(parsed)).catch(() => {});
          }
        }
      }
    } catch {
      // Best-effort hydrate — corrupted blobs are silently ignored so
      // the next live sub repopulates the cache cleanly.
    }
  })();
  return hydratePromise;
};

export const loadCachedCaches = async (): Promise<ParsedCache[]> => {
  await hydrate();
  return memCaches?.items ?? [];
};

export const loadCachedEvents = async (): Promise<ParsedEvent[]> => {
  await hydrate();
  return memEvents?.items ?? [];
};

/**
 * Synchronous peek at the in-memory mirror. Returns an empty array if
 * hydrate() hasn't finished yet — callers should use this for the
 * useState initial-value path (so a warm app session pre-paints
 * cached data) and fall back to the async loader in a useEffect for
 * the cold-start path.
 */
export const peekCachedCachesSync = (): ParsedCache[] => memCaches?.items ?? [];
export const peekCachedEventsSync = (): ParsedEvent[] => memEvents?.items ?? [];

// Kick off hydration the moment the module is imported so the first
// useState init in a child component has a populated `memCaches` to
// read. Best-effort — failures fall through silently.
void hydrate();

// Capped, write-through replace. Callers pass the current full Map
// after a live-sub update; we slice to MAX_ENTRIES (newest by
// createdAt / startsAt) and persist. Write is fire-and-forget — the
// in-memory state stays authoritative for the current session.
export const saveCaches = (caches: ReadonlyArray<ParsedCache>): void => {
  const sorted = [...caches]
    .filter((c) => !isDevLeftover(c.hiderPubkey))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
  const next: CachedShape<ParsedCache> = { fetchedAt: Date.now(), items: sorted };
  memCaches = next;
  AsyncStorage.setItem(CACHES_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
};

export const saveEvents = (events: ReadonlyArray<ParsedEvent>): void => {
  // Events sort by start time so the newest-upcoming surface first
  // when we hydrate.
  const sorted = [...events]
    .filter((e) => !isDevLeftover(e.organiserPubkey))
    .sort((a, b) => (b.startsAt ?? 0) - (a.startsAt ?? 0))
    .slice(0, MAX_ENTRIES);
  const next: CachedShape<ParsedEvent> = { fetchedAt: Date.now(), items: sorted };
  memEvents = next;
  AsyncStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
};

export const clearCacheStorage = async (): Promise<void> => {
  memCaches = null;
  memEvents = null;
  hydratePromise = null;
  try {
    await Promise.all([
      AsyncStorage.removeItem(CACHES_STORAGE_KEY),
      AsyncStorage.removeItem(EVENTS_STORAGE_KEY),
    ]);
  } catch {
    // Best-effort wipe — next hydrate sees the empty in-memory state.
  }
};
