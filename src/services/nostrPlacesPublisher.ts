import type { Event as NostrEvent, Filter, VerifiedEvent } from 'nostr-tools';
import { DEFAULT_RELAYS, pool, publishSignedEvent } from './nostrService';
import {
  GC_COMMENT_KIND,
  GC_FOUND_LOG_KIND,
  GC_LISTING_KIND,
  NIP52_TIME_BASED_KIND,
  parseCache,
  parseNip52Event,
  type ParsedCache,
  type ParsedEvent,
} from './nostrPlacesService';

/** Structural shape of an event as returned by NostrContext.signEvent —
 * matches VerifiedEvent's data fields without the runtime brand symbol
 * nostr-tools attaches after `finalizeEvent`. publishSignedEvent
 * re-casts internally so the brand mismatch is harmless. */
export interface SignedEventLike {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Runtime-only side of NIP-GC publish/subscribe. Lives separately from
 * `nostrPlacesService.ts` (the pure builders / parsers / predicates) so
 * jest can transform the pure module without tripping over
 * `nostr-tools/pool`'s ESM-only entry. Production code reaches the
 * publisher through this module; tests only need the pure side.
 */

export const publishCacheEvent = async (
  signed: SignedEventLike,
  relays: string[] = DEFAULT_RELAYS,
): Promise<void> => publishSignedEvent(signed, relays);

/**
 * Subscribe to nearby caches by geohash prefix. `prefixes` should
 * come from `geohashPrefixes(currentGh, 5)` — yields a single filter
 * returning 37516 events whose `g` tag starts with any prefix (both
 * LP Piggies AND treasures.to / TapTheSatsMap caches; caller branches
 * on `parsed.isLpPiggy` to render the 🐷 vs 📍 pin distinction).
 *
 * Returns a closer; call it to terminate the subscription.
 */
export const subscribeNearbyCaches = (
  prefixes: string[],
  onEvent: (cache: ParsedCache) => void,
  relays: string[] = DEFAULT_RELAYS,
  filterExtras: Partial<Filter> = {},
): (() => void) => {
  if (prefixes.length === 0) return () => {};
  const filter: Filter = {
    kinds: [GC_LISTING_KIND],
    '#g': prefixes,
    ...filterExtras,
  };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: NostrEvent) => {
      const parsed = parseCache(e as VerifiedEvent);
      if (parsed) onEvent(parsed);
    },
  });
  return () => sub.close();
};

export const subscribeFoundLogs = (
  cacheCoord: string,
  onEvent: (event: VerifiedEvent) => void,
  relays: string[] = DEFAULT_RELAYS,
): (() => void) => {
  const filter: Filter = { kinds: [GC_FOUND_LOG_KIND], '#a': [cacheCoord] };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: NostrEvent) => onEvent(e as VerifiedEvent),
  });
  return () => sub.close();
};

export const subscribeComments = (
  cacheCoord: string,
  onEvent: (event: VerifiedEvent) => void,
  relays: string[] = DEFAULT_RELAYS,
): (() => void) => {
  const filter: Filter = { kinds: [GC_COMMENT_KIND], '#A': [cacheCoord] };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: NostrEvent) => onEvent(e as VerifiedEvent),
  });
  return () => sub.close();
};

/**
 * Subscribe to nearby NIP-52 calendar events (kind 31923) by geohash
 * prefix. Mirrors `subscribeNearbyCaches` for the Events sub-screen.
 * Returns a closer.
 */
export const subscribeNearbyEvents = (
  prefixes: string[],
  onEvent: (parsed: ParsedEvent) => void,
  relays: string[] = DEFAULT_RELAYS,
): (() => void) => {
  if (prefixes.length === 0) return () => {};
  const filter: Filter = {
    kinds: [NIP52_TIME_BASED_KIND],
    '#g': prefixes,
  };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: NostrEvent) => {
      const parsed = parseNip52Event(e as VerifiedEvent);
      if (parsed) onEvent(parsed);
    },
  });
  return () => sub.close();
};

/**
 * One-shot fetch of the latest revision of a single cache. Used by
 * HuntPiggyDetailScreen on mount when the user navigates from a
 * `nostr:naddr` deep-link or a Discover tap.
 */
export const fetchCache = async (
  hiderPubkey: string,
  d: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<ParsedCache | null> => {
  const events = await pool.querySync(relays, {
    kinds: [GC_LISTING_KIND],
    authors: [hiderPubkey],
    '#d': [d],
  });
  if (events.length === 0) return null;
  // Sort created_at desc — replaceable, latest wins; defensive vs
  // a misbehaving relay returning multiple revisions.
  events.sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at);
  return parseCache(events[0] as VerifiedEvent);
};
