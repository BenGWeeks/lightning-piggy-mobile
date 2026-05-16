import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, StyleSheet, TouchableOpacity, Text } from 'react-native';
// Alias MapLibre's `Map` component so we can still use the built-in
// `Map<K,V>` global for the coord → source lookups below.
import {
  Camera,
  Map as MapLibreMap,
  Marker,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
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
} from 'lucide-react-native';
import { type BtcMapPlace, acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import { decodeGeohash } from '../utils/geohash';
import { useThemeColors } from '../contexts/ThemeContext';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import type { Palette } from '../styles/palettes';

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

// Map style — OpenFreeMap's "Liberty" vector style. Donation-funded
// community mirror of OSM rendering, built specifically for app use,
// no API key, no per-call billing. We deliberately avoid
// `tile.openstreetmap.org` directly: the OpenStreetMap Foundation's
// Tile Usage Policy forbids "heavy use … distributing an app that uses
// these tiles without prior permission", which a Play Store install
// arguably qualifies as. OpenFreeMap is what btcmap.org itself uses —
// keeping Lightning Piggy aligned with the Bitcoin community's stack.
//
// Vector tiles (not raster) — sharper at every zoom, smaller wire
// payload, and renders properly into device-pixel ratios. The full
// MapLibre style JSON lives at the URL; the bundle just references it.
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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
  onSelectMerchant,
  onSelectCache,
  onSelectEvent,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const currentZoomRef = useRef(defaultZoom);

  // Pulse the accuracy halo so the user can pick out their own dot
  // against busy maps. 1.0 → 1.18 → 1.0 over 1.6 s, native-driven so the
  // JS thread stays free. Mirrors the Google Maps cadence.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Halo size: a fixed-pixel sizing scaled gently by accuracy so a 1000 m
  // fix looks larger than a 5 m fix, but never balloons larger than the
  // mini-map can show. The numbers are deliberately not geographic — a
  // proper geographic radius would need a CircleLayer with a GeoJSON
  // source, deferred to a follow-up. For the mini-map at zoom 13 a
  // 60-100 px halo reads as "your location is somewhere around here".
  const haloDiameter = useMemo(() => {
    const acc = userAccuracyMetres;
    if (acc === null || acc === undefined || !Number.isFinite(acc)) return 60;
    return Math.max(50, Math.min(120, 40 + Math.log10(acc) * 22));
  }, [userAccuracyMetres]);

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
  useEffect(() => {
    if (interactive) return;
    if (lat === null || lon === null) return;
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: currentZoomRef.current,
      duration: 250,
    });
  }, [lat, lon, interactive]);

  const recenterOnMe = () => {
    if (lat === null || lon === null) return;
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: currentZoomRef.current,
      duration: 400,
    });
  };

  if (lat === null || lon === null) return <View style={styles.container} />;

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
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [lon, lat], zoom: defaultZoom }}
        />
        {/* User position — translucent pulsing accuracy halo behind a
            solid dot. The halo sizes by GPS accuracy when known and is
            suppressed for dev-pinned positions (where accuracy is null).
            userLat/userLon (detail-screen override) takes precedence
            over lat/lon (mini-map default where camera centre + user
            dot are the same point). */}
        <Marker id="user" lngLat={[userLon ?? lon, userLat ?? lat]}>
          <View style={styles.userMarkerWrap}>
            {/* Halo only when accuracy is a finite positive number —
                NaN / Infinity / ≤ 0 would render at the fallback diameter
                and silently mislead the user about their precision. */}
            {typeof userAccuracyMetres === 'number' &&
            Number.isFinite(userAccuracyMetres) &&
            userAccuracyMetres > 0 ? (
              <Animated.View
                style={[
                  styles.userHalo,
                  {
                    width: haloDiameter,
                    height: haloDiameter,
                    borderRadius: haloDiameter / 2,
                    transform: [{ scale: pulse }],
                  },
                ]}
              />
            ) : null}
            <View style={styles.userDot} />
          </View>
        </Marker>
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
              <View style={[styles.pin, ln ? styles.pinLn : styles.pinOnchain]}>
                <Icon size={12} color="#fff" strokeWidth={2.5} />
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
              <View style={[styles.pin, c.isLpPiggy ? styles.pinPiglet : styles.pinCache]}>
                {c.isLpPiggy ? (
                  <PiggyBank size={12} color="#fff" strokeWidth={2.5} />
                ) : (
                  <MapPin size={12} color="#fff" strokeWidth={2.5} />
                )}
              </View>
            </Marker>
          );
        })}
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
              <View style={[styles.pin, styles.pinEvent]}>
                <Calendar size={12} color="#fff" strokeWidth={2.5} />
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

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    // Matches ExploreMiniMap's container styling exactly so the swap is
    // visually neutral. Fixed height + horizontal margins + corner
    // radius + overflow:hidden to clip the map to the rounded corners.
    container: {
      height: 200,
      marginHorizontal: 16,
      marginBottom: 18,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      position: 'relative',
    },
    // Fill variant for MapScreen / LocationPickerSheet — no fixed height,
    // no margins, no corner radius. The parent owns layout.
    containerFill: {
      flex: 1,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      position: 'relative',
    },
    map: { flex: 1 },
    // Wrapper that centres the dot inside the pulsing halo. Without it
    // Marker would anchor the top-left of the halo at the lng/lat, off
    // by half the halo diameter.
    userMarkerWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Blue dot at the same 22 px diameter as the merchant / cache /
    // event pin chassis so the GPS marker reads as a peer rather than a
    // smaller secondary element. The accuracy halo sits behind it.
    // No zIndex so merchant / cache / event pins layered on top of the
    // user dot remain tappable. The user-dot Marker is decorative — it
    // has no onPress — so being underneath a clickable pin is the right
    // visual + tap behaviour. (Previously zIndex:2 made the dot capture
    // taps on co-located pins like Bee Happy Farm.)
    userDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#2D88FF',
      borderWidth: 2,
      borderColor: colors.white,
    },
    // Google-Maps-style translucent blue accuracy halo. The transform
    // scale animation lives on the Animated.View at render time.
    userHalo: {
      position: 'absolute',
      backgroundColor: 'rgba(45, 136, 255, 0.18)',
      borderWidth: 1,
      borderColor: 'rgba(45, 136, 255, 0.45)',
      zIndex: 1,
    },
    // Shared pin chassis — circular white-bordered chip carrying the
    // category Lucide glyph. 22 px matches the Leaflet `lp-pin` size in
    // the WebView spec so the swap is visually consistent across the
    // two renderers.
    pin: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.white,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    pinLn: { backgroundColor: colors.brandPink },
    pinOnchain: { backgroundColor: '#F7931A' },
    pinPiglet: { backgroundColor: colors.brandPink },
    pinCache: { backgroundColor: colors.cachePurple },
    pinEvent: { backgroundColor: colors.eventViolet },
    zoomColumn: {
      position: 'absolute',
      top: 10,
      left: 10,
      gap: 6,
    },
    zoomButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: 'rgba(255,255,255,0.95)',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    openBadge: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(236, 0, 140, 0.92)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 100,
    },
    openBadgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
    crosshairWrap: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      marginTop: -18,
      marginLeft: -18,
    },
    // 34 px clears the MapLibre attribution logo + © OSM text strip
    // that the native SDK pins to the bottom-left edge. Without this
    // bump the recenter / legend buttons overlap the attribution and
    // it reads as a layout bug.
    recenterButton: {
      position: 'absolute',
      bottom: 34,
      left: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    // Legend sits above recenter when both exist (interactive mode);
    // otherwise sits at the bottom-left on its own.
    legendButtonAboveRecenter: {
      position: 'absolute',
      bottom: 76,
      left: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
    legendButton: {
      position: 'absolute',
      bottom: 34,
      left: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 3,
    },
  });

// Wrap in React.memo so a parent re-render that doesn't change our
// props (e.g. opening/closing the LegendSheet on ExploreHomeScreen)
// doesn't force MapLibre to re-mount its marker children. In dev mode
// each unguarded render of ExploreHomeScreen logged 250–1000 ms — the
// memo cuts that cost out for the legend-toggle path entirely.
export const LibreMiniMap = React.memo(LibreMiniMapInner);

export default LibreMiniMap;
