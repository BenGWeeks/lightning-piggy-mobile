import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronLeft,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Info,
  LocateFixed,
  Phone,
  PiggyBank,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import {
  Bbox,
  BtcMapPlace,
  acceptsLightning,
  acceptsOnchain,
  btcMapMerchantUrl,
  btcMapVerifyUrl,
  daysSinceVerified,
  fetchPlacesInBbox,
  formatAddress,
  isBoosted,
  lightningAddressOf,
} from '../services/btcMapService';
import type { ParsedCache } from '../services/nostrPlacesService';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import { decodeGeohash, encodeGeohash, geohashPrefixes } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import SocialIcon from '../components/SocialIcon';
import WebOfTrustChip from '../components/WebOfTrustChip';
import WebOfTrustBottomSheet from '../components/WebOfTrustBottomSheet';
import LegendSheet from '../components/LegendSheet';
import { LibreMiniMap } from '../components/LibreMiniMap';

interface Props {
  navigation: ExploreNavigation;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

interface BridgeMessage {
  type: 'ready' | 'bounds' | 'markerTap' | 'cacheTap';
  bbox?: Bbox;
  /** Viewport centre alongside the bbox — used to persist last-viewed. */
  centre?: { lat: number; lng: number };
  /** Leaflet zoom level alongside the bbox. */
  zoom?: number;
  /** True when the bounds change came from a user gesture (drag/zoom),
   * false / undefined when it came from a programmatic LP_setViewport
   * call or Leaflet's initial bootstrap setView. */
  userInitiated?: boolean;
  id?: number;
  /** Cache coord (`<kind>:<pubkey>:<d>`) for cacheTap messages. */
  coord?: string;
}

/**
 * Map sub-screen — discovers Bitcoin-accepting merchants near the user via
 * the BTC Map API (OSM-backed). Closes the foreground-browse part of #467;
 * the background-geofence + notifications part lands in milestone 3.
 *
 * Renderer is Leaflet on OpenStreetMap tiles via WebView (no Google Maps,
 * no API key, OSM-aligned with the underlying merchant data — see project
 * memory `BTC Map runs the commons (Nathan)`).
 */
const MapScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  // Tier-aware predicate from the Web-of-Trust context. `isTrusted`
  // already encodes the current wotTier (Friends / FoF / All), so
  // flipping the tier in the filter sheet re-runs the effect that
  // pushes cache pins to the WebView and the unwanted authors drop
  // off the map immediately. Mirrors the same fix HuntScreen got in
  // 306270c — the full map was the last surface still showing every
  // cache regardless of trust.
  const { isTrusted, wotTier } = useTrustGraph();
  // WoT bottom-sheet visibility — opened from the chip inside the
  // FilterSheet so the user can change tier without leaving the map.
  const [wotSheetVisible, setWotSheetVisible] = useState(false);
  // Legend bottom-sheet — opened from the new Legend button next to
  // Recenter at the map's bottom-left. Replaces the inline legend
  // strip that used to sit under the map and ate vertical space.
  const [legendVisible, setLegendVisible] = useState(false);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBbox = useRef<Bbox | null>(null);

  // The full-screen map looks cramped under the bottom tab bar, and the
  // tabs steal vertical space from the WebView. Hide them while we're
  // on this screen and restore on unmount. Per react-navigation v6 docs:
  // walk up to the parent Tab.Navigator and set tabBarStyle dynamically.
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => {
      parent?.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation]);

  // Persist the last map viewport so re-opening the Map doesn't snap
  // back to London while we wait for the GPS resolve. Hydrated in a
  // useEffect on mount (async, can't be a useState init) and written on
  // every `moveend` / `zoomend` (debounced inside the WebView's bounds
  // event). One global slot — multiple maps would just race on the key.
  const VIEWPORT_KEY = '@lp:map-viewport';
  const lastViewport = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const hydratedViewport = useRef(false);
  // Render-gate. AsyncStorage is async, so on first render the WebView
  // would otherwise mount with `injectedJavaScriptBeforeContentLoaded`
  // referencing a not-yet-hydrated viewport and fall through to the
  // London default. We block the WebView render until hydration
  // finishes so the injected JS always carries the correct slot.
  const [viewportHydrated, setViewportHydrated] = useState(false);

  const [permission, setPermission] = useState<PermissionState>('unknown');
  // User position state — kept here so LibreMiniMap (interactive full-
  // screen variant) can render the GPS dot + accuracy halo. The WebView
  // path reads via injectJavaScript on resolve; the LibreMiniMap path
  // reads declaratively from this state.
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(
    null,
  );
  const [places, setPlaces] = useState<BtcMapPlace[]>([]);
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());
  const [selected, setSelected] = useState<BtcMapPlace | null>(null);
  const [selectedCache, setSelectedCache] = useState<ParsedCache | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Default: every pin type visible. The filter sheet flips these
  // independently so users can isolate (say) just Piglets near them.
  const [filters, setFilters] = useState({
    lightning: true,
    onchain: true,
    piglet: true,
    nipgcCache: true,
  });
  // BTC Map category filter — empty set means "show every category"
  // (default). Adding a category to the set narrows to just those.
  // Multiple categories OR together (intersection semantics would
  // filter most merchants out since each has 0-2 categories).
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const cachesCloserRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);

  // ------- permissions + initial position --------------------------------

  // Hydrate the last-saved viewport before the WebView bridge resolves.
  // If found, we'll inject it instead of letting the location-resolve
  // flow re-centre — the user picks up exactly where they left off.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(VIEWPORT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { lat: number; lng: number; zoom: number };
          // Detect the legacy bug where Leaflet's hardcoded London fallback
          // got persisted as the "user's last viewport" via the initial
          // setView's moveend. Treat that exact triple as unhydrated and
          // wipe the slot so the GPS-centre branch takes over.
          const isLondonFallback =
            Math.abs(parsed.lat - 51.5074) < 1e-4 &&
            Math.abs(parsed.lng - -0.1278) < 1e-4 &&
            parsed.zoom === 12;
          if (
            Number.isFinite(parsed.lat) &&
            Number.isFinite(parsed.lng) &&
            Number.isFinite(parsed.zoom) &&
            !isLondonFallback
          ) {
            lastViewport.current = parsed;
            hydratedViewport.current = true;
          } else if (isLondonFallback) {
            await AsyncStorage.removeItem(VIEWPORT_KEY).catch(() => {});
          }
        }
      } catch {
        // Storage IO is best-effort — fall through to GPS-centre flow.
      } finally {
        // Always flip — even on miss / IO error the WebView should
        // render (it'll just open at the London fallback for users
        // with no saved viewport yet).
        setViewportHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Dev-only emulator fallback (see `getDevPinnedLocation`).
      const pinned = getDevPinnedLocation();
      let lat: number;
      let lon: number;
      let accuracy: number | null = null;
      if (pinned) {
        lat = pinned.lat;
        lon = pinned.lon;
        // Dev-pinned position is a literal lat/lon — no real-world
        // accuracy applies. Leaving accuracy null suppresses the
        // halo (drawAccuracyCircle no-ops on null) so the dev pin
        // doesn't imply false-precision.
        accuracy = null;
        setPermission('granted');
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setPermission('denied');
          return;
        }
        setPermission('granted');
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          accuracy = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null;
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
          return;
        }
      }
      try {
        if (cancelled) return;
        // Mirror lat/lon/accuracy into state so the LibreMiniMap path
        // can render the GPS dot + accuracy halo. WebView path keeps
        // using its injectJavaScript flow below.
        setPos({ lat, lon, accuracy });
        // Wider initial bbox + lower default zoom so rural users (no
        // Bitcoin merchants within walking distance) see at least a
        // few drive-away pins on first paint. They can zoom in from
        // here; Leaflet refetches on `moveend`/`zoomend` via the
        // bounds bridge.
        const initBbox = bboxAround(lat, lon, 0.3);
        lastBbox.current = initBbox;
        // Queue the viewport BEFORE awaiting BTC Map — the WebView
        // bridge fires `ready` in parallel with the (potentially slow)
        // merchant fetch, and we want the map centred on the user
        // regardless of whether the BTC-merchant query has come back.
        //
        // If we already hydrated a saved viewport, prefer it over the
        // fresh GPS centre — the user explicitly chose that pan/zoom
        // last session and snapping them back to "where you are" feels
        // hostile. We still drop a `me` marker at GPS so they know
        // where they are; the recentre button + recenterOnUser puts
        // them back on themselves on demand.
        if (hydratedViewport.current && lastViewport.current) {
          const v = lastViewport.current;
          setViewportInWebView(v.lat, v.lng, v.zoom);
          // Drop a me-marker at GPS without re-centring.
          if (webviewReady && webviewRef.current) {
            const js = `window.LP_setMeMarker && window.LP_setMeMarker(${lat}, ${lon}, ${accuracy ?? 'null'}); true;`;
            webviewRef.current.injectJavaScript(js);
          }
        } else {
          setViewportInWebView(lat, lon, 10, accuracy);
        }
        // LibreMiniMap fires onRegionDidChange shortly after mount with
        // its actual viewport — that bounds-driven fetch is now the
        // single source of truth for the visible-merchants set. (The
        // previous WebView path used to fetch the wider init bbox here
        // because Leaflet's first `bounds` message coincided with
        // `ready`; with native MapLibre the bounds event fires
        // separately so we just let it lead.)

        // Subscribe to NIP-GC kind 37516 caches in the user's coarse
        // geohash neighbourhood. Renders Lightning Piggies (com.lightningpiggy.app
        // label) AND standard NIP-GC caches (treasures.to /
        // TapTheSatsMap / etc.) as a different pin glyph alongside
        // BTC Map merchants. See project memory `treasures.to interop`.
        const myGeohash = encodeGeohash(lat, lon, 7);
        const prefixes = geohashPrefixes(myGeohash, 5).filter((p) => p.length === 5);
        cachesCloserRef.current?.();
        cachesCloserRef.current = subscribeNearbyCaches(prefixes, (cache) => {
          setCaches((prev) => {
            const existing = prev.get(cache.coord);
            if (existing && existing.createdAt >= cache.createdAt) return prev;
            const next = new Map(prev);
            next.set(cache.coord, cache);
            return next;
          });
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      cachesCloserRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- WebView communication ----------------------------------------

  // Queues the most-recent intended viewport so we can re-issue it
  // once the WebView bridge fires its `ready` message. Without this
  // the initial location-resolve happens before `LP_setViewport`
  // exists inside the WebView and the call no-ops, leaving the map
  // stranded on Leaflet's hardcoded London fallback.
  const pendingViewport = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  const setViewportInWebView = useCallback(
    (lat: number, lng: number, zoom: number, accuracyMetres: number | null = null) => {
      pendingViewport.current = { lat, lng, zoom };
      if (!webviewRef.current || !webviewReady) return;
      // accuracy is optional — null suppresses the halo (dev pin or
      // platforms that don't report). The shared drawAccuracyCircle
      // in src/utils/mapMeDot.ts no-ops on null.
      const js = `window.LP_setViewport && window.LP_setViewport(${lat}, ${lng}, ${zoom}, ${accuracyMetres ?? 'null'}); true;`;
      webviewRef.current.injectJavaScript(js);
    },
    [webviewReady],
  );

  // Replay the pending viewport once the bridge comes up.
  useEffect(() => {
    if (!webviewReady) return;
    const v = pendingViewport.current;
    if (!v || !webviewRef.current) return;
    const js = `window.LP_setViewport && window.LP_setViewport(${v.lat}, ${v.lng}, ${v.zoom}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, [webviewReady]);

  const sendMarkers = useCallback((list: BtcMapPlace[]) => {
    if (!webviewRef.current) return;
    const payload = list.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lon,
      lightning: acceptsLightning(p),
      // BTC Map's curated category glyph (Material Symbols name). Falls
      // back to 'storefront' in the WebView when missing so every pin
      // still gets an obvious shop-shaped marker.
      icon: p.icon ?? 'storefront',
    }));
    const js = `window.LP_setMarkers && window.LP_setMarkers(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, []);

  const sendCaches = useCallback((list: ParsedCache[]) => {
    if (!webviewRef.current) return;
    const payload = list
      .filter((c) => c.geohash) // skip caches with no location
      .map((c) => ({
        coord: c.coord,
        // Decode the longest geohash back to lat/lon — quick and
        // dirty by inverse-bisection inline; for now we'll request
        // each cache's lat/lon to come pre-decoded from a separate
        // helper. The simplest path: caches with multi-precision g
        // tags from precision 9 give us ~5 m resolution which is
        // plenty for a pin. We use the longest tag's geohash decoded
        // via a tiny inverse-encode (TODO: extract).
        ...decodeGeohash(c.geohash as string),
        kind: c.isLpPiggy ? 'piggy' : 'cache',
      }));
    const js = `window.LP_setCaches && window.LP_setCaches(${JSON.stringify(payload)}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, []);

  // Re-emit markers any time `places` or pin-type filters change. The
  // filter sheet flips lightning / onchain / piglet / nipgcCache flags;
  // we apply them here so the WebView only ever sees the visible
  // subset, keeping Leaflet layer state in sync without extra bridge
  // calls.
  useEffect(() => {
    if (!webviewReady) return;
    const filtered = places.filter((p) => {
      // Pin-type filter — Lightning vs On-chain.
      const typeOk = acceptsLightning(p)
        ? filters.lightning
        : acceptsOnchain(p)
          ? filters.onchain
          : filters.lightning || filters.onchain;
      if (!typeOk) return false;
      // Category filter — empty set = show every category.
      if (categoryFilter.size === 0) return true;
      const cats = p.categories ?? [];
      return cats.some((c) => categoryFilter.has(c));
    });
    sendMarkers(filtered);
  }, [places, webviewReady, filters.lightning, filters.onchain, categoryFilter, sendMarkers]);

  // Distinct categories across the currently-loaded places — fed into
  // the FilterSheet so the available chips reflect what's actually on
  // the map right now (rather than BTC Map's whole taxonomy).
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of places) for (const c of p.categories ?? []) seen.add(c);
    return [...seen].sort();
  }, [places]);

  // Filtered arrays for the LibreMiniMap path. Mirrors the same predicates
  // the WebView path applies via `sendMarkers` / `sendCaches`, but as
  // memoised derived state so LibreMiniMap's markers list is the filter
  // truth — no imperative bridge calls needed.
  const visibleMerchants = useMemo(() => {
    return places.filter((p) => {
      const typeOk = acceptsLightning(p)
        ? filters.lightning
        : acceptsOnchain(p)
          ? filters.onchain
          : filters.lightning || filters.onchain;
      if (!typeOk) return false;
      if (categoryFilter.size === 0) return true;
      const cats = p.categories ?? [];
      return cats.some((c) => categoryFilter.has(c));
    });
  }, [places, filters.lightning, filters.onchain, categoryFilter]);

  const visibleCaches = useMemo(() => {
    return [...caches.values()].filter(
      (c) =>
        (c.isLpPiggy ? filters.piglet : filters.nipgcCache) && isTrusted(c.hiderPubkey),
    );
  }, [caches, filters.piglet, filters.nipgcCache, isTrusted]);

  // Bounds-change handler for the LibreMiniMap path is defined below
  // (after refreshPlaces). Keeping the declaration order matches the
  // existing WebView flow where the onMessage handler also references
  // refreshPlaces.

  useEffect(() => {
    if (!webviewReady) return;
    const filtered = [...caches.values()].filter(
      (c) =>
        // Type chip — Piglet vs vanilla NIP-GC.
        (c.isLpPiggy ? filters.piglet : filters.nipgcCache) &&
        // Web-of-Trust gate — same rule the Hunt list applies. An
        // untrusted-publisher pin only shows when the user explicitly
        // sets WoT to "All" (the predicate returns true unconditionally
        // in that tier).
        isTrusted(c.hiderPubkey),
    );
    sendCaches(filtered);
  }, [caches, webviewReady, filters.piglet, filters.nipgcCache, sendCaches, isTrusted]);

  const refreshPlaces = useCallback(async (bbox: Bbox) => {
    try {
      const list = await fetchPlacesInBbox(bbox);
      setPlaces(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Bounds-change handler for the LibreMiniMap path. Mirrors the WebView
  // path's debounce + viewport-persist behaviour: 500 ms after the camera
  // settles we re-fetch the merchant set for the visible bbox and write
  // the centre back to AsyncStorage so reopening the screen starts where
  // the user left off.
  const onLibreBounds = useCallback(
    (bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }) => {
      const next: Bbox = bbox;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        lastBbox.current = next;
        refreshPlaces(next);
        const centreLat = (next.minLat + next.maxLat) / 2;
        const centreLng = (next.minLon + next.maxLon) / 2;
        const span = next.maxLat - next.minLat;
        const inferredZoom = Math.max(3, Math.min(18, Math.round(8 - Math.log2(span))));
        const v = { lat: centreLat, lng: centreLng, zoom: inferredZoom };
        lastViewport.current = v;
        AsyncStorage.setItem(VIEWPORT_KEY, JSON.stringify(v)).catch(() => {});
      }, 500);
    },
    [refreshPlaces],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        setWebviewReady(true);
      } else if (msg.type === 'bounds' && msg.bbox) {
        const next = msg.bbox;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          lastBbox.current = next;
          refreshPlaces(next);
        }, 500);
        // Persist centre + zoom only when the move was user-initiated —
        // never persist programmatic LP_setViewport calls or Leaflet's
        // own initial setView fallback, otherwise London (the bootstrap
        // default) gets baked in as the user's "last viewport" forever.
        if (
          msg.userInitiated === true &&
          typeof msg.centre?.lat === 'number' &&
          typeof msg.centre?.lng === 'number' &&
          typeof msg.zoom === 'number'
        ) {
          const v = { lat: msg.centre.lat, lng: msg.centre.lng, zoom: msg.zoom };
          lastViewport.current = v;
          AsyncStorage.setItem(VIEWPORT_KEY, JSON.stringify(v)).catch(() => {});
        }
      } else if (msg.type === 'markerTap' && typeof msg.id === 'number') {
        const hit = places.find((p) => p.id === msg.id);
        if (hit) setSelected(hit);
      } else if (msg.type === 'cacheTap' && typeof msg.coord === 'string') {
        // Mirror the merchant flow: preview the cache in a bottom sheet
        // first, then let the user opt into the full HuntPiggyDetail
        // page via "View details". Jumping straight to a stack push
        // burns navigation context that's expensive to recover when the
        // user just wanted a quick look.
        const hit = caches.get(msg.coord);
        if (hit) setSelectedCache(hit);
      }
    },
    [places, caches, refreshPlaces],
  );

  const recenterOnUser = useCallback(async () => {
    // Dev-pin first — the same override the initial-position effect
    // honours (see line 200). Without this, the recenter button on the
    // emulator ignores EXPO_PUBLIC_DEV_LAT/LON and jumps to the
    // AVD's real fused-location fix (typically Mountain View), which
    // contradicts every other location surface in the app.
    const pinned = getDevPinnedLocation();
    if (pinned) {
      setViewportInWebView(pinned.lat, pinned.lon, 15);
      return;
    }
    if (permission !== 'granted') return;
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setViewportInWebView(
        pos.coords.latitude,
        pos.coords.longitude,
        15,
        typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [permission, setViewportInWebView]);

  // ------- render --------------------------------------------------------

  if (permission === 'denied') {
    return (
      <View style={styles.container} testID="map-screen">
        <Header
          onBack={() => navigation.goBack()}
          onOpenFilters={() => setFiltersOpen(true)}
          colors={colors}
        />
        <View style={styles.deniedBody}>
          <MapPin size={64} color={colors.textSupplementary} strokeWidth={1.5} />
          <Text style={styles.deniedTitle}>Location permission required</Text>
          <Text style={styles.deniedSubtitle}>
            We use your location to show nearby Bitcoin merchants. Grant location access in Settings
            to enable this map.
          </Text>
          <TouchableOpacity
            style={styles.deniedButton}
            onPress={() => navigation.goBack()}
            testID="map-permission-back-button"
          >
            <Text style={styles.deniedButtonText}>Back to Explore</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="map-screen">
      <Header
        onBack={() => navigation.goBack()}
        onOpenFilters={() => setFiltersOpen(true)}
        colors={colors}
      />
      <View style={styles.webviewWrapper}>
        <LibreMiniMap
          lat={pos?.lat ?? null}
          lon={pos?.lon ?? null}
          userAccuracyMetres={pos?.accuracy ?? null}
          merchants={visibleMerchants}
          caches={visibleCaches}
          events={[]}
          interactive
          fill
          onBoundsChange={onLibreBounds}
          onSelectMerchant={(m) => setSelected(m)}
          onSelectCache={(c) => setSelectedCache(c)}
          onOpenLegend={() => setLegendVisible(true)}
        />
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text style={styles.footerError}>{error}</Text>
        ) : (
          <Text style={styles.footerText}>
            {places.length} merchants
            {caches.size > 0
              ? ` · ${[...caches.values()].filter((c) => c.isLpPiggy).length} Piglets · ${
                  [...caches.values()].filter((c) => !c.isLpPiggy).length
                } caches`
              : ''}
          </Text>
        )}
      </View>

      {selected && (
        <MerchantDetailSheet
          place={selected}
          onClose={() => setSelected(null)}
          onViewDetails={() => {
            const placeId = selected.id;
            setSelected(null);
            navigation.navigate('PlaceDetail', { placeId });
          }}
          colors={colors}
          styles={styles}
        />
      )}

      {selectedCache && (
        <CacheDetailSheet
          cache={selectedCache}
          onClose={() => setSelectedCache(null)}
          onViewDetails={() => {
            const coord = selectedCache.coord;
            setSelectedCache(null);
            navigation.navigate('HuntPiggyDetail', { coord });
          }}
          colors={colors}
          styles={styles}
        />
      )}

      {filtersOpen && (
        <FilterSheet
          filters={filters}
          onChange={setFilters}
          availableCategories={availableCategories}
          categoryFilter={categoryFilter}
          onChangeCategoryFilter={setCategoryFilter}
          onClose={() => setFiltersOpen(false)}
          wotTier={wotTier}
          untrustedCacheCount={
            // Caches that would render if the WoT filter were "All".
            // Computed each render; cheap because `caches` is small.
            [...caches.values()].filter(
              (c) =>
                (c.isLpPiggy ? filters.piglet : filters.nipgcCache) && !isTrusted(c.hiderPubkey),
            ).length
          }
          onOpenWotPicker={() => setWotSheetVisible(true)}
          colors={colors}
          styles={styles}
        />
      )}

      <WebOfTrustBottomSheet visible={wotSheetVisible} onClose={() => setWotSheetVisible(false)} />

      <LegendSheet
        visible={legendVisible}
        onClose={() => setLegendVisible(false)}
        placesVisible={filters.lightning || filters.onchain}
        availableCategories={availableCategories}
      />

    </View>
  );
};

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

const Header: React.FC<{
  onBack: () => void;
  onOpenFilters: () => void;
  colors: Palette;
}> = ({ onBack, onOpenFilters, colors }) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityLabel="Back to Explore"
        testID="map-back-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Map</Text>
      <TouchableOpacity
        onPress={onOpenFilters}
        accessibilityLabel="Filter pins on map"
        testID="map-filter-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <SlidersHorizontal size={22} color={colors.white} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
};

// Swipe-down dismiss for the three custom bottom-sheets on this screen
// (Merchant / Cache / Filter). They use a hand-rolled sheet pattern
// rather than Gorhom's BottomSheetModal — so we wire a PanResponder
// here rather than getting it for free. Same gesture rules across all
// three so they behave consistently:
//   • Drag down past 100 px OR release with vy > 0.5 → dismiss
//   • Otherwise spring back to 0
//   • Upward drag clamped so the sheet doesn't fly up past its anchor
// Returns the translateY value + PanResponder handlers; callers wrap
// the sheet body in Animated.View and spread the handlers on the
// drag-affordance (the handle bar).
function useDismissibleSheet(onClose: () => void): {
  translateY: Animated.Value;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
} {
  const translateY = useRef(new Animated.Value(0)).current;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => {
        // Clamp upward drag — the sheet shouldn't rise past its
        // anchor since there's nowhere meaningful for it to go.
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_e, g) => {
        const dismiss = g.dy > 100 || g.vy > 0.5;
        if (dismiss) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 80,
          }).start();
        }
      },
    }),
  ).current;
  return { translateY, panHandlers: responder.panHandlers };
}

const MerchantDetailSheet: React.FC<{
  place: BtcMapPlace;
  onClose: () => void;
  onViewDetails: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ place, onClose, onViewDetails, colors, styles }) => {
  const { translateY, panHandlers } = useDismissibleSheet(onClose);
  const days = daysSinceVerified(place);
  const lud16 = lightningAddressOf(place);
  const verifyText =
    days === null
      ? null
      : days === 0
        ? 'Verified today via OSM'
        : days === 1
          ? 'Verified 1 day ago via OSM'
          : `Verified ${days} days ago via OSM`;

  return (
    <View style={styles.sheetBackdrop} testID="merchant-detail-screen">
      <TouchableOpacity style={styles.sheetTapAway} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {/* PanResponder lives on the handle bar so vertical drags from
            the rest of the sheet body don't fight inner ScrollViews
            (the Categories list etc.). Drag the handle down to
            dismiss; spring back if released early. */}
        <View {...panHandlers} style={styles.sheetHandleGrabber} testID="merchant-detail-grabber">
          <View style={styles.sheetHandle} />
        </View>
        <View style={styles.sheetTitleRow}>
          {(() => {
            const CategoryIcon = btcMapIconComponent(place.icon);
            return (
              <View style={styles.sheetIconWrap}>
                <CategoryIcon size={18} color={colors.brandPink} strokeWidth={2.5} />
              </View>
            );
          })()}
          <Text style={styles.sheetTitle} testID="merchant-detail-name">
            {place.tags.name ?? 'Unnamed merchant'}
          </Text>
        </View>
        <Text style={styles.sheetSubtitle}>{formatAddress(place)}</Text>
        <View style={styles.sheetChipRow}>
          {isBoosted(place) && (
            <View style={styles.sheetChipFeatured} testID="merchant-detail-featured">
              <Sparkles size={12} color={colors.textHeader} strokeWidth={2.5} />
              <Text style={styles.sheetChipFeaturedText}>Featured</Text>
            </View>
          )}
          {acceptsLightning(place) && (
            <View style={styles.sheetChipPink}>
              <Zap size={12} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.sheetChipPinkText}>Lightning</Text>
            </View>
          )}
          {acceptsOnchain(place) && (
            <View style={styles.sheetChipOrange}>
              <Text style={styles.sheetChipOrangeText}>On-chain</Text>
            </View>
          )}
        </View>
        {place.description ? (
          <Text style={styles.sheetDescription} numberOfLines={4}>
            {place.description}
          </Text>
        ) : null}
        {place.opening_hours ? (
          <View style={styles.sheetMetaRow}>
            <Clock size={13} color={colors.textSupplementary} strokeWidth={2.5} />
            <Text style={styles.sheetMetaText} numberOfLines={2}>
              {place.opening_hours}
            </Text>
          </View>
        ) : null}
        {verifyText && <Text style={styles.sheetVerify}>{verifyText}</Text>}
        {(place.tags['contact:website'] ||
          place.phone ||
          place.email ||
          place.facebookUrl ||
          place.twitterUrl ||
          place.instagramUrl) && (
          <View style={styles.sheetContactRow}>
            {place.tags['contact:website'] ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(place.tags['contact:website']!)}
                testID="merchant-detail-website"
                accessibilityLabel="Open website"
              >
                <Globe size={13} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  Website
                </Text>
              </TouchableOpacity>
            ) : null}
            {place.phone ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(`tel:${place.phone!.replace(/\s+/g, '')}`)}
                testID="merchant-detail-phone"
                accessibilityLabel={`Call ${place.phone}`}
              >
                <Phone size={13} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  {place.phone}
                </Text>
              </TouchableOpacity>
            ) : null}
            {place.email ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(`mailto:${place.email!}`)}
                testID="merchant-detail-email"
                accessibilityLabel={`Email ${place.email}`}
              >
                <Mail size={13} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  Email
                </Text>
              </TouchableOpacity>
            ) : null}
            {place.facebookUrl ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(place.facebookUrl!).catch(() => {})}
                testID="merchant-detail-facebook"
                accessibilityLabel="Open Facebook page"
              >
                <SocialIcon network="facebook" size={14} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  Facebook
                </Text>
              </TouchableOpacity>
            ) : null}
            {place.twitterUrl ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(place.twitterUrl!).catch(() => {})}
                testID="merchant-detail-x"
                accessibilityLabel="Open X profile"
              >
                <SocialIcon network="x" size={14} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  X
                </Text>
              </TouchableOpacity>
            ) : null}
            {place.instagramUrl ? (
              <TouchableOpacity
                style={styles.sheetContactChip}
                onPress={() => Linking.openURL(place.instagramUrl!).catch(() => {})}
                testID="merchant-detail-instagram"
                accessibilityLabel="Open Instagram"
              >
                <SocialIcon network="instagram" size={14} />
                <Text style={styles.sheetContactText} numberOfLines={1}>
                  Instagram
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={[styles.sheetButton, !lud16 && styles.sheetButtonDisabled]}
            disabled={!lud16}
            onPress={() => {
              if (!lud16) return;
              onClose();
              // SendSheet pre-fill is handled in milestone 4 alongside the
              // payment plumbing; for now we close the sheet so the user
              // sees the address. TODO(#467): wire to SendSheet when M4
              // adds the lud16 entry-path on the Home tab.
            }}
            testID="merchant-detail-pay-button"
            accessibilityLabel={lud16 ? `Pay ${lud16}` : 'No Lightning Address available'}
          >
            <Zap size={16} color={colors.white} strokeWidth={2.5} />
            {/* Keep the label "Pay" in both states — the disabled
                surface treatment already communicates non-availability,
                and the long "No Lightning address" string wraps awkwardly
                on small screens. Screen readers still get the
                disambiguating context via accessibilityLabel above. */}
            <Text style={styles.sheetButtonText}>Pay</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetButtonSecondary}
            onPress={onViewDetails}
            testID="merchant-detail-view-button"
            accessibilityLabel="Open place detail"
          >
            <Text style={styles.sheetButtonSecondaryText}>View details</Text>
          </TouchableOpacity>
        </View>
        {btcMapVerifyUrl(place) || btcMapMerchantUrl(place) ? (
          <View style={styles.sheetBtcMapActionsRow}>
            {btcMapVerifyUrl(place) ? (
              <TouchableOpacity
                style={styles.sheetBtcMapActionButton}
                onPress={() => Linking.openURL(btcMapVerifyUrl(place)!)}
                testID="merchant-detail-verify"
                accessibilityLabel="Verify this listing on BTC Map"
              >
                <ShieldCheck size={13} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.sheetBtcMapActionText}>Verify</Text>
              </TouchableOpacity>
            ) : null}
            {btcMapMerchantUrl(place) ? (
              <TouchableOpacity
                style={styles.sheetBtcMapActionButton}
                onPress={() => Linking.openURL(btcMapMerchantUrl(place)!)}
                testID="merchant-detail-suggest-edit"
                accessibilityLabel="Suggest an edit on BTC Map"
              >
                <Text style={styles.sheetBtcMapActionText}>Suggest an edit →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
};

const CacheDetailSheet: React.FC<{
  cache: ParsedCache;
  onClose: () => void;
  onViewDetails: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ cache, onClose, onViewDetails, colors, styles }) => {
  const { translateY, panHandlers } = useDismissibleSheet(onClose);
  const kindLabel = cache.isLpPiggy ? 'Piglet' : 'NIP-GC cache';
  const specBits = [
    cache.cacheType,
    cache.size,
    cache.difficulty != null ? `D${cache.difficulty}` : null,
    cache.terrain != null ? `T${cache.terrain}` : null,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.sheetBackdrop} testID="cache-detail-sheet">
      <TouchableOpacity style={styles.sheetTapAway} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View {...panHandlers} style={styles.sheetHandleGrabber} testID="cache-detail-grabber">
          <View style={styles.sheetHandle} />
        </View>
        <View style={styles.sheetTitleRow}>
          <View
            style={[
              styles.sheetIconWrap,
              {
                backgroundColor: cache.isLpPiggy ? colors.brandPink : colors.surface,
              },
            ]}
          >
            <PiggyBank
              size={18}
              color={cache.isLpPiggy ? colors.white : colors.brandPink}
              strokeWidth={2.5}
            />
          </View>
          <Text style={styles.sheetTitle} testID="cache-detail-name">
            {cache.name}
          </Text>
        </View>
        <View style={styles.sheetChipRow}>
          <View style={cache.isLpPiggy ? styles.sheetChipPink : styles.sheetChipGrey}>
            <Text style={cache.isLpPiggy ? styles.sheetChipPinkText : styles.sheetChipGreyText}>
              {kindLabel}
            </Text>
          </View>
          {specBits.length > 0 ? (
            <View style={styles.sheetChipGrey}>
              <Text style={styles.sheetChipGreyText}>{specBits.join(' · ')}</Text>
            </View>
          ) : null}
        </View>
        {cache.description ? (
          <Text style={styles.sheetDescription} numberOfLines={4}>
            {cache.description}
          </Text>
        ) : null}
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={styles.sheetButton}
            onPress={onViewDetails}
            testID="cache-detail-view-button"
            accessibilityLabel={`Open ${kindLabel} detail`}
          >
            <Text style={styles.sheetButtonText}>View details</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

type PinFilters = {
  lightning: boolean;
  onchain: boolean;
  piglet: boolean;
  nipgcCache: boolean;
};

interface FilterOption {
  key: keyof PinFilters;
  label: string;
  hint: string;
  swatch: string;
  diamond?: boolean;
}

// Filter rows grouped by intent so the user can scan "places" vs
// "geo-caches" without parsing the colour-swatch idiom. Each row is
// still an independent toggle — there's no master "Show all places"
// switch (unticking the two beneath it gives the same result).
const PLACES_FILTERS: ReadonlyArray<FilterOption> = [
  { key: 'lightning', label: 'Lightning', hint: 'Pays in sats over Lightning', swatch: '#EC008C' },
  { key: 'onchain', label: 'On-chain', hint: 'Accepts bitcoin on-chain', swatch: '#F7931A' },
];

const CACHE_FILTERS: ReadonlyArray<FilterOption> = [
  {
    key: 'piglet',
    label: 'Piglet',
    hint: 'Lightning Piggy stash',
    swatch: '#EC008C',
    diamond: true,
  },
  {
    key: 'nipgcCache',
    label: 'NIP-GC cache',
    hint: 'Geo-cache (treasures.to et al.)',
    swatch: '#7A5CFF',
    diamond: true,
  },
];

const FilterSheet: React.FC<{
  filters: PinFilters;
  onChange: (next: PinFilters) => void;
  availableCategories: string[];
  categoryFilter: Set<string>;
  onChangeCategoryFilter: (next: Set<string>) => void;
  onClose: () => void;
  wotTier: 'friends' | 'fof' | 'all';
  untrustedCacheCount: number;
  onOpenWotPicker: () => void;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({
  filters,
  onChange,
  availableCategories,
  categoryFilter,
  onChangeCategoryFilter,
  onClose,
  wotTier,
  untrustedCacheCount,
  onOpenWotPicker,
  colors,
  styles,
}) => {
  const toggle = (k: keyof PinFilters) => onChange({ ...filters, [k]: !filters[k] });
  // Render one filter row — extracted so the Places and Geo-caches
  // sections can share the same swatch + toggle layout without
  // duplicating ~20 lines of JSX. Closes over `filters` + `styles` +
  // `toggle` from the FilterSheet scope.
  const renderFilterRow = (opt: FilterOption) => {
    const on = filters[opt.key];
    return (
      <TouchableOpacity
        key={opt.key}
        style={styles.filterRow}
        onPress={() => toggle(opt.key)}
        testID={`map-filter-${opt.key}`}
        accessibilityLabel={`${opt.label} pins ${on ? 'on' : 'off'}`}
      >
        <View
          style={[
            opt.diamond ? styles.filterSwatchDiamond : styles.filterSwatchDot,
            { backgroundColor: opt.swatch },
          ]}
        />
        <View style={styles.filterTextWrap}>
          <Text style={styles.filterLabel}>{opt.label}</Text>
          <Text style={styles.filterHint}>{opt.hint}</Text>
        </View>
        <View style={[styles.filterToggle, on && styles.filterToggleOn]}>
          <View style={[styles.filterToggleThumb, on && styles.filterToggleThumbOn]} />
        </View>
      </TouchableOpacity>
    );
  };
  const toggleCategory = (cat: string) => {
    const next = new Set(categoryFilter);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    onChangeCategoryFilter(next);
  };
  const clearCategories = () => onChangeCategoryFilter(new Set());
  const { translateY, panHandlers } = useDismissibleSheet(onClose);
  return (
    <View style={styles.sheetBackdrop} testID="map-filter-sheet">
      <TouchableOpacity style={styles.sheetTapAway} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View {...panHandlers} style={styles.sheetHandleGrabber} testID="map-filter-grabber">
          <View style={styles.sheetHandle} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Web-of-Trust — chip + tap-to-open-sheet. Mirrors the same
              affordance on the Hunt filter so the user can change tier
              without leaving the map. The "N hidden" caption explains
              when the current tier is hiding pins they might expect to
              see (the cause of the "where did all the geo-caches go?"
              moment that prompted #19 to grow this filter UI). */}
          <Text style={styles.sheetTitle}>Web of Trust</Text>
          <View style={styles.wotRow}>
            <WebOfTrustChip
              currentTier={wotTier}
              onPress={onOpenWotPicker}
              testID="map-filter-wot-chip"
            />
            {untrustedCacheCount > 0 ? (
              <Text style={styles.wotHiddenCount}>{untrustedCacheCount} hidden</Text>
            ) : null}
          </View>
          <Text style={[styles.sheetSubtitle, { marginBottom: 16 }]}>
            Only caches from hiders you trust at the current tier appear on the map. Tap the chip to
            widen the tier.
          </Text>

          <Text style={styles.sheetTitle}>Places</Text>
          <Text style={styles.sheetSubtitle}>Bitcoin-accepting merchants from BTC Map.</Text>
          <View style={{ marginTop: 8 }}>{PLACES_FILTERS.map(renderFilterRow)}</View>

          <Text style={[styles.sheetTitle, { marginTop: 20 }]}>Geo-caches</Text>
          <Text style={styles.sheetSubtitle}>Piglets and standard NIP-GC stashes.</Text>
          <View style={{ marginTop: 8 }}>{CACHE_FILTERS.map(renderFilterRow)}</View>

          {availableCategories.length > 0 ? (
            <View style={{ marginTop: 16, paddingBottom: 24 }}>
              <View style={styles.categoryHeaderRow}>
                <Text style={styles.sheetTitle}>Categories</Text>
                {categoryFilter.size > 0 ? (
                  <TouchableOpacity
                    onPress={clearCategories}
                    testID="map-filter-categories-clear"
                    accessibilityLabel="Clear category filter"
                  >
                    <Text style={styles.categoryClearText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.sheetSubtitle}>
                {categoryFilter.size === 0
                  ? 'Tap to narrow to one or more BTC Map categories.'
                  : `${categoryFilter.size} selected`}
              </Text>
              <View style={styles.categoryChipsWrap}>
                {availableCategories.map((cat) => {
                  const on = categoryFilter.has(cat);
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => toggleCategory(cat)}
                      style={[
                        styles.categoryChip,
                        on ? styles.categoryChipOn : styles.categoryChipOff,
                      ]}
                      testID={`map-filter-category-${cat}`}
                      accessibilityLabel={`${cat} category ${on ? 'on' : 'off'}`}
                    >
                      <Text
                        style={[styles.categoryChipText, on ? styles.categoryChipTextOn : null]}
                      >
                        {cat.replace(/_/g, ' ')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const bboxAround = (lat: number, lng: number, halfDegrees: number): Bbox => ({
  minLon: lng - halfDegrees,
  minLat: lat - halfDegrees,
  maxLon: lng + halfDegrees,
  maxLat: lat + halfDegrees,
});

// -----------------------------------------------------------------------------
// styles
// -----------------------------------------------------------------------------

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: {
      width: 24,
    },
    webviewWrapper: {
      flex: 1,
      position: 'relative',
    },
    webview: {
      flex: 1,
    },
    recenterButton: {
      position: 'absolute',
      left: 14,
      bottom: 14,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    // Legend button — sits just above the recenter at bottom-left so
    // the two map utilities cluster visually. Same surface treatment
    // as recenterButton (white circle + shadow) so they read as a pair.
    legendButton: {
      position: 'absolute',
      left: 14,
      bottom: 62,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    footer: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 14,
      rowGap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    legendDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    legendDiamond: {
      width: 11,
      height: 11,
      transform: [{ rotate: '45deg' }],
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    legendText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    footerText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    footerError: {
      fontSize: 13,
      color: colors.brandPink,
      fontWeight: '600',
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    deniedBody: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    deniedTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    deniedSubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
    deniedButton: {
      marginTop: 12,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 100,
    },
    deniedButtonText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
    },
    // ----- bottom sheet
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheetTapAway: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 28,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      gap: 8,
      // Cap so the FilterSheet's category list can scroll instead of
      // pushing the sheet off the top of the screen.
      maxHeight: '80%',
    },
    // Touch target around the visible handle bar — bigger than the
    // 4px-tall pill itself so a swipe from anywhere in the top of the
    // sheet actually reaches the PanResponder. Without this you'd
    // need pixel-precise drag aim.
    sheetHandleGrabber: {
      width: '100%',
      paddingVertical: 12,
      alignItems: 'center',
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      marginBottom: 6,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    sheetSubtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    wotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
    },
    wotHiddenCount: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    sheetChipRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 6,
    },
    sheetChipPink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipPinkText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetChipFeatured: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.zapYellow,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipFeaturedText: {
      color: colors.textHeader,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetChipGrey: {
      backgroundColor: colors.divider,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipGreyText: {
      color: colors.textSupplementary,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetChipOrange: {
      backgroundColor: '#F7931A',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    sheetChipOrangeText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetVerify: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
    },
    sheetDescription: {
      fontSize: 13,
      color: colors.textBody,
      lineHeight: 18,
      marginTop: 8,
      marginBottom: 4,
    },
    sheetActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 14,
    },
    sheetButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.brandPink,
      paddingVertical: 12,
      borderRadius: 100,
    },
    sheetButtonDisabled: {
      backgroundColor: colors.divider,
    },
    sheetButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '700',
    },
    sheetButtonSecondary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: 'transparent',
      paddingVertical: 12,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    sheetButtonSecondaryText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    sheetContactRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10,
    },
    sheetContactChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    sheetContactText: {
      color: colors.textHeader,
      fontSize: 12,
      fontWeight: '600',
      maxWidth: 160,
    },
    sheetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4,
    },
    sheetIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetBtcMapActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    sheetBtcMapActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    sheetBtcMapActionText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.brandPink,
    },
    sheetMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
    },
    sheetMetaText: {
      fontSize: 12,
      color: colors.textSupplementary,
      flexShrink: 1,
    },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    filterSwatchDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
    },
    filterSwatchDiamond: {
      width: 14,
      height: 14,
      transform: [{ rotate: '45deg' }],
    },
    filterTextWrap: {
      flex: 1,
    },
    filterLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    filterHint: {
      fontSize: 11,
      color: colors.textSupplementary,
      marginTop: 1,
    },
    filterToggle: {
      width: 40,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.divider,
      padding: 2,
      justifyContent: 'center',
    },
    filterToggleOn: {
      backgroundColor: colors.brandPink,
    },
    filterToggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.white,
    },
    filterToggleThumbOn: {
      transform: [{ translateX: 16 }],
    },
    categoryHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    categoryClearText: {
      color: colors.brandPink,
      fontSize: 13,
      fontWeight: '700',
    },
    categoryChipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    categoryChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
    },
    categoryChipOff: {
      backgroundColor: 'transparent',
      borderColor: colors.divider,
    },
    categoryChipOn: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    categoryChipText: {
      fontSize: 12,
      color: colors.textHeader,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    categoryChipTextOn: {
      color: colors.white,
    },
  });

export default MapScreen;
