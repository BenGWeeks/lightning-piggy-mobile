import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { Plus, Minus, LocateFixed, Info, Maximize2 } from 'lucide-react-native';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import { decodeGeohash } from '../utils/geohash';
import { useThemeColors } from '../contexts/ThemeContext';
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
  // Fired when the user starts/stops touching the map. Parent screens use
  // this to suspend their outer ScrollView's pull-to-refresh while the
  // user is panning the map (otherwise a vertical drag on the map starts
  // a refresh instead of panning). Mirrors ExploreMiniMap's prop of the
  // same name.
  onInteractionChange?: (touching: boolean) => void;
  // "Open map" tap target. Surfaces the same affordance ExploreMiniMap
  // does; if undefined, the button is hidden.
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

export const LibreMiniMap: React.FC<Props> = ({
  lat,
  lon,
  merchants,
  caches,
  events,
  defaultZoom = 13,
  onInteractionChange,
  onTapMap,
  onOpenLegend,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const cameraRef = useRef<CameraRef>(null);
  const currentZoomRef = useRef(defaultZoom);

  const cachePoints = useMemo(
    () =>
      caches
        .map((c) => (c.geohash ? { ...decodeGeohash(c.geohash), id: c.coord, name: c.name } : null))
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
    <View
      style={styles.container}
      onTouchStart={() => onInteractionChange?.(true)}
      onTouchEnd={() => onInteractionChange?.(false)}
      onTouchCancel={() => onInteractionChange?.(false)}
    >
      <Map style={styles.map} mapStyle={JSON.stringify(OSM_STYLE)}>
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [lon, lat], zoom: defaultZoom }}
        />
        {/* User position — placeholder; the pulsing-halo from mapMeDot.ts
            ports in a follow-up. */}
        <Marker id="user" lngLat={[lon, lat]}>
          <View style={styles.userDot} />
        </Marker>
        {merchants.map((m) => (
          <Marker key={m.id} id={`merchant-${m.id}`} lngLat={[m.lon, m.lat]}>
            <View style={styles.merchantDot} />
          </Marker>
        ))}
        {cachePoints.map((c) => (
          <Marker key={c.id} id={`cache-${c.id}`} lngLat={[c.lng, c.lat]}>
            <View style={styles.cacheDot} />
          </Marker>
        ))}
        {eventPoints.map((e) => (
          <Marker key={e.id} id={`event-${e.id}`} lngLat={[e.lng, e.lat]}>
            <View style={styles.eventDot} />
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

      {/* Bottom-left: recenter + info-legend stack. */}
      <TouchableOpacity
        style={styles.recenterButton}
        onPress={recenterOnMe}
        accessibilityLabel="Recenter on my location"
        testID="libre-minimap-recenter"
      >
        <LocateFixed size={18} color="#2D88FF" strokeWidth={2.5} />
      </TouchableOpacity>
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
    userDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.brandPink,
      borderWidth: 2,
      borderColor: colors.white,
    },
    merchantDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.brandPink,
      borderWidth: 1.5,
      borderColor: colors.white,
    },
    cacheDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: '#7A5CFF',
      borderWidth: 1.5,
      borderColor: colors.white,
    },
    eventDot: {
      width: 14,
      height: 14,
      borderRadius: 3,
      backgroundColor: '#5b3aff',
      borderWidth: 1.5,
      borderColor: colors.white,
    },
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
    recenterButton: {
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
    legendButton: {
      position: 'absolute',
      bottom: 52,
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

export default LibreMiniMap;
