import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import type { ParsedCache, ParsedFoundLog } from '../services/nostrPlacesService';
import { subscribeRecentCaches, subscribeRecentFoundLogs } from '../services/nostrPlacesPublisher';
import { useCoalescedMap } from '../utils/useCoalescedMap';
import { isHiddenInProd } from '../utils/exploreContentFilter';
import {
  rankFinders,
  rankHiders,
  sortRecentCaches,
  type LeaderboardEntry,
} from '../utils/huntLeaderboard';

/**
 * Data layer for the Geo-caches community sections (recently added /
 * recently found rails + hider / finder leaderboards). Opens two
 * relay subscriptions — global (non-geohash) kind-37516 listings and
 * kind-7516 found-logs — while the screen is focused, coalesces the
 * event bursts into two Maps, and derives the four presentation slices
 * with the pure helpers in `utils/huntLeaderboard`.
 *
 * Focus-gated via `useFocusEffect`: the Explore stack uses
 * `freezeOnBlur`, so a bare `useEffect` would leave these subs streaming
 * forever after the first visit (the same trap `HuntScreen`'s nearby sub
 * documents). Test-account (`isHiddenInProd`) events are dropped at
 * ingestion in production so they never reach the rails or boards.
 */

export interface HuntCommunityData {
  /** Newest-published caches, deduped + expired-dropped, for the rail. */
  recentCaches: ParsedCache[];
  /** All found-logs seen (deduped by id), newest-first. The Recently-found
   *  section applies the friends filter + slice on top of this. */
  finds: ParsedFoundLog[];
  /** coord → latest cache, so a find row can resolve its cache name/type. */
  cacheByCoord: Map<string, ParsedCache>;
  hiderLeaderboard: LeaderboardEntry[];
  finderLeaderboard: LeaderboardEntry[];
  /** True until the first settle window elapses (or data arrives). */
  loading: boolean;
}

const SETTLE_MS = 1500;
const RAIL_LIMIT = 12;
const BOARD_LIMIT = 10;

export const useHuntCommunity = (): HuntCommunityData => {
  const { relays } = useNostr();
  const [loading, setLoading] = useState(true);

  // Newest-wins per coord (replaceable listings); finds keyed by id and
  // never replaced (each find is its own social-feed row), capacity-bounded
  // so a long session can't grow the Map unboundedly.
  const {
    map: cachesMap,
    enqueue: enqueueCache,
    flush: flushCaches,
  } = useCoalescedMap<ParsedCache>({
    shouldReplace: (existing, incoming) => incoming.createdAt > existing.createdAt,
    maxSize: 400,
  });
  const {
    map: findsMap,
    enqueue: enqueueFind,
    flush: flushFinds,
  } = useCoalescedMap<ParsedFoundLog>({
    shouldReplace: () => false,
    maxSize: 400,
  });

  const readRelays = useMemo(() => relays.filter((r) => r.read).map((r) => r.url), [relays]);

  // Ref that mirrors whether any data has arrived since the last focus.
  // Updated in the useEffect below; read in the useFocusEffect callback so
  // the focus effect can decide whether to show the loading skeleton without
  // adding cachesMap / findsMap to the useCallback deps (which would cause
  // a close → resubscribe loop every time useCoalescedMap flushes, because
  // flush() always produces a new Map object).
  const hasDataRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      // Re-entering a screen whose Maps were flushed on blur (fresh mount or
      // re-push after navigation) must show the loading skeleton again so the
      // empty-state text doesn't flash before events arrive. We read a ref
      // rather than cachesMap.size / findsMap.size so the callback deps stay
      // stable: useCoalescedMap replaces the Map object on every flush, which
      // would make .size flicker and re-arm this effect in a tight loop.
      if (!hasDataRef.current) setLoading(true);
      const urls = readRelays.length > 0 ? readRelays : undefined;
      const closeCaches = subscribeRecentCaches((c) => {
        if (isHiddenInProd(c.hiderPubkey)) return;
        enqueueCache(c.coord, c);
      }, urls);
      const closeFinds = subscribeRecentFoundLogs((f) => {
        if (isHiddenInProd(f.finderPubkey)) return;
        enqueueFind(f.id, f);
      }, urls);
      const settle = setTimeout(() => setLoading(false), SETTLE_MS);
      return () => {
        closeCaches();
        closeFinds();
        clearTimeout(settle);
        flushCaches();
        flushFinds();
        // On blur the Maps are flushed/cleared, so the next focus is a
        // fresh fetch — reset the sentinel so loading shows again.
        hasDataRef.current = false;
      };
    }, [readRelays, enqueueCache, enqueueFind, flushCaches, flushFinds]),
  );

  // Drop the spinner as soon as any event lands, so a fast relay doesn't
  // wait out the full settle window. Also update the ref so the next focus
  // (if the user navigates away and back before the blur cleanup runs) knows
  // that data is already present.
  useEffect(() => {
    if (cachesMap.size > 0 || findsMap.size > 0) {
      hasDataRef.current = true;
      setLoading(false);
    }
  }, [cachesMap.size, findsMap.size]);

  const cacheList = useMemo(() => [...cachesMap.values()], [cachesMap]);
  const findList = useMemo(() => [...findsMap.values()], [findsMap]);

  const cacheByCoord = useMemo(() => {
    const m = new Map<string, ParsedCache>();
    for (const c of cacheList) m.set(c.coord, c);
    return m;
  }, [cacheList]);

  const pigletCoords = useMemo(() => {
    const s = new Set<string>();
    for (const c of cacheList) if (c.isLpPiggy) s.add(c.coord);
    return s;
  }, [cacheList]);

  const recentCaches = useMemo(
    () => sortRecentCaches(cacheList, { limit: RAIL_LIMIT }),
    [cacheList],
  );

  // Newest-first, deduped by id — the Recently-found section slices +
  // applies the friends filter itself so flipping the toggle is instant.
  const finds = useMemo(() => [...findList].sort((a, b) => b.createdAt - a.createdAt), [findList]);

  const hiderLeaderboard = useMemo(() => rankHiders(cacheList, BOARD_LIMIT), [cacheList]);
  const finderLeaderboard = useMemo(
    () => rankFinders(findList, pigletCoords, BOARD_LIMIT),
    [findList, pigletCoords],
  );

  return {
    recentCaches,
    finds,
    cacheByCoord,
    hiderLeaderboard,
    finderLeaderboard,
    loading,
  };
};
