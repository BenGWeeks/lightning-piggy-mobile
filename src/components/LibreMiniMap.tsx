import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { Plus, Minus, Info, Maximize2, PiggyBank, MapPin, Calendar } from 'lucide-react-native';
import { type BtcMapPlace, acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import { decodeGeohash } from '../utils/geohash';
import { useThemeColors } from '../contexts/ThemeContext';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import type { Palette } from '../styles/palettes';

// Native MapLibre replacement for ExploreMiniMap. GH #552 + project memory
// `reference_map_stack_future_maplibre` agreed migration target: GrapheneOS
// freezes the Vanadium WebView sandbox under memory pressure (visible in
// the #560 logs as `ActivityManager: freezing ... app.vanadium.webview`),
// leaving the Leaflet WebView blank until the user pull-to-refreshes. A
// native MapLibre view is OS-managed alongside the rest of the React Native
// tree so it doesn't get yanked.
//
// Visual parity with ExploreMiniMap: same 200 px height, 16 px horizontal
// margins, 14 px corner radius, same +/− zoom column top-left, recenter
// + legend buttons bottom-left, "Open map" pill bottom-right. The pin
// styling is still placeholder coloured dots — porting the SVG glyphs
// from src/utils/mapPinSvgs/ to MapLibre SymbolLayer is the next sub-task.

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
  // "Open map" tap target. Surfaces the affordance the user uses to jump
  // to the full-screen MapScreen which is fully interactive (pan + zoom
  // + filters). If undefined, the button is hidden.
  onTapMap?: () => void;
  // Open legend bottom sheet. Same shape as ExploreMiniMap.
  onOpenLegend?: () => void;
}

// OSM raster style — minimal inline JSON so we don't depend on an external
// style-server. Tile URL goes through the standard tile.openstreetmap.org
// CDN; the attribution string is required by the OSM ToS and surfaces as
// an automatic copyright control inside the MapLibre view.
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
} as const;

const LibreMiniMapInner: React.FC<Props> = ({
  lat,
  lon,
  merchants,
  caches,
  events,
  defaultZoom = 13,
  userAccuracyMetres,
  onTapMap,
  onOpenLegend,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cameraRef = useRef<CameraRef>(null);
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

  // Auto-follow GPS: whenever the user's position updates, recentre the
  // camera. Inline mini-maps are always centred on the user (no pan, no
  // recenter button — see top-of-file comment), so any drift just re-aligns
  // automatically rather than asking the user to recenter manually.
  useEffect(() => {
    if (lat === null || lon === null) return;
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: currentZoomRef.current,
      duration: 250,
    });
  }, [lat, lon]);

  if (lat === null || lon === null) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={JSON.stringify(OSM_STYLE)}
        // Mini-map is intentionally non-interactive for pan, rotate, and
        // pitch. The map stays centred on the user (auto-follow GPS via
        // the useEffect above) and zoom is driven by the +/− RN overlay
        // buttons. This removes every reason for the map to compete with
        // the outer ScrollView's pull-to-refresh gesture — pulling down
        // anywhere on the page now reliably triggers a refresh. Pinch-
        // zoom stays enabled because two-finger gestures don't conflict
        // with the single-finger pull-to-refresh, and it's the natural
        // way to zoom on a touch device. Full pan is reserved for
        // MapScreen via the Open Map pill.
        dragPan={false}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [lon, lat], zoom: defaultZoom }}
        />
        {/* User position — translucent pulsing accuracy halo behind a
            solid dot. The halo sizes by GPS accuracy when known and is
            suppressed for dev-pinned positions (where accuracy is null). */}
        <Marker id="user" lngLat={[lon, lat]}>
          <View style={styles.userMarkerWrap}>
            {userAccuracyMetres !== null && userAccuracyMetres !== undefined ? (
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
            <Marker key={m.id} id={`merchant-${m.id}`} lngLat={[m.lon, m.lat]}>
              <View style={[styles.pin, ln ? styles.pinLn : styles.pinOnchain]}>
                <Icon size={12} color="#fff" strokeWidth={2.5} />
              </View>
            </Marker>
          );
        })}
        {/* Caches: Piglet (Lightning Piggy) → PiggyBank pink, vanilla
            NIP-GC → MapPin purple. */}
        {cachePoints.map((c) => (
          <Marker key={c.id} id={`cache-${c.id}`} lngLat={[c.lng, c.lat]}>
            <View style={[styles.pin, c.isLpPiggy ? styles.pinPiglet : styles.pinCache]}>
              {c.isLpPiggy ? (
                <PiggyBank size={12} color="#fff" strokeWidth={2.5} />
              ) : (
                <MapPin size={12} color="#fff" strokeWidth={2.5} />
              )}
            </View>
          </Marker>
        ))}
        {/* Events: Calendar glyph in deep-purple. */}
        {eventPoints.map((e) => (
          <Marker key={e.id} id={`event-${e.id}`} lngLat={[e.lng, e.lat]}>
            <View style={[styles.pin, styles.pinEvent]}>
              <Calendar size={12} color="#fff" strokeWidth={2.5} />
            </View>
          </Marker>
        ))}
      </Map>

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

      {/* Bottom-left: legend button. The recenter button is gone — the
          map is always centred on the user (auto-follow useEffect above)
          so there's nothing to recenter to. */}
      {onOpenLegend ? (
        <TouchableOpacity
          style={styles.legendButton}
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
    userDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#2D88FF',
      borderWidth: 2,
      borderColor: colors.white,
      zIndex: 2,
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
    pinCache: { backgroundColor: '#7A5CFF' },
    pinEvent: { backgroundColor: '#5b3aff' },
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
    legendButton: {
      position: 'absolute',
      bottom: 10,
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
