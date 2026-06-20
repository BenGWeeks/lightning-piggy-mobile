import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import {
  CalendarDays,
  ChevronRight,
  Compass,
  MapPin,
  PiggyBank,
  Sparkles,
} from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { ContentRail } from '../components/ContentRail';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { LpPayoutBadge } from '../components/LpPayoutBadge';
import { MerchantDetailSheet } from '../components/MerchantDetailSheet';
import { CacheDetailSheet } from '../components/CacheDetailSheet';
import { useUserLocation } from '../contexts/UserLocationContext';
import LegendSheet from '../components/LegendSheet';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import { perfPageReady } from '../utils/perfLog';
import { joinExploreByAuthorFetch } from '../utils/exploreFetchGuard';
import { courses, type Course } from '../data/learnContent';
import MarketVendorCard from '../components/MarketVendorCard';
import { MARKET_VENDORS, type MarketVendor } from '../data/marketVendors';
import { featuredFirst } from '../utils/marketVendors';
import {
  getProgress,
  LearnProgress,
  getCourseCompletedCount,
} from '../services/learnProgressService';
import {
  type BtcMapPlace,
  acceptsLightning,
  fetchNearestPlaces,
  formatAddress,
  isBoosted,
  lightningAddressOf,
  peekCachedAnchorSync,
  peekCachedPlacesSync,
  prefetchDataset,
  refreshDataset,
} from '../services/btcMapService';
import { useNearbyRadius } from '../hooks/useNearbyRadius';
import { BOOSTED_RADIUS_METRES } from '../services/nearbyRadiusService';
import { type ParsedCache, type ParsedEvent } from '../services/nostrPlacesService';
import {
  fetchCachesByAuthor,
  subscribeNearbyCaches,
  subscribeNearbyEvents,
} from '../services/nostrPlacesPublisher';
import { useNostr } from '../contexts/NostrContext';
import {
  loadCachedCaches,
  loadCachedEvents,
  peekCachedCachesSync,
  peekCachedEventsSync,
  saveCaches,
  saveEvents,
} from '../services/nostrPlacesStorage';
import {
  decodeGeohash,
  encodeGeohash,
  formatDistance,
  geohashNeighbours,
  haversineMetres,
} from '../utils/geohash';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { createExploreHomeScreenStyles } from '../styles/ExploreHomeScreen.styles';
import { createExploreHomeRailStyles } from '../styles/ExploreHomeRail.styles';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Explore hub. Acts as a content surface, not a navigation menu — a
 * mini-map preview at the top renders local merchants + caches +
 * event venues over OSM tiles, and four content rails below preview
 * the same data the dedicated sub-screens display in full.
 *
 * Each rail subscribes to the same source its sub-screen uses
 * (BTC Map for places, NIP-GC kind 37516 for caches, NIP-52 kind
 * 31923 for events, local AsyncStorage for Lessons progress) so a
 * tap on a card opens the right detail directly. The header
 * "See all →" link routes to the full sub-screen and carries the
 * legacy `explore-card-{key}` testIDs so existing Maestro flows
 * keep navigating.
 */
const ExploreHomeScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createExploreHomeScreenStyles(colors), [colors]);
  const localStyles = useMemo(() => createExploreHomeRailStyles(colors), [colors]);
  const { radius: maxDistanceMetres } = useNearbyRadius();

  // Perf marker — same hook scripts/perf-startup.sh consumes.
  const renderLoggedRef = useRef(false);
  useEffect(() => {
    if (renderLoggedRef.current) return;
    renderLoggedRef.current = true;
    console.log(`[Perf] ExploreHomeScreen first render`);
  }, []);

  // Warm the BTC Map cache off the JS thread's critical path. The bbox
  // fetch below is gated on a real GPS fix, but `prefetchDataset` only
  // touches AsyncStorage + the in-memory parse — so kicking it off here
  // runs the multi-MB JSON.parse in parallel with location resolution
  // instead of serially on the first `fetchPlacesInBbox`. Cold-launch
  // and Home-tab users pay nothing — the prefetch only fires when the
  // Explore tab is first visited.
  useEffect(() => {
    // Defer off the synchronous mount path. prefetchDataset reads a file
    // and parses 100s of KB of merchant JSON on the JS thread; calling it
    // inline meant cold-mount paid that cost before paint. setTimeout(0)
    // yields once so the first render lands first; the prefetch then runs
    // before any pos-gated fetch needs the cache, so the user still sees
    // the merchant rail seeded from memory.
    const handle = setTimeout(() => {
      const __t0 = performance.now();
      prefetchDataset();
      console.log(
        `[PerfBlock] ExploreHome prefetchDataset kicked: +${Math.round(performance.now() - __t0)}ms`,
      );
    }, 0);
    return () => clearTimeout(handle);
  }, []);

  // ----- location ---------------------------------------------------------

  // Seed pos from the cached anchor so rails render before GPS resolves.
  // Accuracy is null (suppresses user dot halo) until a real fix lands.
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(
    () => {
      const anchor = peekCachedAnchorSync();
      return anchor ? { ...anchor, accuracy: null } : null;
    },
  );
  const [locationDenied, setLocationDenied] = useState(false);
  // Live position for the user dot — doesn't re-trigger data fetches.
  const { pos: livePos } = useUserLocation();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      // Fast path: last-known position unblocks rails while we wait
      // for the current fix (emulator GPS HAL can take several seconds).
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 10 * 60 * 1000, // ≤ 10 min old is fine for our 5 km tiles
        });
        if (!cancelled && last) {
          setPos({
            lat: last.coords.latitude,
            lon: last.coords.longitude,
            accuracy: typeof last.coords.accuracy === 'number' ? last.coords.accuracy : null,
          });
        }
      } catch {
        // Non-fatal — fall through to getCurrentPositionAsync.
      }
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!cancelled) {
          setPos({
            lat: current.coords.latitude,
            lon: current.coords.longitude,
            accuracy: typeof current.coords.accuracy === 'number' ? current.coords.accuracy : null,
          });
        }
      } catch {
        // If getCurrentPositionAsync rejects AND we never got a
        // last-known, mark the rails as denied so they show the
        // friendlier "grant location" copy.
        if (!cancelled && !pos) setLocationDenied(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- BTC Map merchants ------------------------------------------------

  // Seed from the in-memory mirror. The disk hydration that fills it is
  // kicked off the cold-start critical path (audit HIGH 1) — see
  // `kickPlacesHydration` in btcMapService, invoked from App.tsx after
  // first paint rather than at module import. The live fetch below
  // replaces this once `pos` lands.
  const [merchants, setMerchants] = useState<BtcMapPlace[]>(() => peekCachedPlacesSync());
  // If we already have cached merchants on first render there's no
  // skeleton to show — flip merchantsLoading false so the rail paints
  // them straight away instead of the loading shimmer.
  const [merchantsLoading, setMerchantsLoading] = useState(
    () => peekCachedPlacesSync().length === 0,
  );
  // Bumped by pull-to-refresh to invalidate the merchant + relay-sub
  // effects without disturbing `pos`. Lets us re-pull BTC Map + tear
  // down/re-open NIP-GC + NIP-52 subscriptions in one gesture.
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Mini-map pin-tap selections — open `MerchantDetailSheet` /
  // `CacheDetailSheet` (same components MapScreen uses) so the
  // interaction shape matches the full map. Events have no dedicated
  // sheet in MapScreen either, so they keep navigating directly to
  // EventDetail (consistent with MapScreen's behaviour). PR #630.
  const [selectedMerchant, setSelectedMerchant] = useState<BtcMapPlace | null>(null);
  const [selectedCache, setSelectedCache] = useState<ParsedCache | null>(null);
  // Map legend modal — same LegendSheet ExploreMiniMap renders inline,
  // but here it lives at the screen level so LibreMiniMap (which doesn't
  // own the sheet itself) can ask us to open it. Array memos for the
  // caches/events Maps live below their state declarations.
  const [legendVisible, setLegendVisible] = useState(false);
  const onTapMap = useCallback(() => navigation.navigate('Map'), [navigation]);
  const onOpenLegend = useCallback(() => setLegendVisible(true), []);
  // Stable handlers so a parent re-render (e.g. a DM-inbox flush bubbling
  // through useNostr()) doesn't hand ExploreMiniMap/ContentRail fresh function
  // identities each time — inline arrows defeat LibreMiniMap's arePropsEqual
  // memo (ExploreMiniMap renders LibreMiniMap when focused) and force a full
  // MapLibre marker reconciliation on every render (#798).
  const onSelectMerchant = useCallback((m: BtcMapPlace) => setSelectedMerchant(m), []);
  const onSelectCache = useCallback((c: ParsedCache) => setSelectedCache(c), []);
  const onSelectEvent = useCallback(
    (e: ParsedEvent) => navigation.navigate('EventDetail', { coord: e.coord }),
    [navigation],
  );
  const onSeeAllPlaces = useCallback(() => navigation.navigate('Places'), [navigation]);
  const onSeeAllHunt = useCallback(() => navigation.navigate('Hunt'), [navigation]);
  const onSeeAllEvents = useCallback(() => navigation.navigate('Events'), [navigation]);
  const onSeeAllMarket = useCallback(() => navigation.navigate('Market'), [navigation]);
  // Rail card tap opens the vendor's external shop (Market has no per-vendor
  // detail screen — the URL *is* the destination, same as MarketScreen).
  const openMarketVendor = useCallback((vendor: MarketVendor) => {
    Linking.openURL(vendor.url).catch(() => {});
  }, []);
  const onSeeAllLessons = useCallback(() => navigation.navigate('Lessons'), [navigation]);
  const onCloseLegend = useCallback(() => setLegendVisible(false), []);
  // Stale-while-revalidate: `peekCachedPlacesSync()` already seeded
  // the initial `merchants` state above; the live fetch below replaces
  // it once `pos` lands. Previously this effect re-paint-from-cache via
  // the async `getCachedPlaces()` — that fired AFTER the first render,
  // so the rail flashed empty for the AsyncStorage round-trip on cold
  // launch even though the data was sitting on disk.
  //
  // The dep array uses `posBucket` instead of raw `pos` so GPS jitter
  // doesn't re-fire the effect. Raw `pos` updates on every Android
  // GPS sample (~1 Hz on a real device), each with a new object
  // identity even when the user is sitting still — that re-fired this
  // effect and stacked overlapping fetches on the JS thread. Bucketing
  // to ~3 decimals of lat/lon (~100 m ground resolution) means we only
  // refetch when the user has genuinely moved enough to matter.
  // setPos firing twice on mount (last-known then current position)
  // also gets coalesced when both samples round to the same bucket.
  const posBucket = useMemo(() => {
    if (!pos) return null;
    return `${pos.lat.toFixed(3)},${pos.lon.toFixed(3)}`;
  }, [pos]);
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    (async () => {
      // Only show the loading shimmer when there's literally nothing to
      // paint. On cold start we already seed `merchants` from the
      // in-memory mirror; flipping to loading anyway means the user
      // stares at a shimmer for up to FETCH_TIMEOUT_MS even though the
      // rail could be showing the previous result. SWR painting beats
      // a perfect refresh every time on a slow network (#566).
      if (merchants.length === 0) setMerchantsLoading(true);
      try {
        const __t0 = performance.now();
        // Tiered nearest-N fetch — walks 25 → 100 → 500 km until ≥10
        // merchants come back. Bounded payload (~10-100 KB depending
        // on density) replaces the previous ±2° / ~220 km bbox call,
        // which pulled hundreds of merchants the hub never showed and
        // blocked the JS thread for seconds at a time (#31). The hub
        // mini-map intentionally diverges from PlacesScreen / MapScreen
        // here — both of those have a map the user actively pans, so
        // they keep the viewport-driven `fetchPlacesInBbox` path.
        // `force: refreshKey > 0` is belt-and-suspenders alongside
        // `refreshDataset()` wiping the cache before this effect re-runs
        // — explicit beats relying on side-effect ordering, so a future
        // refactor of refreshDataset can't silently regress pull-to-
        // refresh into a cache hit. (PR #628 Stev.ie audit.)
        const places = await fetchNearestPlaces(pos.lat, pos.lon, 10, {
          force: refreshKey > 0,
        });
        const __ms = Math.round(performance.now() - __t0);
        if (__ms > 200) {
          console.log(
            `[PerfBlock] ExploreHome fetchNearestPlaces: ${__ms}ms places=${places.length}`,
          );
        }
        if (!cancelled) setMerchants(places);
      } catch {
        // BTC Map outage shouldn't break the whole hub — empty rail.
      } finally {
        if (!cancelled) setMerchantsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // posBucket — not pos — is the trigger; see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posBucket, refreshKey]);

  // Page-ready marker. Fires the first time the rail has content AND
  // we have a real-or-anchored position fix, which together is what
  // the user perceives as "Explore is loaded". perfPageReady itself
  // dedupes per tap so re-renders here don't re-emit.
  useEffect(() => {
    if (pos && merchants.length > 0) {
      perfPageReady('Explore', `${merchants.length} merchants`);
    }
  }, [pos, merchants.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Do NOT wipe the caches/events Maps — replaceable-event semantics
    // mean re-arrivals dedupe via createdAt, so an additive refresh is
    // strictly safer. Pre-fix the wipe killed the user's own listings
    // (added by the one-shot by-author fetch) every time they pulled
    // to refresh, because the nearby `#g` sub doesn't re-echo caches
    // outside the current geohash prefix on resubscribe.
    setUntrustedCacheCount(0);
    setUntrustedEventCount(0);
    try {
      // Force a network re-pull of the BTC Map dataset — recent boosts
      // / verifications won't show up until the 7-day TTL otherwise.
      await refreshDataset();
    } catch {
      // Refresh is best-effort; keep the existing rails on failure.
    }
    // Bumping refreshKey also re-runs the by-author fetch effect (see
    // its dep array below) so a freshly-edited / freshly-published
    // Piglet by the user surfaces even when it sits outside the nearby
    // geohash prefix.
    setRefreshKey((n) => n + 1);
    // Two-second floor on the spinner — relay subs trickle in
    // continuously, so there's no clean "done" signal. Long enough to
    // feel like work happened, short enough not to feel stuck.
    setTimeout(() => setRefreshing(false), 2000);
  }, []);

  // ----- NIP-GC caches + NIP-52 events (live subs) ------------------------

  // Web-of-trust filter — kept in a ref so the subscription callbacks
  // always see the current `isTrusted` predicate without resubscribing
  // every time the trust set churns (L2 backfill, contact-list updates).
  // Post-#535: `isTrusted` is tier-aware; consumers no longer branch on a
  // separate `filterEnabled` flag (returns true unconditionally for 'all').
  const { isTrusted } = useTrustGraph();
  const isTrustedRef = useRef(isTrusted);
  useEffect(() => {
    isTrustedRef.current = isTrusted;
  }, [isTrusted]);

  // Pre-seed from the in-memory mirror — `nostrPlacesStorage` kicks
  // hydrate() at module import, so by first render the cache is
  // typically ready. The async useEffect below handles the cold-start
  // path where hydrate hasn't yet resolved.
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(
    () => new Map(peekCachedCachesSync().map((c) => [c.coord, c])),
  );
  const [events, setEvents] = useState<Map<string, ParsedEvent>>(
    () => new Map(peekCachedEventsSync().map((e) => [e.coord, e])),
  );

  // Coalesce per-event setState bursts during relay backfill (#31, audit
  // P1, #605). The relay subscription `onevent` callback can fire 50+
  // times in <200 ms on cold-start; pre-fix every event ran a Map clone
  // + setState + render, blocking the JS thread for the entire backfill.
  // Mirrors the DM inbox pattern in NostrContext.tsx (~3550).
  //
  // Per-event work stays cheap: trust filter + createdAt-staleness check
  // run inline (no React state). Only the merge into the React Map is
  // batched, so the rails still update incrementally as the queue
  // flushes — just every ~100 ms instead of every event.
  const pendingCachesRef = useRef<Map<string, ParsedCache>>(new Map());
  const pendingEventsRef = useRef<Map<string, ParsedEvent>>(new Map());
  const pendingCachesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the screen has unmounted entirely (logout / navigator
  // reset). Distinct from focus blur, which only pauses the screen — the
  // tab-blur cleanup still wants to flush so the next focus shows the
  // tail of the queue. Full unmount means React will throw on any
  // setState here, so flushers early-return.
  const isUnmountedRef = useRef(false);
  useEffect(
    () => () => {
      isUnmountedRef.current = true;
    },
    [],
  );
  // 100 ms flush window: feels instant to the user (the eye perceives
  // ≤120 ms as same-frame), short enough that the rail doesn't sit
  // empty during a slow backfill, long enough to coalesce a typical
  // relay event burst (~50 events in 200 ms) into 2–3 commits.
  const PENDING_FLUSH_MS = 100;
  // 25-event threshold flushes early when a fast relay dumps a big
  // backlog. Without it, a 200-event burst would sit in the buffer for
  // the full 100 ms even if it landed in 20 ms.
  const PENDING_FLUSH_THRESHOLD = 25;
  const flushPendingCaches = useCallback(() => {
    if (pendingCachesTimerRef.current) {
      clearTimeout(pendingCachesTimerRef.current);
      pendingCachesTimerRef.current = null;
    }
    // Clear buffer + skip setState on unmount so a stale subscription
    // tear-down post-logout / navigator-reset doesn't trigger the
    // "setState on unmounted component" warning (Copilot review on #612).
    if (isUnmountedRef.current) {
      pendingCachesRef.current = new Map();
      return;
    }
    const batch = pendingCachesRef.current;
    if (batch.size === 0) return;
    pendingCachesRef.current = new Map();
    setCaches((prev) => {
      const __t0 = performance.now();
      const next = new Map(prev);
      for (const [coord, c] of batch) {
        const existing = next.get(coord);
        if (!existing || existing.createdAt < c.createdAt) next.set(coord, c);
      }
      const __dt = performance.now() - __t0;
      if (__dt > 30) {
        console.log(
          `[PerfBlock] Explore setCaches flush: ${Math.round(__dt)}ms batch=${batch.size} size=${prev.size}→${next.size}`,
        );
      }
      return next;
    });
  }, []);
  const flushPendingEvents = useCallback(() => {
    if (pendingEventsTimerRef.current) {
      clearTimeout(pendingEventsTimerRef.current);
      pendingEventsTimerRef.current = null;
    }
    // See flushPendingCaches above for the unmount guard rationale.
    if (isUnmountedRef.current) {
      pendingEventsRef.current = new Map();
      return;
    }
    const batch = pendingEventsRef.current;
    if (batch.size === 0) return;
    pendingEventsRef.current = new Map();
    setEvents((prev) => {
      const __t0 = performance.now();
      const next = new Map(prev);
      for (const [coord, e] of batch) {
        const existing = next.get(coord);
        if (!existing || existing.startsAt !== e.startsAt) next.set(coord, e);
      }
      const __dt = performance.now() - __t0;
      if (__dt > 30) {
        console.log(
          `[PerfBlock] Explore setEvents flush: ${Math.round(__dt)}ms batch=${batch.size} size=${prev.size}→${next.size}`,
        );
      }
      return next;
    });
  }, []);

  // Stable array projections of the caches/events Maps so React.memo on
  // the consuming LibreMiniMap can short-circuit re-renders. Without
  // these the parent's `[...caches.values()]` literal returns a fresh
  // array reference every render and defeats the memo entirely.
  const cachesArr = useMemo(() => [...caches.values()], [caches]);
  const eventsArr = useMemo(() => [...events.values()], [events]);

  // Hydrate last-known caches + events from AsyncStorage so the rails
  // render instantly on cold start while the live relay subs backfill.
  useEffect(() => {
    let cancelled = false;
    const __t0 = performance.now();
    Promise.all([loadCachedCaches(), loadCachedEvents()]).then(([cs, es]) => {
      if (cancelled) return;
      const __ms = Math.round(performance.now() - __t0);
      if (__ms > 200) {
        console.log(
          `[PerfBlock] ExploreHome loadCachedCaches+Events: ${__ms}ms caches=${cs.length} events=${es.length}`,
        );
      }
      if (cs.length > 0) {
        setCaches((prev) => {
          if (prev.size > 0) return prev; // live sub already filled in
          const m = new Map<string, ParsedCache>();
          for (const c of cs) m.set(c.coord, c);
          return m;
        });
      }
      if (es.length > 0) {
        setEvents((prev) => {
          if (prev.size > 0) return prev;
          const m = new Map<string, ParsedEvent>();
          for (const e of es) m.set(e.coord, e);
          return m;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Surface the signed-in user's own published Piggies in the rail
  // even when no nearby `#g` subscription has echoed them back. The
  // nearby sub filters by geohash prefix, which excludes the user's
  // own listing if they hid it outside their current viewport OR if
  // the sub was paused (#557) at the moment the relay echoed back.
  // One-shot per (pubkey, refreshKey) via the module-scoped
  // `claimExploreByAuthorFetch` guard — re-runs on pull-to-refresh and
  // pubkey change but never on unrelated re-renders, and is immune to the
  // concurrent parallel-fire a component useRef suffered (#751 audit #4).
  const { pubkey: signedInPubkey, relays: userRelays } = useNostr();
  // The user's read-relay URLs, plus a content key that only changes when the
  // URL *set* changes (sorted so a mere reorder doesn't) — not when useNostr()
  // hands back a new array with the same URLs (cold-start cache→network churn),
  // which used to double-fire the by-author fetch below (#798).
  const readRelays = userRelays.filter((r) => r.read).map((r) => r.url);
  const readRelayKey = [...readRelays].sort().join(',');
  useEffect(() => {
    if (!signedInPubkey) return;
    const fetchKey = `${signedInPubkey}:${refreshKey}`;
    let cancelled = false;
    // Join an in-flight fetch so concurrent effect re-runs don't fire parallel
    // requests, and the current run still merges on cancel (#752 Copilot).
    joinExploreByAuthorFetch(fetchKey, () =>
      fetchCachesByAuthor(signedInPubkey, readRelays.length > 0 ? readRelays : undefined),
    )
      .then((mine) => {
        if (cancelled) return;
        console.log(
          `[PerfBlock] ExploreHome by-author merge: fetched=${mine.length} ` +
            mine.map((c) => `${c.name ?? c.d}@${c.geohash?.slice(0, 5) ?? '??'}`).join(', '),
        );
        if (mine.length === 0) return;
        setCaches((prev) => {
          const next = new Map(prev);
          let added = 0;
          for (const c of mine) {
            const existing = next.get(c.coord);
            if (!existing || c.createdAt > existing.createdAt) {
              next.set(c.coord, c);
              added++;
            }
          }
          console.log(
            `[PerfBlock] ExploreHome by-author merge: ${added} new/updated in caches Map`,
          );
          return next;
        });
      })
      .catch((e) => {
        console.warn(`[PerfBlock] ExploreHome by-author fetch threw: ${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
    // Depend on readRelayKey (the relay-URL *content*), not the userRelays array
    // identity: a genuine relay-set change still re-fires the fetch (parity with
    // MapScreen's by-author fetch), but the cold-start new-array-same-URLs churn
    // no longer does — that double-fired a redundant ~20s query (#798).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInPubkey, refreshKey, readRelayKey]);

  // Write-through to AsyncStorage whenever the in-memory state grows
  // so the next cold start has fresh content to hydrate from. Debounced
  // via a slow useEffect — we don't need to persist on every event.
  useEffect(() => {
    if (caches.size === 0) return;
    const t = setTimeout(() => saveCaches([...caches.values()]), 1500);
    return () => clearTimeout(t);
  }, [caches]);
  useEffect(() => {
    if (events.size === 0) return;
    const t = setTimeout(() => saveEvents([...events.values()]), 1500);
    return () => clearTimeout(t);
  }, [events]);
  // Counts of events arriving from pubkeys outside the trust set.
  // Surfaced as "N hidden — from outside your trust graph" so users
  // know the filter is doing something.
  const [untrustedCacheCount, setUntrustedCacheCount] = useState(0);
  const [untrustedEventCount, setUntrustedEventCount] = useState(0);
  const subsCloserRef = useRef<(() => void)[]>([]);
  // Gate re-subscription on coarse movement (~500 m via 0.005° quantisation)
  // via the posBucketKey in the effect's deps below — NOT a body-level skip:
  // React runs cleanup BEFORE the new body, so a body-level skip closes the
  // existing subs first then bails, leaving zero subs across cold-start GPS
  // jitter (peekCachedAnchor → getLastKnown → getCurrent settle within a few
  // hundred metres). #741 Copilot review on #739 Fix 3.
  // NIP-GC + NIP-52 subscriptions live on the *mount* lifecycle, not
  // the focus lifecycle. Open once when ExploreHomeScreen first
  // mounts (which is lazy on the tab navigator via `lazy: true`, so
  // nothing fires before the user actually visits the tab); stay open
  // across tab blur / focus; close only on full unmount (logout /
  // navigator reset / pull-to-refresh).
  //
  // This is the standard pattern across production Nostr clients
  // (Damus, Snort, Amethyst). The pre-existing `useFocusEffect` here
  // tore down on every blur and re-opened on every focus. The
  // rationale was "reconnect on re-focus is ~100 ms; saves JS-thread
  // load while user is on Home" — but the actual measured cost of
  // re-focus is **15-16 s** (#31 freeze), not 100 ms, because the
  // relay re-emits its full geohash-prefix backlog every time we
  // re-subscribe. The math was upside-down: we were paying a
  // 15-second freeze on every tab return to save the user from
  // <2 ms/min of background event processing.
  //
  // Subscriptions stay closed by the WebSocket reuse semantics of
  // `nostr-tools`' `SimplePool` — closing a subscription just sends
  // a CLOSE frame; the underlying WebSocket persists for future REQs.
  // So even the "first visit" backfill happens once per app launch,
  // not once per focus.
  //
  // Destructure pos into primitives so the effect's deps don't
  // re-trigger every time `setPos` writes a fresh `{lat, lon, accuracy}`
  // object (which happens 2–3 times on cold start: last-known fix →
  // current fix → high-accuracy refinement). Pre-fix that thrashed
  // the relay subscription open/close 2–3 times per cold-start.
  // Stev.ie's #612 review surfaced this.
  const posLat = pos?.lat;
  const posLon = pos?.lon;
  const POS_BUCKET_DEG = 0.005;
  const posBucketKey =
    typeof posLat !== 'number' || typeof posLon !== 'number'
      ? null
      : `${Math.round(posLat / POS_BUCKET_DEG)}:${Math.round(posLon / POS_BUCKET_DEG)}`;
  useEffect(() => {
    // refreshKey in deps: pull-to-refresh bumps it → tear down + re-run.
    // posLat / posLon are used here for the geohash filters but deliberately
    // NOT in deps (they'd thrash the gate on every GPS tick) — see the
    // bucket-key comment above the declaration. eslint suppression below.
    if (posBucketKey === null || typeof posLat !== 'number' || typeof posLon !== 'number') return;
    // `cancelled` covers the window between effect cleanup firing
    // (subsCloserRef.current.forEach(c => c())) and the underlying
    // relay socket actually closing — a stray event in that gap
    // would otherwise mutate pendingCachesRef and arm a fresh flush
    // timer that fires after the cleanup. Mirrors NostrContext.tsx's
    // DM inbox precedent.
    let cancelled = false;
    // Caches sit at precision 5 (~5 km) — geocaching is inherently
    // hyper-local. Events broaden to precision 3 (~150 km) so a rural
    // user catches the nearest city's Bitcoin meetup; most NIP-52
    // publishers emit g tags at every precision 3..9.
    //
    // `geohashNeighbours` returns the user's own cell plus the 8
    // surrounding tiles at that precision (9 prefixes for caches,
    // 9 for events). Pre-#631 we used `geohashPrefixes(myGh, 5)`
    // which returned only the user's own truncation chain — caches
    // hidden in an adjacent precision-5 tile (e.g. 500 m across a
    // tile boundary) never matched the `#g` filter.
    const cachePrefixes = geohashNeighbours(encodeGeohash(posLat, posLon, 5));
    const eventPrefixes = geohashNeighbours(encodeGeohash(posLat, posLon, 3));

    subsCloserRef.current.push(
      subscribeNearbyCaches(cachePrefixes, (c) => {
        if (cancelled) return;
        // WoT filter: silently drop caches from pubkeys outside the
        // trust graph (an unverified cache could be a phishing LNURL
        // or, worse, a physical lure). Surfaced as a count instead so
        // users know they exist without being lured into inspecting them.
        if (!isTrustedRef.current(c.hiderPubkey)) {
          setUntrustedCacheCount((n) => n + 1);
          return;
        }
        // Stale-event drop happens here too so a stale wrap doesn't
        // even enter the pending queue. The flush re-checks against
        // the committed state in case the queue itself raced.
        const existing = pendingCachesRef.current.get(c.coord);
        if (existing && existing.createdAt >= c.createdAt) return;
        pendingCachesRef.current.set(c.coord, c);
        if (pendingCachesRef.current.size >= PENDING_FLUSH_THRESHOLD) {
          flushPendingCaches();
          return;
        }
        if (pendingCachesTimerRef.current === null) {
          pendingCachesTimerRef.current = setTimeout(flushPendingCaches, PENDING_FLUSH_MS);
        }
      }),
    );
    subsCloserRef.current.push(
      subscribeNearbyEvents(eventPrefixes, (e) => {
        if (cancelled) return;
        // Skip events that already started > 1h ago.
        if (e.startsAt && e.startsAt < Math.floor(Date.now() / 1000) - 60 * 60) return;
        if (!isTrustedRef.current(e.organiserPubkey)) {
          setUntrustedEventCount((n) => n + 1);
          return;
        }
        const existing = pendingEventsRef.current.get(e.coord);
        if (existing && existing.startsAt === e.startsAt) return;
        pendingEventsRef.current.set(e.coord, e);
        if (pendingEventsRef.current.size >= PENDING_FLUSH_THRESHOLD) {
          flushPendingEvents();
          return;
        }
        if (pendingEventsTimerRef.current === null) {
          pendingEventsTimerRef.current = setTimeout(flushPendingEvents, PENDING_FLUSH_MS);
        }
      }),
    );
    return () => {
      cancelled = true;
      subsCloserRef.current.forEach((c) => c());
      subsCloserRef.current = [];
      // Drain whatever's queued so the last few events from a
      // refresh-triggered tear-down (or full unmount) aren't lost.
      // Both flushers are null-safe + no-op when the buffer is
      // already empty.
      flushPendingCaches();
      flushPendingEvents();
    };
    // posLat / posLon are intentionally NOT in this deps array — see the
    // comment at the top of the effect. The bucket key gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posBucketKey, refreshKey, flushPendingCaches, flushPendingEvents]);

  // ----- lessons progress (local) -----------------------------------------

  const [progress, setProgress] = useState<LearnProgress>({ completedMissions: [] });
  useFocusEffect(
    useCallback(() => {
      getProgress().then(setProgress);
    }, []),
  );

  // ----- derived rail data ------------------------------------------------
  //
  // Every rail is sorted by haversine distance from the user so the
  // nearest row sits leftmost. Items without a usable location land
  // at the end. We tag each entry with a `distance` number so the
  // card variants can render an "X km" badge without recomputing.

  // Sort memos depend on `posLat` / `posLon` rather than raw `pos` so a
  // fresh `{lat, lon, accuracy}` object with identical primitives no
  // longer re-runs the haversine sweep on every GPS sample (PR #628
  // Stev.ie audit). The early-return path uses both being numbers as
  // the truthiness check.
  const sortedMerchants = useMemo(() => {
    if (typeof posLat !== 'number' || typeof posLon !== 'number')
      return [] as { place: BtcMapPlace; distance: number }[];
    let items = merchants.map((place) => ({
      place,
      distance: haversineMetres({ lat: posLat, lon: posLon }, { lat: place.lat, lon: place.lon }),
    }));
    if (maxDistanceMetres !== null) {
      // Boosted/"Featured" merchants get a wider per-row cap so the user
      // sees paid placements even when their general radius is tight.
      // Max-wins: a user who's set the slider above 200 km keeps that.
      items = items.filter((m) => {
        const cap = isBoosted(m.place)
          ? Math.max(maxDistanceMetres, BOOSTED_RADIUS_METRES)
          : maxDistanceMetres;
        return m.distance <= cap;
      });
    }
    return (
      items
        // Boosted merchants surface first on the rail (BTC Map's
        // paid-feature mechanism); within the same boost-bucket we still
        // sort by distance so the closest boosted / closest non-boosted
        // sit at the front of each half. Honest visual: each boosted
        // card gets a "Featured" badge so the user knows why it's
        // prominent.
        .sort((a, b) => {
          const ab = isBoosted(a.place) ? 1 : 0;
          const bb = isBoosted(b.place) ? 1 : 0;
          if (ab !== bb) return bb - ab;
          return a.distance - b.distance;
        })
        .slice(0, 12)
    );
  }, [merchants, posLat, posLon, maxDistanceMetres]);

  // Distinct merchant categories for the legend. Memoised so the
  // flatMap + Set + spread over all merchants doesn't run on every render
  // (and so LegendSheet gets a stable array reference) (#798).
  const availableCategories = useMemo(
    () => [...new Set(merchants.flatMap((m) => m.categories ?? []).filter(Boolean))],
    [merchants],
  );

  const sortedCaches = useMemo(() => {
    const lowerPubkey = signedInPubkey?.toLowerCase() ?? null;
    const haveFix = typeof posLat === 'number' && typeof posLon === 'number';
    let items = [...caches.values()].map((cache) => {
      const center = cache.geohash ? decodeGeohash(cache.geohash) : null;
      const distance =
        haveFix && center
          ? haversineMetres({ lat: posLat, lon: posLon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      const isOwn = lowerPubkey !== null && cache.hiderPubkey.toLowerCase() === lowerPubkey;
      return { cache, distance, isOwn };
    });
    // Trace own-listing trajectory so a missing-own-cache regression
    // can be diagnosed from logcat alone (#73 follow-up).
    const ownItems = items.filter((c) => c.isOwn);
    if (ownItems.length > 0) {
      console.log(
        `[PerfBlock] sortedCaches own=${ownItems.length} maxDistance=${maxDistanceMetres ?? 'null'}m posSet=${haveFix} ` +
          ownItems
            .map(
              (c) =>
                `${c.cache.name ?? c.cache.d}@gh=${c.cache.geohash ?? 'null'} dist=${Number.isFinite(c.distance) ? Math.round(c.distance) + 'm' : 'inf'}`,
            )
            .join(' | '),
      );
    } else if (caches.size > 0 && signedInPubkey) {
      console.log(
        `[PerfBlock] sortedCaches own=0 (caches.size=${caches.size}, signedInPubkey=${signedInPubkey.slice(0, 8)}…) — by-author merge may not have landed yet`,
      );
    }
    if (maxDistanceMetres !== null) {
      items = items.filter((c) => c.distance <= maxDistanceMetres);
    }
    // Own listings still sort to the front WITHIN the radius — the user
    // wants their own work visible first when it's nearby, but a cache
    // they hid 100 km away shouldn't crowd the "nearby" rail.
    items.sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      return a.distance - b.distance;
    });
    // Cap at 50 — the hub rail is a horizontal-scroll teaser and 50 is
    // enough for any practical density without making the rail
    // disproportionately heavy. The "See all → Geo-caches" page
    // (HuntScreen) has no cap for the full list.
    return items.slice(0, 50);
  }, [caches, posLat, posLon, maxDistanceMetres, signedInPubkey]);

  const sortedEvents = useMemo(() => {
    const haveFix = typeof posLat === 'number' && typeof posLon === 'number';
    let items = [...events.values()].map((event) => {
      const center = event.geohash ? decodeGeohash(event.geohash) : null;
      const distance =
        haveFix && center
          ? haversineMetres({ lat: posLat, lon: posLon }, { lat: center.lat, lon: center.lng })
          : Number.POSITIVE_INFINITY;
      return { event, distance };
    });
    // Keep events with no `g` tag (distance = ∞) — most NIP-52 publishers
    // (OrangePillApp etc.) don't include one, so dropping them would leave
    // the rail mostly empty even when legitimate Bitcoin meetups exist.
    // The sort below puts geohash-ed events first, then unlocated ones
    // tail-end. A future PR can split these into a separate "Events with
    // no location" rail (task #51); for now lumping them in is the right
    // trade-off.
    if (maxDistanceMetres !== null) {
      items = items.filter((e) => !Number.isFinite(e.distance) || e.distance <= maxDistanceMetres);
    }
    items.sort((a, b) => {
      const af = Number.isFinite(a.distance);
      const bf = Number.isFinite(b.distance);
      if (af !== bf) return af ? -1 : 1;
      return a.distance - b.distance;
    });
    return items.slice(0, 50);
  }, [events, posLat, posLon, maxDistanceMetres]);

  // Market vendors are a static, curated list (no location/relay dep) —
  // just featured-first, then capped to a small rail teaser. The full set
  // lives behind "See all → Market". See src/data/marketVendors.ts.
  const marketVendors = useMemo(() => featuredFirst(MARKET_VENDORS).slice(0, 8), []);

  return (
    <View style={styles.container}>
      <View style={styles.headerBackground}>
        <Image
          source={require('../../assets/images/learn-header-bg.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.headerOverlay} />
        <TabHeader title="Explore" icon={<Compass size={20} color={colors.brandPink} />} />
        <View style={styles.headerExtras}>
          <Text style={styles.tagline}>Find your way around Bitcoin</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={localStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // Brand pink so the spinner reads as our UI, not a bare
            // Android grey.
            tintColor={colors.brandPink}
            colors={[colors.brandPink]}
          />
        }
      >
        <ExploreMiniMap
          locationDenied={locationDenied}
          // Mini-map is non-interactive (zoom-only, follows GPS) — so the
          // camera anchor SHOULD track the live position, not the stale
          // one-shot `pos` (seeded from a cached merchant-centroid anchor on
          // cold start). Falls back to `pos` only while the live fix resolves.
          lat={livePos?.lat ?? pos?.lat ?? null}
          lon={livePos?.lon ?? pos?.lon ?? null}
          userLat={livePos?.lat ?? null}
          userLon={livePos?.lon ?? null}
          // Cached anchor accuracy is only useful BEFORE a live fix arrives.
          // Once livePos exists, trust its accuracy (even if null) so the halo
          // never renders around live coords using stale data.
          userAccuracyMetres={livePos ? livePos.accuracy : (pos?.accuracy ?? null)}
          merchants={merchants}
          caches={cachesArr}
          events={eventsArr}
          onTapMap={onTapMap}
          onOpenLegend={onOpenLegend}
          onSelectMerchant={onSelectMerchant}
          onSelectCache={onSelectCache}
          onSelectEvent={onSelectEvent}
        />

        <ContentRail<{ place: BtcMapPlace; distance: number }>
          title="Places near you"
          caption="Bitcoin-accepting merchants from BTC Map"
          items={sortedMerchants}
          loading={merchantsLoading && sortedMerchants.length === 0 && !!pos}
          // "See all" lands on the Places list (with map button in
          // its header); the dedicated Map view is one tap away.
          onSeeAll={onSeeAllPlaces}
          seeAllTestId="explore-card-map"
          keyExtractor={(p) => String(p.place.id)}
          emptyState={
            <Text style={localStyles.emptyText}>
              {pos
                ? 'No merchants in your immediate area — try the full Map for a wider view.'
                : 'Grant location to discover Bitcoin-accepting shops near you.'}
            </Text>
          }
          renderItem={({ place, distance }) => (
            <PlaceCard
              place={place}
              distance={distance}
              onPress={() => navigation.navigate('PlaceDetail', { placeId: place.id })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<{ cache: ParsedCache; distance: number }>
          title="Geo-caches near you"
          caption={
            untrustedCacheCount > 0
              ? `Piglets + classic NIP-GC caches · ${untrustedCacheCount} hidden from outside your trust graph`
              : 'Piglets + classic NIP-GC caches'
          }
          items={sortedCaches}
          // Loading skeleton only while we haven't received *anything*.
          // If WoT has dropped one or more nearby caches the relay query
          // has clearly returned — keep loading false so the empty state
          // can explain *why* the rail is empty instead of looping the
          // skeleton forever.
          loading={!!pos && caches.size === 0 && untrustedCacheCount === 0}
          // "See all" lands on the merged Geo-caches page (map + list
          // + [+] in header for the hider flow). Was a two-screen
          // Hunt/Discover split before the May 2026 UX merge.
          onSeeAll={onSeeAllHunt}
          seeAllTestId="explore-card-hunt"
          keyExtractor={(c) => c.cache.coord}
          emptyState={
            untrustedCacheCount > 0 ? (
              <Text style={localStyles.emptyText}>
                {untrustedCacheCount} nearby {untrustedCacheCount === 1 ? 'cache is' : 'caches are'}{' '}
                hidden because their hider isn't in your Web-of-Trust. Follow people who hide
                Piggies on Nostr to start seeing their caches here.
              </Text>
            ) : (
              <Text style={localStyles.emptyText}>
                No caches in your area yet. Tap See all → Hide a Piggy to be the first.
              </Text>
            )
          }
          renderItem={({ cache, distance }) => (
            <CacheCard
              cache={cache}
              distance={distance}
              onPress={() => navigation.navigate('HuntPiggyDetail', { coord: cache.coord })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<MarketVendor>
          title="Market"
          caption="Buy a Lightning Piggy — Bitcoin-accepting vendors"
          items={marketVendors}
          onSeeAll={onSeeAllMarket}
          seeAllTestId="explore-card-market"
          keyExtractor={(v) => v.url}
          renderItem={(vendor) => (
            <MarketVendorCard
              vendor={vendor}
              variant="rail"
              onPress={() => openMarketVendor(vendor)}
            />
          )}
        />

        <ContentRail<{ event: ParsedEvent; distance: number }>
          title="Events near you"
          caption={
            // Subtitle drops the "within ~150 km" claim — we surface
            // events without `#g` geohash tags too (most NIP-52 publishers
            // don't include one), so we can't enforce that distance.
            // Each card shows the event's location string so the user
            // can read the city / venue and decide.
            untrustedEventCount > 0
              ? `Bitcoin meetups (NIP-52) · ${untrustedEventCount} hidden from outside your trust graph`
              : 'Bitcoin meetups (NIP-52)'
          }
          items={sortedEvents}
          loading={!!pos && events.size === 0 && false}
          onSeeAll={onSeeAllEvents}
          seeAllTestId="explore-card-events"
          keyExtractor={(e) => e.event.coord}
          emptyState={
            <Text style={localStyles.emptyText}>
              No upcoming meetups in your area on the NIP-52 feed right now.
            </Text>
          }
          renderItem={({ event, distance }) => (
            <EventCard
              event={event}
              distance={distance}
              onPress={() => navigation.navigate('EventDetail', { coord: event.coord })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />

        <ContentRail<Course>
          title="Lessons in progress"
          caption={`${progress.completedMissions.length} / ${courses.reduce((a, c) => a + c.missions.length, 0)} missions done`}
          items={courses}
          onSeeAll={onSeeAllLessons}
          seeAllTestId="explore-card-lessons"
          keyExtractor={(c) => c.id}
          renderItem={(course) => (
            <LessonCard
              course={course}
              progress={progress}
              onPress={() => navigation.navigate('CourseDetail', { courseId: course.id })}
              colors={colors}
              styles={localStyles}
            />
          )}
        />
      </ScrollView>
      {/* Map legend bottom sheet — shared by LibreMiniMap (no inline
          sheet) and used here so the (i) button has somewhere to go. The
          inline ExploreMiniMap path owns its own LegendSheet, so this
          one is harmless in both branches; opens only when the legend
          tap actually triggers setLegendVisible. */}
      <LegendSheet
        visible={legendVisible}
        onClose={onCloseLegend}
        placesVisible
        availableCategories={availableCategories}
      />
      {/* Mini-map pin-tap sheets — share the components with MapScreen
          so the interaction shape (drag-to-dismiss, tap-away, View
          details action) is identical across surfaces. PR #630. */}
      {selectedMerchant && (
        <MerchantDetailSheet
          place={selectedMerchant}
          colors={colors}
          onClose={() => setSelectedMerchant(null)}
          onViewDetails={() => {
            const placeId = selectedMerchant.id;
            setSelectedMerchant(null);
            navigation.navigate('PlaceDetail', { placeId });
          }}
        />
      )}
      {selectedCache && (
        <CacheDetailSheet
          cache={selectedCache}
          colors={colors}
          onClose={() => setSelectedCache(null)}
          onViewDetails={() => {
            const coord = selectedCache.coord;
            setSelectedCache(null);
            navigation.navigate('HuntPiggyDetail', { coord });
          }}
        />
      )}
    </View>
  );
};

// -----------------------------------------------------------------------------
// rail card variants
// -----------------------------------------------------------------------------

const PlaceCard: React.FC<{
  place: BtcMapPlace;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createExploreHomeRailStyles>;
}> = ({ place, distance, onPress, colors, styles }) => {
  const lightning = acceptsLightning(place);
  const lud16 = lightningAddressOf(place);
  const boosted = isBoosted(place);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`place-card-${place.id}`}>
      {boosted ? (
        <View style={styles.cardFeaturedBadge} testID={`place-card-${place.id}-featured`}>
          <Sparkles size={10} color={colors.textHeader} strokeWidth={2.5} />
          <Text style={styles.cardFeaturedText}>Featured</Text>
        </View>
      ) : null}
      <View
        style={[styles.cardIcon, lightning ? styles.cardIconLightning : styles.cardIconOnchain]}
      >
        {/* Category icon (Coffee / UtensilsCrossed / Hotel / …) gives
            the user a what-is-this read at a glance. Pink (Lightning)
            / orange (on-chain) background carries the payment-type
            signal, matching how MerchantDetailSheet + PlacesScreen
            row already render. */}
        {(() => {
          const CategoryIcon = btcMapIconComponent(place.icon);
          return <CategoryIcon size={20} color={colors.white} strokeWidth={2.5} />;
        })()}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {place.tags.name ?? 'Unnamed merchant'}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {lightning ? '⚡ Lightning' : 'On-chain'}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
      <Text style={styles.cardSubSmall} numberOfLines={1}>
        {lud16 ?? formatAddress(place)}
      </Text>
    </TouchableOpacity>
  );
};

const CacheCard: React.FC<{
  cache: ParsedCache;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createExploreHomeRailStyles>;
}> = ({ cache, distance, onPress, colors, styles }) => (
  <TouchableOpacity style={styles.card} onPress={onPress} testID={`cache-card-${cache.d}`}>
    <View style={styles.cardThumbWrap}>
      {cache.imageUrl ? (
        <Image source={{ uri: cache.imageUrl }} style={styles.cardThumb} resizeMode="cover" />
      ) : (
        // Same-shape placeholder so cards align visually whether or
        // not the hider attached a hint photo. LP Piggies get a pink
        // panel + piggy glyph; vanilla NIP-GC caches get a slate
        // panel + map-pin glyph.
        <View
          style={[
            styles.cardThumb,
            styles.cardThumbPlaceholder,
            cache.isLpPiggy ? styles.cardIconLightning : styles.cardIconStandard,
          ]}
        >
          {cache.isLpPiggy ? (
            <PiggyBank size={32} color={colors.white} strokeWidth={2} />
          ) : (
            <MapPin size={32} color={colors.white} strokeWidth={2} />
          )}
        </View>
      )}
      <LpPayoutBadge
        isLpPiggy={cache.isLpPiggy}
        payoutSats={cache.payoutSats}
        offset={{ top: 4, right: 4 }}
      />
    </View>
    <Text style={styles.cardTitle} numberOfLines={2}>
      {cache.name}
    </Text>
    <Text style={styles.cardSub} numberOfLines={1}>
      {cache.isLpPiggy ? 'Piglet' : 'NIP-GC cache'}
      {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
    </Text>
    <Text style={styles.cardSubSmall} numberOfLines={1}>
      {cache.cacheType ?? 'traditional'} · {cache.size ?? 'micro'}
    </Text>
  </TouchableOpacity>
);

const EventCard: React.FC<{
  event: ParsedEvent;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createExploreHomeRailStyles>;
}> = ({ event, distance, onPress, colors, styles }) => {
  const day = event.startsAt
    ? new Date(event.startsAt * 1000).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'Soon';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`event-card-${event.d}`}>
      {event.imageUrl ? (
        <Image source={{ uri: event.imageUrl }} style={styles.cardThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, styles.cardIconEvent]}>
          <CalendarDays size={32} color={colors.white} strokeWidth={2} />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {day}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
      {event.location ? (
        <Text style={styles.cardSubSmall} numberOfLines={1}>
          {event.location}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

const LessonCard: React.FC<{
  course: Course;
  progress: LearnProgress;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createExploreHomeRailStyles>;
}> = ({ course, progress, onPress, colors, styles }) => {
  const completed = getCourseCompletedCount(
    progress,
    course.missions.map((m) => m.id),
  );
  const total = course.missions.length;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`lesson-card-${course.id}`}>
      <Image source={course.image} style={styles.cardThumb} resizeMode="cover" />
      <Text style={styles.cardTitle} numberOfLines={2}>
        {course.title}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {completed}/{total} missions
      </Text>
      {completed === total ? (
        <Text style={[styles.cardSubSmall, { color: colors.green }]} numberOfLines={1}>
          ✓ Complete
        </Text>
      ) : (
        <Text style={styles.cardSubSmall} numberOfLines={1}>
          <ChevronRight size={11} color={colors.brandPink} /> Continue
        </Text>
      )}
    </TouchableOpacity>
  );
};

// React.Profiler wrapper — see HomeScreen for the rationale (#560).
// Explore is the screen Ben saw the 24-57 s freezes on; this surfaces
// the render-commit cost so we can finally see whether the freezes are
// React work (Profiler fires) or something else (silent).
const ProfiledExploreHomeScreen: React.FC<Props> = (props) => (
  <React.Profiler
    id="ExploreHomeScreen"
    onRender={(id, phase, actualDuration) => {
      if (actualDuration > 100) {
        // eslint-disable-next-line no-console
        console.log(`[PerfBlock] render:${id} ${phase}=${Math.round(actualDuration)}ms`);
      }
    }}
  >
    <ExploreHomeScreen {...props} />
  </React.Profiler>
);

export default ProfiledExploreHomeScreen;
