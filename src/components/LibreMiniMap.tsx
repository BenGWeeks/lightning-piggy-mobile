import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, TouchableOpacity, Text } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { NavigationContext } from '@react-navigation/native';
// Alias MapLibre's `Map` component so we can still use the built-in
// `Map<K,V>` global for the coord → source lookups below.
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import type { Feature, Polygon } from 'geojson';
import {
  Plus,
  Minus,
  Info,
  Maximize2,
  PiggyBank,
  MapPin,
  Calendar,
  LocateFixed,
  Crosshair,
  UserRound,
} from 'lucide-react-native';
import { type BtcMapPlace, acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import { decodeGeohash } from '../utils/geohash';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { useThemeColors } from '../contexts/ThemeContext';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import { createLibreMiniMapStyles } from '../styles/LibreMiniMap.styles';

// `useIsFocused()` throws "Couldn't find a navigation object" when the
// component renders OUTSIDE a navigator — e.g. inside a Gorhom
// bottom-sheet modal, which mounts through a portal detached from the
// navigation tree (the location picker, #681). Read the navigation
// context directly (it's `undefined`, not a throw, when absent) and
// treat "no navigator" as always-focused, since a sheet map is only
// mounted while it's on screen.
function useIsFocusedSafe(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (navigation ? navigation.isFocused() : true));
  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const unsubFocus = navigation.addListener('focus', () => setFocused(true));
    const unsubBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [navigation]);
  return focused;
}

// Native MapLibre map — the single shared map component used by every
// surface in the app (Explore hub, Geo-caches, Places, MapScreen,
// LocationPickerSheet, and the four detail screens). Replaced the
// WebView Leaflet stack in #552 / #563 to dodge GrapheneOS Vanadium
// sandbox freezing (visible in #560 logs as `ActivityManager: freezing
// app.vanadium.webview`), kill the ~30 s WebView mount on Pixel cold
// starts, and unlock proper React-tree integration.
//
// Pins are RN-rendered `<Marker>` children with a 22 px circle chassis
// + Lucide glyph per category (merchants via btcMapIconComponent so
// the on-map icon matches the Places-rail card icon). Density follow-up
// is to port these to a MapLibre SymbolLayer with image sprites before
// shipping a dense-city market (Berlin / London / NYC have hundreds of
// BTC Map pins).

interface Props {
  lat: number | null;
  lon: number | null;
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
  defaultZoom?: number;
  // GPS horizontal accuracy in metres. When provided, draws a translucent
  // blue accuracy halo around the user dot — the Google-Maps idiom that
  // signals "your position is somewhere inside this circle". Suppressed
  // when null (e.g. dev-pinned location, where accuracy is meaningless).
  userAccuracyMetres?: number | null;
  // Optional explicit user-position override. Used by detail screens
  // (cache / place / event) where the map is centred on the *thing*
  // (lat/lon) but should still draw the user's dot at their actual
  // GPS coordinates somewhere else on the map. When unset, the user
  // dot sits at lat/lon (mini-map default).
  userLat?: number | null;
  userLon?: number | null;
  // The signed-in user's own avatar. When set (and a supported URL), the
  // blue "me" dot is replaced by this profile image clipped to the same
  // circle — the GPS-accuracy halo still renders behind it. Falls back to
  // the plain blue dot when unset / unsupported.
  userAvatarUri?: string | null;
  // "Open map" tap target. Surfaces the affordance the user uses to jump
  // to the full-screen MapScreen which is fully interactive (pan + zoom
  // + filters). If undefined, the button is hidden.
  onTapMap?: () => void;
  // Open legend bottom sheet. Same shape as ExploreMiniMap.
  onOpenLegend?: () => void;
  // When true, full pan / rotate / pitch are enabled and the camera
  // STOPS auto-following GPS so the user's pan persists. Used by
  // MapScreen, PlacesScreen, and LocationPickerSheet. Default false
  // (inline mini-map behaviour — zoom-only, GPS-follow).
  interactive?: boolean;
  // When true, the map fills its parent (no fixed height / margins / corner
  // radius). The parent owns layout. Used by full-screen MapScreen and
  // LocationPickerSheet. Default false (200 px chassis with 16 px margins).
  fill?: boolean;
  // Fired on each region-did-change with the current map bounds. Lets
  // host screens filter their list to whatever's visible. Mirrors the
  // ExploreMiniMap prop of the same name.
  onBoundsChange?: (bbox: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  }) => void;
  // When true, render a centred crosshair overlay — used by the
  // LocationPickerSheet where the user picks the geocache coordinate
  // by panning the map until the crosshair sits where they want it.
  crosshair?: boolean;
  // Optional single marker rendered at an explicit coordinate, on top of
  // any `caches`. Used by the Hide/Edit-a-Piglet location step to show a
  // piggy/pin glyph at the spot the hider pinned (the map centres there
  // but otherwise has no marker). `isLpPiggy` picks the glyph + colour.
  pinMarker?: { lat: number; lon: number; isLpPiggy?: boolean } | null;
  // The OTHER party's avatar marker, rendered as a ~28 px circular
  // profile chip at their coordinate. Used by the DM location cards to
  // show the peer's photo where they shared / where they are. Falls
  // back to a UserRound glyph in the circle when `avatarUri` is
  // missing / unsupported. Null = no profile marker (e.g. my own share).
  profileMarker?: { lat: number; lon: number; avatarUri?: string | null } | null;
  // Multiple peer avatar markers — the Full Map "friends sharing their
  // live location with me" layer. Same circular-chip rendering as the
  // single `profileMarker`; `key` is the peer pubkey for a stable React
  // key + marker id.
  profileMarkers?: { key: string; lat: number; lon: number; avatarUri?: string | null }[];
  // Render every marker (merchant / cache / event pins, me-dot, friend
  // avatars) at this pixel diameter instead of their per-type defaults, so
  // the full Map can present one uniform icon size. Glyphs scale with it.
  uniformMarkerSize?: number;
  // Marker-tap callbacks. Optional — when unset the pin is decorative
  // (mini-map use case). MapScreen wires these to open MerchantDetail-
  // Sheet / CacheDetailSheet.
  onSelectMerchant?: (m: BtcMapPlace) => void;
  onSelectCache?: (c: ParsedCache) => void;
  onSelectEvent?: (e: ParsedEvent) => void;
  // Optional testID applied to the outer container. Lets host screens
  // keep their existing Maestro-flow IDs (e.g. ExploreHomeScreen still
  // hands "explore-minimap" through so test-explore-tab-rename.yaml
  // doesn't need re-pointing). The on-map controls retain their
  // own libre-minimap-* IDs separately.
  testID?: string;
}

// Map style — OpenFreeMap's "Bright" vector style. Donation-funded
// community mirror of OSM rendering, built specifically for app use,
// no API key, no per-call billing. We deliberately avoid
// `tile.openstreetmap.org` directly: the OpenStreetMap Foundation's
// Tile Usage Policy forbids "heavy use … distributing an app that uses
// these tiles without prior permission", which a Play Store install
// arguably qualifies as. OpenFreeMap is what btcmap.org itself uses —
// keeping Lightning Piggy aligned with the Bitcoin community's stack.
//
// `bright` over `liberty` because the user's hands-on feedback was that
// liberty rendered too sparsely (fewer place-name labels at typical
// city / town zoom levels). Bright shows more text + landmarks
// without the heavier styling of fully-3D variants.
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

/**
 * Geographic accuracy halo. The halo's RADIUS encodes precision
 * (driven by `userAccuracyMetres` in metres) and CHANGES as the
 * accuracy improves — walking outside shrinks the radius from
 * ~250 m indoors to ~5 m outdoors within a few seconds, which is
 * itself a visible "this is live" signal. An earlier iteration
 * added an opacity pulse on top via setInterval, but the per-tick
 * setState contended with PanResponder gesture handling on
 * MapScreen and caused user-visible bottom-sheet drag jank
 * (#597 review). Pulse removed; if we want one back, the proper
 * path is an Animated.Value with `useNativeDriver: true`, or
 * waiting until the PanResponder migrates to Reanimated.
 */
const AccuracyHalo: React.FC<{ feature: Feature<Polygon> }> = ({ feature }) => {
  return (
    <GeoJSONSource id="user-accuracy-source" data={feature}>
      <Layer
        id="user-accuracy-fill"
        type="fill"
        paint={{ 'fill-color': '#4285F4', 'fill-opacity': 0.18 }}
      />
      <Layer
        id="user-accuracy-outline"
        type="line"
        paint={{
          'line-color': '#4285F4',
          'line-opacity': 0.45,
          'line-width': 1,
        }}
      />
    </GeoJSONSource>
  );
};

const LibreMiniMapInner: React.FC<Props> = ({
  lat,
  lon,
  merchants,
  caches,
  events,
  defaultZoom = 13,
  userAccuracyMetres,
  userLat,
  userLon,
  onTapMap,
  onOpenLegend,
  interactive = false,
  fill = false,
  onBoundsChange,
  crosshair = false,
  pinMarker,
  profileMarker,
  profileMarkers,
  userAvatarUri,
  uniformMarkerSize,
  onSelectMerchant,
  onSelectCache,
  onSelectEvent,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createLibreMiniMapStyles(colors), [colors]);
  // When `uniformMarkerSize` is set (the full Map asks for it), every marker
  // chassis renders at this diameter so merchant / cache / event pins, the
  // me-dot and friend avatars all read at one size. Glyphs scale with it.
  const markerDim = uniformMarkerSize
    ? { width: uniformMarkerSize, height: uniformMarkerSize, borderRadius: uniformMarkerSize / 2 }
    : null;
  const pinGlyphSize = uniformMarkerSize ? Math.round(uniformMarkerSize * 0.5) : 12;
  const avatarGlyphSize = uniformMarkerSize ? Math.round(uniformMarkerSize * 0.55) : 16;
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const currentZoomRef = useRef(defaultZoom);

  // Pulse the accuracy halo so the user can pick out their own dot
  // against busy maps. 1.0 → 1.18 → 1.0 over 1.6 s, native-driven so the
  // JS thread *should* stay free — but `Animated.loop` of a sequence
  // still bounces through JS on each leg's completion callback to
  // schedule the next leg, waking the JS thread every ~800 ms.
  //
  // Per Perfetto profile (2026-05-17 audit), this was THE cause of the
  // multi-second tab-switch freeze (#31): the tab navigator's `lazy:
  // true` keeps every visited screen mounted, so the pulse on
  // ExploreHomeScreen's LibreMiniMap kept running while the user was
  // on Home / Messages / Friends — every ~800 ms the JS thread woke
  // to schedule the next animation leg. Tap-on-Explore from Home
  // queued behind those pulses, delaying the tab transition by
  // several seconds.
  //
  // Fix: gate the loop on `useIsFocused()`. Pulse only runs while the
  // host screen is the current focus. On blur, the loop stops and the
  // JS thread is freed for other tabs' work + future tap-handling.
  // The halo itself remains visible (we leave `pulse` at 1.0 / its
  // last value) — it's only the animation that pauses.
  const isFocused = useIsFocusedSafe();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isFocused) {
      // Reset to base so the next focus starts at the same point in
      // the cycle every time. Without this the halo would keep its
      // last interpolated value across focus changes — harmless but
      // visually inconsistent.
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isFocused, pulse]);

  // Build a many-sided polygon approximating a circle of
  // `userAccuracyMetres` radius around the user's lat/lon. Rendered as
  // a GeoJSONSource + Layer (fill) so MapLibre's projection handles
  // zoom-scaling automatically — the halo grows / shrinks with the
  // map exactly like a Google-Maps blue accuracy circle should.
  //
  // Pre-#593 we rendered a fixed-pixel halo via Marker, which stayed
  // visually identical at any zoom — wildly over-representing accuracy
  // at wide zoom and under-representing at close zoom (cf the comment
  // we just replaced + the screenshots on the original issue).
  //
  // 64-vertex polygon strikes the perceptual balance: smooth enough
  // that nobody notices it's not a true circle at any sensible zoom,
  // cheap enough that re-computing on lat/lon/accuracy change is free.
  // Flat-earth lat/lon offsets — exact within sub-metre tolerance up
  // to several km, which is the worst-case civilian-GPS accuracy.
  // Halo follows the same three-mode rule as the user dot below:
  // explicit numbers win, explicit null suppresses (don't paint a halo
  // around the cache while the cached fix is still loading), undefined
  // falls back to camera centre (mini-map default).
  const haloLat = userLat !== undefined ? userLat : lat;
  const haloLon = userLon !== undefined ? userLon : lon;
  const haloFeature = useMemo<Feature<Polygon> | null>(() => {
    if (
      typeof userAccuracyMetres !== 'number' ||
      !Number.isFinite(userAccuracyMetres) ||
      userAccuracyMetres <= 0 ||
      haloLat === null ||
      haloLon === null
    ) {
      return null;
    }
    const VERTICES = 64;
    const METRES_PER_DEG_LAT = 111_320;
    const metresPerDegLng = 111_320 * Math.cos((haloLat * Math.PI) / 180);
    // Near the poles cos(lat) collapses toward zero, so dividing the
    // east-west offset by metresPerDegLng would explode (or divide by
    // zero) and produce wildly invalid coordinates. The flat-earth
    // approximation also stops being meaningful past ~85°. Suppress
    // the halo in that band rather than render a deformed polygon.
    if (!Number.isFinite(metresPerDegLng) || Math.abs(metresPerDegLng) < 1) {
      return null;
    }
    const ring: [number, number][] = [];
    for (let i = 0; i < VERTICES; i++) {
      const theta = (i / VERTICES) * 2 * Math.PI;
      const dLat = (userAccuracyMetres * Math.cos(theta)) / METRES_PER_DEG_LAT;
      const dLng = (userAccuracyMetres * Math.sin(theta)) / metresPerDegLng;
      ring.push([haloLon + dLng, haloLat + dLat]);
    }
    // Close the ring — GeoJSON polygons require first === last vertex.
    ring.push(ring[0]);
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  }, [haloLat, haloLon, userAccuracyMetres]);

  // O(1) coord → original-source lookups so onSelect* handlers don't do
  // a linear .find() per rendered marker. The build cost is one
  // map-construction pass per render where caches/events change; the
  // lookup cost across all visible markers drops from O(n²) to O(n).
  const cacheByCoord = useMemo(() => {
    const m = new Map<string, ParsedCache>();
    for (const c of caches) m.set(c.coord, c);
    return m;
  }, [caches]);
  const eventByCoord = useMemo(() => {
    const m = new Map<string, ParsedEvent>();
    for (const e of events) m.set(e.coord, e);
    return m;
  }, [events]);

  const cachePoints = useMemo(
    () =>
      caches
        .map((c) =>
          c.geohash
            ? { ...decodeGeohash(c.geohash), id: c.coord, name: c.name, isLpPiggy: c.isLpPiggy }
            : null,
        )
        .filter((c): c is NonNullable<typeof c> => c !== null),
    [caches],
  );

  const eventPoints = useMemo(
    () =>
      events
        .map((e) => (e.geohash ? { ...decodeGeohash(e.geohash), id: e.coord } : null))
        .filter((e): e is NonNullable<typeof e> => e !== null),
    [events],
  );

  const zoomBy = (delta: number) => () => {
    const next = Math.max(1, Math.min(20, currentZoomRef.current + delta));
    currentZoomRef.current = next;
    cameraRef.current?.zoomTo(next, { duration: 200 });
  };

  // Auto-follow GPS for inline mini-maps (non-interactive). When
  // interactive, leave the camera wherever the user panned it — the
  // recenter-on-me overlay button gives them an explicit affordance to
  // jump back to their location.
  //
  // 3-second pan when the position updates. The watch fires at most
  // every 30 s, so the user perceives a smooth glide from the old
  // centre to the new instead of a hard cut. The user-dot Marker has
  // fixed lat/lon coords; MapLibre re-projects it every animation
  // frame as the camera moves, so the dot smoothly slides into the
  // viewport centre over those 3 s without any per-frame setState.
  useEffect(() => {
    if (interactive) return;
    if (lat === null || lon === null) return;
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: currentZoomRef.current,
      duration: 3000,
    });
  }, [lat, lon, interactive]);

  const recenterOnMe = () => {
    // Target the user's live position (userLat/userLon) when it's
    // been supplied — the map anchor (lat/lon) is the static initial
    // camera centre on the interactive full-screen map and would
    // jump us back to where we OPENED the screen, not where we are
    // RIGHT NOW. Falls back to the anchor when no live override is
    // wired (mini-map case where centre and user are the same).
    const targetLat = userLat ?? lat;
    const targetLon = userLon ?? lon;
    if (targetLat === null || targetLon === null) return;
    cameraRef.current?.flyTo({
      center: [targetLon, targetLat],
      zoom: currentZoomRef.current,
      duration: 400,
    });
  };

  if (lat === null || lon === null) {
    // Empty-state placeholder while GPS is still resolving. Must honour
    // `fill` — otherwise full-screen consumers (MapScreen,
    // LocationPickerSheet) briefly render the mini-map chassis (16 px
    // margin, 14 px radius, small fixed height) before the layout flips
    // to fill once a fix arrives. #601 caught this as a visible
    // size-flash on the Map-screen open transition.
    return <View style={fill ? styles.containerFill : styles.container} testID={testID} />;
  }

  return (
    <View style={fill ? styles.containerFill : styles.container} testID={testID}>
      <MapLibreMap
        ref={mapRef}
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        // Pan / rotate / pitch follow the `interactive` prop. Mini-map
        // mode (default) disables pan so the parent ScrollView can own
        // the vertical drag gesture for pull-to-refresh; full-screen
        // mode enables everything for the proper map exploration UX.
        dragPan={interactive}
        touchRotate={interactive}
        touchPitch={interactive}
        // Emit bbox on every camera-settle so host screens can filter
        // their list to what's visible. Only wired when an onBoundsChange
        // prop is provided — keeps the inline mini-map free of the
        // event-marshalling cost.
        onRegionDidChange={
          onBoundsChange
            ? async () => {
                try {
                  const bounds = await mapRef.current?.getBounds();
                  if (!bounds) return;
                  // MapLibre LngLatBounds shape: [west, south, east, north]
                  // when accessed via the array indices. Convert to the
                  // lat/lon bbox the host screens expect.
                  const arr = bounds as unknown as [number, number, number, number];
                  onBoundsChange({
                    minLat: arr[1],
                    maxLat: arr[3],
                    minLon: arr[0],
                    maxLon: arr[2],
                  });
                } catch {
                  // Bounds query can race the camera tear-down on screen
                  // unmount — swallow.
                }
              }
            : undefined
        }
      >
        <Camera ref={cameraRef} initialViewState={{ center: [lon, lat], zoom: defaultZoom }} />
        {/* Accuracy halo — geographic polygon so the map's projection
            scales it with zoom (#593). Rendered BEFORE the user-dot
            Marker so the solid dot draws on top of the translucent
            fill. Suppressed when accuracy is null / non-positive
            (dev-pinned positions, no-GPS state) — silently misleading
            the user about their precision was the pre-fix behaviour. */}
        {haloFeature && <AccuracyHalo feature={haloFeature} />}
        {/* User position — solid dot. Three prop modes:
              - userLat/userLon both numbers → render there.
              - userLat/userLon both undefined (mini-map default: not
                passed) → render at camera centre [lon, lat]; centre
                IS the user in those flows.
              - userLat/userLon explicitly null → the caller (a detail
                screen) is telling us "we don't know yet". DON'T fall
                through to camera centre — that would plant the dot
                on the cache / merchant / event for one frame before
                the cached fix arrives, which is exactly the
                "location momentarily showed as the geo-cache then
                jumped" bug we hit.
            The pixel-sized Marker stays a position indicator — sizing
            it geographically would make it vanish at wide zoom and
            dominate at close zoom. */}
        {(() => {
          const userLatProvided = userLat !== undefined;
          const userLonProvided = userLon !== undefined;
          const dotLat = userLatProvided ? userLat : lat;
          const dotLon = userLonProvided ? userLon : lon;
          if (dotLat === null || dotLon === null) return null;
          return (
            <Marker id="user" lngLat={[dotLon, dotLat]}>
              <View style={styles.userMarkerWrap}>
                {/* Pixel-marker pulse is only useful as a "find
                    yourself" affordance when no geographic halo is
                    rendered (no accuracy / dev-pinned position). Once
                    the GeoJSON halo is in place it makes the dot
                    look like it has two halos — drop the pixel
                    pulse in that case. */}
                {!haloFeature && (
                  <Animated.View style={[styles.userDotPulse, { transform: [{ scale: pulse }] }]} />
                )}
                {userAvatarUri && isSupportedImageUrl(userAvatarUri) ? (
                  <View style={[styles.userAvatarDot, markerDim]}>
                    <ExpoImage
                      source={{ uri: userAvatarUri }}
                      style={styles.userAvatarImage}
                      cachePolicy="memory-disk"
                      recyclingKey={userAvatarUri}
                      autoplay={false}
                    />
                  </View>
                ) : (
                  <View style={[styles.userDot, markerDim]} />
                )}
              </View>
            </Marker>
          );
        })()}
        {/* Merchants: pin colour signals payment type (pink Lightning,
            orange on-chain only). Glyph mirrors the BTC Map category
            icon the user sees on the Places-for-you rail card for the
            same merchant — `restaurant` shows a fork, `cafe` a cup, etc.
            Falls back to a Store glyph when BTC Map ships a category we
            haven't mapped yet. */}
        {merchants.map((m) => {
          const ln = acceptsLightning(m);
          const Icon = btcMapIconComponent(m.icon);
          return (
            <Marker
              key={m.id}
              id={`merchant-${m.id}`}
              lngLat={[m.lon, m.lat]}
              onPress={onSelectMerchant ? () => onSelectMerchant(m) : undefined}
            >
              <View style={[styles.pin, ln ? styles.pinLn : styles.pinOnchain, markerDim]}>
                <Icon size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
              </View>
            </Marker>
          );
        })}
        {/* Caches: Piglet (Lightning Piggy) → PiggyBank pink, vanilla
            NIP-GC → MapPin purple. */}
        {cachePoints.map((c) => {
          const original = cacheByCoord.get(c.id);
          return (
            <Marker
              key={c.id}
              id={`cache-${c.id}`}
              lngLat={[c.lng, c.lat]}
              onPress={onSelectCache && original ? () => onSelectCache(original) : undefined}
            >
              <View
                style={[styles.pin, c.isLpPiggy ? styles.pinPiglet : styles.pinCache, markerDim]}
              >
                {c.isLpPiggy ? (
                  <PiggyBank size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
                ) : (
                  <MapPin size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
                )}
              </View>
            </Marker>
          );
        })}
        {/* Explicit pin marker (Hide/Edit-a-Piglet location step) — drawn
            at the hider's chosen coordinate so the centred map shows where
            the Piglet is, not just an empty map. */}
        {pinMarker ? (
          <Marker id="pin-marker" lngLat={[pinMarker.lon, pinMarker.lat]}>
            <View style={[styles.pin, pinMarker.isLpPiggy ? styles.pinPiglet : styles.pinCache]}>
              {pinMarker.isLpPiggy ? (
                <PiggyBank size={12} color="#fff" strokeWidth={2.5} />
              ) : (
                <MapPin size={12} color="#fff" strokeWidth={2.5} />
              )}
            </View>
          </Marker>
        ) : null}
        {/* Profile marker — the OTHER party's avatar on the DM location
            cards. 28 px circular chip; the photo z-stacks over a
            UserRound silhouette so a missing / broken / unsupported URL
            still reads as a person rather than an empty circle. */}
        {profileMarker ? (
          <Marker id="profile-marker" lngLat={[profileMarker.lon, profileMarker.lat]}>
            <View style={[styles.profileMarker, markerDim]}>
              <UserRound size={avatarGlyphSize} color={colors.textBody} strokeWidth={2} />
              {profileMarker.avatarUri && isSupportedImageUrl(profileMarker.avatarUri) ? (
                <ExpoImage
                  source={{ uri: profileMarker.avatarUri }}
                  style={styles.profileMarkerImage}
                  cachePolicy="memory-disk"
                  recyclingKey={profileMarker.avatarUri}
                  autoplay={false}
                />
              ) : null}
            </View>
          </Marker>
        ) : null}
        {/* Friends-sharing layer — one circular avatar chip per peer
            currently sharing their live location with me (Full Map). Same
            chassis as the single profileMarker; keyed by peer pubkey. */}
        {profileMarkers?.map((pm) => (
          <Marker key={pm.key} id={`friend-${pm.key}`} lngLat={[pm.lon, pm.lat]}>
            <View style={[styles.profileMarker, markerDim]}>
              <UserRound size={avatarGlyphSize} color={colors.textBody} strokeWidth={2} />
              {pm.avatarUri && isSupportedImageUrl(pm.avatarUri) ? (
                <ExpoImage
                  source={{ uri: pm.avatarUri }}
                  style={styles.profileMarkerImage}
                  cachePolicy="memory-disk"
                  recyclingKey={pm.avatarUri}
                  autoplay={false}
                />
              ) : null}
            </View>
          </Marker>
        ))}
        {/* Events: Calendar glyph in deep-purple. */}
        {eventPoints.map((e) => {
          const original = eventByCoord.get(e.id);
          return (
            <Marker
              key={e.id}
              id={`event-${e.id}`}
              lngLat={[e.lng, e.lat]}
              onPress={onSelectEvent && original ? () => onSelectEvent(original) : undefined}
            >
              <View style={[styles.pin, styles.pinEvent, markerDim]}>
                <Calendar size={pinGlyphSize} color="#fff" strokeWidth={2.5} />
              </View>
            </Marker>
          );
        })}
      </MapLibreMap>

      {/* Top-left: +/− zoom column. Matches ExploreMiniMap's layout
          and spacing so the swap is visually neutral. */}
      <View style={styles.zoomColumn}>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={zoomBy(1)}
          accessibilityLabel="Zoom in"
          testID="libre-minimap-zoom-in"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Plus size={16} color="#1a1a1a" strokeWidth={3} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.zoomButton}
          onPress={zoomBy(-1)}
          accessibilityLabel="Zoom out"
          testID="libre-minimap-zoom-out"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Minus size={16} color="#1a1a1a" strokeWidth={3} />
        </TouchableOpacity>
      </View>

      {/* Centred crosshair (location-picker mode) — sits on top of the
          map and ignores touches so panning still works underneath. */}
      {crosshair ? (
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <Crosshair size={36} color={colors.brandPink} strokeWidth={2.5} />
        </View>
      ) : null}

      {/* Bottom-left: legend button. In interactive mode the recenter
          button sits above it so the pair lines up with the WebView
          MapScreen's existing layout. Mini-map mode hides the recenter
          (no pan = nothing to recenter from). */}
      {interactive && lat !== null && lon !== null ? (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={recenterOnMe}
          accessibilityLabel="Recenter on my location"
          testID="libre-minimap-recenter"
        >
          <LocateFixed size={18} color="#2D88FF" strokeWidth={2.5} />
        </TouchableOpacity>
      ) : null}
      {onOpenLegend ? (
        <TouchableOpacity
          style={interactive ? styles.legendButtonAboveRecenter : styles.legendButton}
          onPress={onOpenLegend}
          accessibilityLabel="Show map legend"
          testID="libre-minimap-legend"
        >
          <Info size={18} color={colors.brandPink} strokeWidth={2.5} />
        </TouchableOpacity>
      ) : null}

      {/* Bottom-right: Open Map pill. */}
      {onTapMap ? (
        <TouchableOpacity
          style={styles.openBadge}
          onPress={onTapMap}
          accessibilityLabel="Open full map"
          testID="libre-minimap-open-button"
        >
          <Maximize2 size={12} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.openBadgeText}>Open map</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

// Item-identity equality for memoised array props. ExploreHomeScreen
// derives `cachesArr` via `useMemo(() => [...caches.values()], [caches])`
// — the array is a fresh reference every time the underlying `caches`
// Map changes, which is once per coalesced flush during a relay backfill
// (see #605 / PR #612). A bare `React.memo` shallow-comparator sees the
// fresh reference and re-renders MapLibre's entire marker layout on
// every flush — visible to the user as the map "flashing" each time
// they switch tabs back to Explore.
//
// Reference identity per element catches the real change cases (new
// cache pushed, existing one updated to a newer event — both produce a
// new object reference for that index) while skipping the re-render
// when the content is unchanged by reference. O(N) but N is small —
// typical Explore burst is <100 caches + <50 events, so the comparator
// runs in microseconds vs the tens-of-ms MapLibre marker re-layout it
// avoids.
// `<T,>` (with trailing comma) — in .tsx files a bare `<T>` parses as JSX.
const sameByItemRef = <T,>(a: readonly T[], b: readonly T[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

// Content signature for the friends-sharing marker array — lets arePropsEqual
// compare by value (the array reference churns every ping) without a deep walk.
const profileMarkersSig = (markers: Props['profileMarkers']): string =>
  markers == null ? '' : markers.map((m) => `${m.key}:${m.lat}:${m.lon}:${m.avatarUri}`).join('|');

const arePropsEqual = (prev: Props, next: Props): boolean => {
  // Cheap primitives first — bail on the most common change paths.
  if (prev.lat !== next.lat) return false;
  if (prev.lon !== next.lon) return false;
  if (prev.userAccuracyMetres !== next.userAccuracyMetres) return false;
  if (prev.userLat !== next.userLat) return false;
  if (prev.userLon !== next.userLon) return false;
  if (prev.userAvatarUri !== next.userAvatarUri) return false;
  if (prev.uniformMarkerSize !== next.uniformMarkerSize) return false;
  if (prev.defaultZoom !== next.defaultZoom) return false;
  if (prev.interactive !== next.interactive) return false;
  if (prev.fill !== next.fill) return false;
  if (prev.crosshair !== next.crosshair) return false;
  if (prev.testID !== next.testID) return false;
  // pinMarker is an object — compare its fields (and null↔object) so a
  // changed/toggled pin (e.g. isLpPiggy flips, or the coordinate moves)
  // actually re-renders the marker (#683 review).
  if (
    (prev.pinMarker == null) !== (next.pinMarker == null) ||
    prev.pinMarker?.lat !== next.pinMarker?.lat ||
    prev.pinMarker?.lon !== next.pinMarker?.lon ||
    prev.pinMarker?.isLpPiggy !== next.pinMarker?.isLpPiggy
  )
    return false;
  // profileMarker — same object-field treatment as pinMarker so a moved
  // peer position or a newly-resolved avatar URL re-renders the chip.
  if (
    (prev.profileMarker == null) !== (next.profileMarker == null) ||
    prev.profileMarker?.lat !== next.profileMarker?.lat ||
    prev.profileMarker?.lon !== next.profileMarker?.lon ||
    prev.profileMarker?.avatarUri !== next.profileMarker?.avatarUri
  )
    return false;
  // profileMarkers — the friends-sharing layer. The array reference changes
  // on every ping, so compare a cheap content signature (small list) rather
  // than identity, else a moved friend or resolved avatar wouldn't re-render.
  if (profileMarkersSig(prev.profileMarkers) !== profileMarkersSig(next.profileMarkers))
    return false;
  // Handlers — host screens should `useCallback` these but fall back
  // gracefully on reference identity if not.
  if (prev.onTapMap !== next.onTapMap) return false;
  if (prev.onOpenLegend !== next.onOpenLegend) return false;
  if (prev.onBoundsChange !== next.onBoundsChange) return false;
  if (prev.onSelectMerchant !== next.onSelectMerchant) return false;
  if (prev.onSelectCache !== next.onSelectCache) return false;
  if (prev.onSelectEvent !== next.onSelectEvent) return false;
  // Marker arrays — the whole point of the custom comparator.
  if (!sameByItemRef(prev.merchants, next.merchants)) return false;
  if (!sameByItemRef(prev.caches, next.caches)) return false;
  if (!sameByItemRef(prev.events, next.events)) return false;
  return true;
};

// Wrap in React.memo so a parent re-render that doesn't change our
// props (e.g. opening/closing the LegendSheet on ExploreHomeScreen, or
// a coalesced cache/event flush that produces a new array reference
// but the same items) doesn't force MapLibre to re-mount its marker
// children. In dev mode each unguarded render of ExploreHomeScreen
// logged 250–1000 ms — the memo cuts that cost out for the
// legend-toggle path, and the custom comparator extends that to the
// tab-switch path.
export const LibreMiniMap = React.memo(LibreMiniMapInner, arePropsEqual);

export default LibreMiniMap;
