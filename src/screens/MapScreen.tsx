import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  ScrollView,
  Animated,
  PanResponder,
  Dimensions,
  InteractionManager,
} from 'react-native';
import * as Location from 'expo-location';
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
import { createMapScreenStyles, type MapScreenStyles } from '../styles/MapScreen.styles';
import { ExploreNavigation, RootNavigation, ExploreStackParamList } from '../navigation/types';
import type { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import {
  Bbox,
  BtcMapPlace,
  acceptsLightning,
  acceptsOnchain,
  btcMapMerchantUrl,
  btcMapVerifyUrl,
  daysSinceVerified,
  fetchPlacesInBbox,
  peekCachedPlacesSync,
  formatAddress,
  isBoosted,
  lightningAddressOf,
} from '../services/btcMapService';
import type { ParsedCache } from '../services/nostrPlacesService';
import { useCoalescedMap } from '../utils/useCoalescedMap';
import { fetchCachesByAuthor, subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import { isHiddenInProd } from '../utils/exploreContentFilter';
import { useNostr } from '../contexts/NostrContext';
import { decodeGeohash, encodeGeohash, geohashNeighbours } from '../utils/geohash';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import SocialIcon from '../components/SocialIcon';
import WebOfTrustChip from '../components/WebOfTrustChip';
import WebOfTrustBottomSheet from '../components/WebOfTrustBottomSheet';
import LegendSheet from '../components/LegendSheet';
import { LibreMiniMap } from '../components/LibreMiniMap';
import { useUserLocation } from '../contexts/UserLocationContext';
import { useFriendsLiveLocations } from '../hooks/useFriendsLiveLocations';
import { useIsFocused } from '@react-navigation/native';

interface Props {
  // Composite so the back handler can return to the DM (`Conversation` is a
  // RootStack screen) when the Map is opened from a live-location card.
  navigation: CompositeNavigationProp<ExploreNavigation, RootNavigation>;
  route: RouteProp<ExploreStackParamList, 'Map'>;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

/**
 * Map sub-screen — discovers Bitcoin-accepting merchants near the user via
 * the BTC Map API (OSM-backed). Closes the foreground-browse part of #467;
 * the background-geofence + notifications part lands in milestone 3.
 *
 * Renderer is native MapLibre via the shared LibreMiniMap component (no
 * Google Maps, no API key, OSM tiles streamed from openstreetmap.org).
 */
const MapScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  // Tier-aware predicate from the Web-of-Trust context. `isTrusted`
  // already encodes the current wotTier (Friends / FoF / All), so
  // flipping the tier in the filter sheet re-runs the effect that
  // pushes cache pins to the WebView and the unwanted authors drop
  // off the map immediately. Mirrors the same fix HuntScreen got in
  // 306270c — the full map was the last surface still showing every
  // cache regardless of trust.
  const { isTrusted, wotTier } = useTrustGraph();
  const { pubkey: signedInPubkey, relays: userRelays, profile } = useNostr();
  // Friends currently sharing their live location with me — plotted as
  // circular avatar chips. Gated on screen focus so the underlying
  // kind-20069 ping subscriptions go quiet when a detail sheet/screen
  // covers the map or we navigate away (no background battery cost).
  const isFocused = useIsFocused();
  // Defer enabling the live-location subscription until the tab transition
  // settles (#824) — its backlog replay otherwise lands as a second setState
  // burst that competes with the navigation animation. Disables on blur.
  const [friendsEnabled, setFriendsEnabled] = useState(false);
  useEffect(() => {
    if (!isFocused) {
      setFriendsEnabled(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setFriendsEnabled(true));
    return () => task.cancel();
  }, [isFocused]);
  const friends = useFriendsLiveLocations({ enabled: friendsEnabled });
  const friendMarkers = useMemo(
    () => friends.map((f) => ({ key: f.pubkey, lat: f.lat, lon: f.lon, avatarUri: f.avatarUri })),
    [friends],
  );
  // WoT bottom-sheet visibility — opened from the chip inside the
  // FilterSheet so the user can change tier without leaving the map.
  const [wotSheetVisible, setWotSheetVisible] = useState(false);
  // Legend bottom-sheet — opened from the new Legend button next to
  // Recenter at the map's bottom-left. Replaces the inline legend
  // strip that used to sit under the map and ate vertical space.
  const [legendVisible, setLegendVisible] = useState(false);
  const styles = useMemo(() => createMapScreenStyles(colors), [colors]);
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

  const [permission, setPermission] = useState<PermissionState>('unknown');
  // User position state — kept here so LibreMiniMap (interactive full-
  // screen variant) can render the GPS dot + accuracy halo. The WebView
  // path reads via injectJavaScript on resolve; the LibreMiniMap path
  // reads declaratively from this state.
  const [pos, setPos] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(
    null,
  );
  // Live position for the user dot — refreshes as the user walks
  // around without re-centring the map (the camera stays anchored to
  // the user's initial pos so panning behaviour isn't fighting GPS).
  const { pos: livePos } = useUserLocation();
  // Seed synchronously from the warm BTC Map cache (#823) so the map paints
  // pins on the first frame instead of a blank map until the viewport fetch
  // returns — matches ExploreHomeScreen/PlacesScreen. The bbox fetch below
  // then refreshes them (stale-while-revalidate).
  const [places, setPlaces] = useState<BtcMapPlace[]>(() => peekCachedPlacesSync());
  // Coalesced (#824): a relay backlog flushed on (re)focus commits as ONE
  // setState per flush window instead of one Map-clone + render per event —
  // the per-event burst that froze the tab transition. `shouldReplace` keeps
  // the newest entry per coord (same rule the inline merges used).
  const caches = useCoalescedMap<ParsedCache>({
    shouldReplace: (existing, incoming) => incoming.createdAt > existing.createdAt,
  });
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

  // ------- permissions + initial position --------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      let lat: number;
      let lon: number;
      let accuracy: number | null = null;
      // Prefer the cached position from UserLocationContext when it's
      // already populated (the user just came from Explore / Hunt etc.,
      // so the shared watch has a recent fix). Running a second
      // independent getCurrentPositionAsync here used to race the
      // shared watch and snap the camera to a different, sometimes
      // less-accurate point. The dot stays live via `livePos` below.
      if (livePos !== null) {
        lat = livePos.lat;
        lon = livePos.lon;
        accuracy = livePos.accuracy;
      } else {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
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
        // Use 9-tile neighbourhood at precision 5 (centre + 8 surrounding
        // tiles) so caches sitting just over a tile boundary still match.
        // The plain-prefix path missed published Piglets in adjacent tiles
        // (e.g. user in u1219, caches in u1218/u1213) — see #631.
        const myTile = encodeGeohash(lat, lon, 5);
        const prefixes = geohashNeighbours(myTile);
        cachesCloserRef.current?.();
        cachesCloserRef.current = subscribeNearbyCaches(prefixes, (cache) => {
          // Hide the project's own test-account ("Piggy") Piglets on the
          // map in the production app; dev/preview keep them for Maestro.
          if (isHiddenInProd(cache.hiderPubkey)) return;
          caches.enqueue(cache.coord, cache);
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      cachesCloserRef.current?.();
      caches.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface the signed-in user's own published Piglets on the map even
  // when no nearby-geohash subscription has echoed them back. The
  // nearby sub filters by `#g` prefixes derived from the user's current
  // GPS — so a Piglet hidden outside that neighbourhood (e.g. away
  // from home, on holiday) wouldn't appear on the map without an
  // author-side fetch. Mirrors ExploreHomeScreen's by-author merge.
  // One-shot per pubkey via the ref so re-renders don't refire.
  const byAuthorFetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!signedInPubkey) return;
    if (byAuthorFetchedForRef.current === signedInPubkey) return;
    byAuthorFetchedForRef.current = signedInPubkey;
    let cancelled = false;
    const readRelays = userRelays.filter((r) => r.read).map((r) => r.url);
    fetchCachesByAuthor(signedInPubkey, readRelays.length > 0 ? readRelays : undefined)
      .then((mine) => {
        if (cancelled || mine.length === 0) return;
        for (const c of mine) caches.enqueue(c.coord, c);
        // One-shot fetch — flush now so the author's own pins commit on this
        // frame instead of waiting on the coalesce debounce (~100ms) when the
        // batch is under the flush threshold (Copilot review on #825).
        caches.flush();
      })
      .catch(() => {
        // Best-effort — the nearby subscription will fill the gap if the
        // user happens to be in the right neighbourhood.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caches.enqueue is stable; one-shot per (signedInPubkey, userRelays)
  }, [signedInPubkey, userRelays]);

  // Distinct categories across the currently-loaded places — fed into
  // the FilterSheet so the available chips reflect what's actually on
  // the map right now (rather than BTC Map's whole taxonomy).
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of places) for (const c of p.categories ?? []) seen.add(c);
    return [...seen].sort();
  }, [places]);

  // Single-pass Piglet / non-Piglet tally for the footer — avoids spreading +
  // filtering `caches.map.values()` twice every render (Copilot review on #825).
  const cacheCounts = useMemo(() => {
    let piglets = 0;
    let others = 0;
    for (const c of caches.map.values()) {
      if (c.isLpPiggy) piglets++;
      else others++;
    }
    return { piglets, others };
  }, [caches.map]);

  // Filtered arrays for LibreMiniMap. Same predicates the WebView path
  // used to send across the bridge — now plain memoised derived state.
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

  // Re-evaluate the NIP-40 expiry filter as time advances even if nothing else
  // changes — a cache can expire while the map just sits open. A 60s tick is
  // plenty (expiry is a slow day/year-scale boundary) and, unlike putting a
  // per-render `Date.now()` in the memo deps (which would recompute
  // visibleCaches every render), keeps the memo cached between ticks (#763).
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNowSec(Date.now() / 1000), 60_000);
    return () => clearInterval(t);
  }, []);

  const visibleCaches = useMemo(() => {
    // Drop NIP-40-expired caches — relays that don't honour expiration keep
    // serving them, so the client filters them out. The Geo-caches list
    // (HuntScreen) already does this; the map must too, else an expired Piglet
    // lingers on the map after it's gone from the list (#762).
    return [...caches.map.values()].filter(
      (c) =>
        !isHiddenInProd(c.hiderPubkey) &&
        (c.isLpPiggy ? filters.piglet : filters.nipgcCache) &&
        isTrusted(c.hiderPubkey) &&
        (c.expiresAt === null || c.expiresAt > nowSec),
    );
  }, [caches.map, filters.piglet, filters.nipgcCache, isTrusted, nowSec]);

  const refreshPlaces = useCallback(async (bbox: Bbox) => {
    try {
      const list = await fetchPlacesInBbox(bbox);
      setPlaces(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Bounds-change handler. 500 ms after the camera settles we re-fetch
  // the merchant set for the visible bbox and write the centre back to
  // AsyncStorage so reopening the screen starts where the user left off.
  const onLibreBounds = useCallback(
    (bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }) => {
      const next: Bbox = bbox;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        lastBbox.current = next;
        refreshPlaces(next);
        // Viewport-persist on every camera-settle is on the to-do list
        // (#552 follow-up — needs a matching hydrate effect on mount,
        // wire through to Camera.initialViewState). Removed the stub
        // write that Copilot caught — no point persisting if nothing
        // reads it back.
      }, 500);
    },
    [refreshPlaces],
  );

  // Back target: when opened from a DM live-location card the route carries
  // `returnTo`, so return to that conversation; otherwise pop the stack —
  // preserving back for the Explore / Places / Events / Hunt entry points.
  const handleBack = useCallback(() => {
    const returnTo = route.params?.returnTo;
    if (returnTo?.screen === 'Conversation') {
      // Pop this Map off the Explore stack first, otherwise it stays mounted
      // (with its returnTo param) underneath the DM and re-appears next time
      // the user visits the Explore tab.
      navigation.popToTop();
      navigation.navigate('Conversation', returnTo.params);
      return;
    }
    navigation.goBack();
  }, [navigation, route.params]);

  // The header + permission-screen back button can now return to a DM, so the
  // "Back to Explore" wording only fits the in-stack entry points.
  const backLabel = route.params?.returnTo ? 'Back' : 'Back to Explore';

  // ------- render --------------------------------------------------------

  if (permission === 'denied') {
    return (
      <View style={styles.container} testID="map-screen">
        <Header
          onBack={handleBack}
          onOpenFilters={() => setFiltersOpen(true)}
          colors={colors}
          backLabel={backLabel}
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
            onPress={handleBack}
            testID="map-permission-back-button"
          >
            <Text style={styles.deniedButtonText}>{backLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="map-screen">
      <Header
        onBack={handleBack}
        onOpenFilters={() => setFiltersOpen(true)}
        colors={colors}
        backLabel={backLabel}
      />
      <View style={styles.webviewWrapper}>
        <LibreMiniMap
          lat={pos?.lat ?? null}
          lon={pos?.lon ?? null}
          userLat={livePos?.lat ?? null}
          userLon={livePos?.lon ?? null}
          // Fall back to the initial fix's accuracy ONLY when there's
          // no live fix yet. If livePos exists but its accuracy is
          // null (platform didn't report it), pass null to suppress
          // the halo — using `pos.accuracy` here would draw a halo
          // around live coords using accuracy from a different fix.
          userAccuracyMetres={livePos ? livePos.accuracy : (pos?.accuracy ?? null)}
          userAvatarUri={profile?.picture ?? null}
          profileMarkers={friendMarkers}
          uniformMarkerSize={32}
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
            {caches.map.size > 0
              ? ` · ${cacheCounts.piglets} Piglets · ${cacheCounts.others} caches`
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
            [...caches.map.values()].filter(
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
  backLabel: string;
}> = ({ onBack, onOpenFilters, colors, backLabel }) => {
  const styles = useMemo(() => createMapScreenStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityLabel={backLabel}
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
          // Animate fully off-screen, not the old hard-coded 600 px.
          // The sheet has `maxHeight: '80%'`, so on a tall device
          // (Pixel 8 ≈ 2400 px) 80% is ~1920 px — translateY=600
          // left ~1320 px still visible at the moment we unmounted,
          // which the user saw as the sheet flashing back to full
          // size right before disappearing. Using the actual screen
          // height as the off-screen target makes the animation end
          // truly invisible before unmount.
          const screenHeight = Dimensions.get('window').height;
          Animated.timing(translateY, {
            toValue: screenHeight,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            // No translateY reset — the sheet unmounts on `onClose`
            // and the next mount creates a fresh translateY at 0
            // via useDismissibleSheet's useRef.
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
  styles: MapScreenStyles;
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
  styles: MapScreenStyles;
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
  styles: MapScreenStyles;
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

export default MapScreen;
