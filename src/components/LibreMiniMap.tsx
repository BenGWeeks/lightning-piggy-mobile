import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
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
// Initial scope (this PR): renders the same four pin classes ExploreMiniMap
// shows — user position, BTC Map merchants, NIP-GC caches, NIP-52 event
// venues — over an OSM raster tile source. Style URL is a tiny inline JSON
// so we don't need an external style-server. Interaction (pan/zoom) comes
// for free from the native MapLibre control.
//
// Out of scope (follow-ups noted in GH #552):
//   - Pin glyph rendering. Currently a coloured Marker; the per-category
//     SVG glyphs from src/utils/mapPinSvgs/ get ported to MapLibre symbol
//     layers in PR-N+1.
//   - Recentre-on-me + Legend buttons (re-use the existing RN overlays).
//   - LocationPickerSheet replacement (a separate sub-task).
//   - MapScreen (full-screen) replacement.

interface Props {
  lat: number | null;
  lon: number | null;
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
  defaultZoom?: number;
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
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

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

  if (lat === null || lon === null) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={JSON.stringify(OSM_STYLE)}>
        <Camera initialViewState={{ center: [lon, lat], zoom: defaultZoom }} />
        {/* User position — placeholder Marker; the pulsing-halo treatment
            from mapMeDot.ts ports in a follow-up. */}
        <Marker id="user" lngLat={[lon, lat]}>
          <View style={styles.userDot} />
        </Marker>

        {/* Merchant pins — flat Marker for now. The per-category icon set
            from mapPinSvgs/ ports to a MapLibre SymbolLayer next. */}
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
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    // Fixed height for parity with ExploreMiniMap's WebView-backed
    // counterpart (200 px). flex: 1 here collapsed the map to 0 px when
    // hosted inside a ScrollView column where the parent's available
    // vertical space is unbounded — the symptom Ben saw was the entire
    // Explore body painting solid black behind the header, because the
    // map View consumed the column with no intrinsic content height
    // wired through.
    container: { height: 200, backgroundColor: colors.surface, marginHorizontal: 16 },
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
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.brandPink,
    },
    cacheDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#7c3aed',
    },
    eventDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#f97316',
    },
  });

export default LibreMiniMap;
