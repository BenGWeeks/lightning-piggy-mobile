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
  // [PerfBlock] event-burst accounting — relay onevent fires
  // synchronously per arriving event; a burst of 50+ on screen mount
  // can pin the JS thread for seconds while each parseCache + the
  // caller's setCaches map-clone run back-to-back. We aggregate
  // cumulative wall-clock and log every 10 events so logcat shows
  // both the *count* and *cost* of the burst, then a final summary
  // 250 ms after the last event arrives (idle window). #554.
  let __burstCount = 0;
  let __burstMs = 0;
  let __burstFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const __flushBurst = (): void => {
    if (__burstCount === 0) return;
    console.log(
      `[PerfBlock] subscribeNearbyCaches burst: ${__burstCount} events in ${Math.round(__burstMs)}ms`,
    );
    __burstCount = 0;
    __burstMs = 0;
    __burstFlushTimer = null;
  };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: NostrEvent) => {
      const __t0 = performance.now();
      const parsed = parseCache(e as VerifiedEvent);
      if (parsed) onEvent(parsed);
      __burstMs += performance.now() - __t0;
      __burstCount += 1;
      if (__burstCount % 10 === 0) {
        console.log(
          `[PerfBlock] subscribeNearbyCaches: ${__burstCount} events, ${Math.round(__burstMs)}ms cumulative`,
        );
      }
      if (__burstFlushTimer) clearTimeout(__burstFlushTimer);
      __burstFlushTimer = setTimeout(__flushBurst, 250);
    },
  });
  return () => {
    if (__burstFlushTimer) clearTimeout(__burstFlushTimer);
    sub.close();
  };
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

// Subscribe to every kind 7516 found-log published by a given author
// (set). MyPigletsScreen uses this twice: once with `[myPubkey]` for
// the "Found" section and once with the WoT-trusted set (minus me) for
// "Friends' finds". Empty list short-circuits — relays reject empty
// `authors` filters as a free-firehose request.
export const subscribeFoundLogsByAuthors = (
  authors: string[],
  onEvent: (event: VerifiedEvent) => void,
  relays: string[] = DEFAULT_RELAYS,
): (() => void) => {
  if (authors.length === 0) return () => {};
  const filter: Filter = { kinds: [GC_FOUND_LOG_KIND], authors };
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
 * Subscribe to nearby NIP-52 calendar events. **Runs two parallel
 * subscriptions and unions the results** because filtering by `g`
 * tag alone is too restrictive in 2026 — most NIP-52 publishers
 * (notably OrangePillApp, the dominant Bitcoin-meetup source) don't
 * add `g` tags consistently. We complement the geohash sub with a
 * hashtag sub on `#t in [bitcoin, lightning, meetup]` so topical
 * matches surface even without a geohash. The caller's `onEvent`
 * fires once per unique event; downstream code already de-dupes
 * by coord so the union is safe.
 *
 * @param prefixes  geohash prefixes for the nearby filter
 * @param topicTags lowercased hashtag list for the topical filter
 *                  (default ['bitcoin','lightning','meetup'])
 * @param onEvent   called per parsed event
 */
// [PerfBlock] same shape as subscribeNearbyCaches above — bracket
// the event burst so we can see if NIP-52 floods are contributing
// to the post-mount freezes. #554.
export const subscribeNearbyEvents = (
  prefixes: string[],
  onEvent: (parsed: ParsedEvent) => void,
  relays: string[] = DEFAULT_RELAYS,
  topicTags: string[] = ['bitcoin', 'lightning', 'meetup'],
): (() => void) => {
  const closers: Array<() => void> = [];

  // (1) Geohash-prefix filter — nearby events (the original behaviour).
  if (prefixes.length > 0) {
    const geoFilter: Filter = { kinds: [NIP52_TIME_BASED_KIND], '#g': prefixes };
    const geoSub = pool.subscribeMany(relays, geoFilter, {
      onevent: (e: NostrEvent) => {
        const parsed = parseNip52Event(e as VerifiedEvent);
        if (parsed) onEvent(parsed);
      },
    });
    closers.push(() => geoSub.close());
  }

  // (2) Topical-hashtag filter — Bitcoin-tagged events anywhere on
  // the planet, including ones with no `g` tag. Capacity-bounded via
  // `limit` so the union doesn't drown the UI on relays that return
  // years of history.
  if (topicTags.length > 0) {
    const tagFilter: Filter = {
      kinds: [NIP52_TIME_BASED_KIND],
      '#t': topicTags,
      limit: 200,
    };
    const tagSub = pool.subscribeMany(relays, tagFilter, {
      onevent: (e: NostrEvent) => {
        const parsed = parseNip52Event(e as VerifiedEvent);
        if (parsed) onEvent(parsed);
      },
    });
    closers.push(() => tagSub.close());
  }

  return () => closers.forEach((c) => c());
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

/**
 * One-shot lookup for a single NIP-52 calendar event by coord. Used by
 * EventDetailScreen on mount when the event isn't in the AsyncStorage
 * mirror (deep-link, Share / Linking handoff). Without this fallback the
 * screen settles on a permanent "This event isn't in our local feed"
 * empty state — Copilot review on PR #488 flagged the regression.
 */
export const fetchEvent = async (
  organiserPubkey: string,
  d: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<ParsedEvent | null> => {
  const events = await pool.querySync(relays, {
    kinds: [NIP52_TIME_BASED_KIND],
    authors: [organiserPubkey],
    '#d': [d],
  });
  if (events.length === 0) return null;
  events.sort((a: NostrEvent, b: NostrEvent) => b.created_at - a.created_at);
  return parseNip52Event(events[0] as VerifiedEvent);
};
