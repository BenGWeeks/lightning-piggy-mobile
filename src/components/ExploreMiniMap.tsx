import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Maximize2, Minus, Plus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { BtcMapPlace } from '../services/btcMapService';
import { acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';

export interface MiniMapBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface Props {
  lat: number | null;
  lon: number | null;
  merchants: BtcMapPlace[];
  caches: ParsedCache[];
  events: ParsedEvent[];
  loading?: boolean;
  onTapMap: () => void;
  /**
   * Called when the user's +/− interaction changes the visible bbox.
   * List screens use this to filter their rows to whatever's currently
   * on the mini-map, so "zoom out → see more" emerges naturally.
   */
  onBoundsChange?: (bbox: MiniMapBbox) => void;
}

/**
 * Compact non-interactive map preview rendered at the top of
 * ExploreHomeScreen. Uses the same Leaflet+OSM stack as MapScreen so
 * the visual and tile-server choices stay consistent (see project
 * memory `BTC Map runs the commons (Nathan)`). Tapping the preview
 * opens the full MapScreen for interactive panning + claim/pay.
 *
 * Renders four pin classes:
 *   - 🟢 user position (live blue dot)
 *   - 🩷 BTC Map merchants accepting Lightning
 *   - 🟠 BTC Map merchants accepting only on-chain
 *   - 💎 NIP-GC caches — pink for `com.lightningpiggy.app` Piggies,
 *     slate for everyone else
 *   - 📅 NIP-52 calendar event venues
 */
export const ExploreMiniMap: React.FC<Props> = ({
  lat,
  lon,
  merchants,
  caches,
  events,
  loading,
  onTapMap,
  onBoundsChange,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  // Inject a Leaflet zoom delta into the WebView. The +/− controls are
  // RN-level siblings of the WebView (which has `pointerEvents="none"`),
  // so they don't compete with the tap-anywhere-to-open-full-map
  // affordance and stay independent of Leaflet's own ignored gestures.
  const zoomBy = useCallback(
    (delta: number) => () => {
      if (!ready || !webviewRef.current) return;
      const js = `window.LP_zoomBy && window.LP_zoomBy(${delta}); true;`;
      webviewRef.current.injectJavaScript(js);
    },
    [ready],
  );

  // Re-emit pins whenever data changes after the bridge is up.
  useEffect(() => {
    if (!ready || !webviewRef.current || lat === null || lon === null) return;
    const places = merchants.map((m) => ({
      lat: m.lat,
      lng: m.lon,
      lightning: acceptsLightning(m),
    }));
    const cacheLocs = caches
      .filter((c) => c.geohash)
      .map((c) => ({
        ...decodeGeohash(c.geohash as string),
        kind: c.isLpPiggy ? 'piggy' : 'cache',
      }));
    const eventLocs = events
      .filter((e) => e.geohash)
      .map((e) => decodeGeohash(e.geohash as string));
    const js = `window.LP_setHub && window.LP_setHub(${JSON.stringify({
      me: { lat, lng: lon },
      merchants: places,
      caches: cacheLocs,
      events: eventLocs,
    })}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, [ready, lat, lon, merchants, caches, events]);

  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={0.85}
      onPress={onTapMap}
      accessibilityLabel="Open full map"
      testID="explore-minimap"
    >
      {lat === null || lon === null ? (
        <View style={styles.fallback}>
          <ActivityIndicator color={colors.brandPink} />
          <Text style={styles.fallbackText}>Locating you…</Text>
        </View>
      ) : (
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: makeHtml(lat, lon) }}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);
              if (msg.type === 'ready') setReady(true);
              else if (msg.type === 'bounds' && msg.bbox && onBoundsChange) {
                onBoundsChange(msg.bbox);
              }
            } catch {}
          }}
          // disable user gestures so the parent ScrollView wins; the only
          // interaction is tap-the-whole-thing → MapScreen.
          scrollEnabled={false}
          pointerEvents="none"
          style={styles.webview}
        />
      )}
      {lat !== null && lon !== null ? (
        <View style={styles.zoomColumn}>
          <TouchableOpacity
            style={styles.zoomButton}
            onPress={zoomBy(1)}
            accessibilityLabel="Zoom in"
            testID="explore-minimap-zoom-in"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            {/* `colors.textHeader` is near-white in dark mode and the
             *  button surface is also near-white → invisible glyph.
             *  Lock to a dark hex so the icon pops on the white pill in
             *  either theme. */}
            <Plus size={16} color="#1a1a1a" strokeWidth={3} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.zoomButton}
            onPress={zoomBy(-1)}
            accessibilityLabel="Zoom out"
            testID="explore-minimap-zoom-out"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Minus size={16} color="#1a1a1a" strokeWidth={3} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.openBadge}>
        <Maximize2 size={12} color={colors.white} strokeWidth={2.5} />
        <Text style={styles.openBadgeText}>Open map</Text>
      </View>
      {loading ? (
        <View style={styles.loadingPill}>
          <ActivityIndicator color={colors.brandPink} size="small" />
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

// ---- Leaflet HTML (no controls, mirrors the MapScreen pin language) -------

const makeHtml = (lat: number, lon: number): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#eee}
    .lp-pin{width:14px;height:14px;border-radius:7px;background:#EC008C;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-pin.onchain{background:#F5A623}
    .lp-cache{width:14px;height:14px;background:#6c7b8a;border:1.5px solid #fff;transform:rotate(45deg);box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-cache.piggy{background:#EC008C}
    .lp-event{width:14px;height:14px;border-radius:3px;background:#5b3aff;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-me{width:12px;height:12px;border-radius:6px;background:#2D88FF;border:2px solid #fff;box-shadow:0 0 0 5px rgba(45,136,255,0.25)}
    /* Hide Leaflet's default UI for the preview */
    .leaflet-control-zoom,.leaflet-control-attribution{display:none!important}
  </style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const post=(m)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));
// minZoom 8 caps the bbox at about 200 km wide at UK latitudes — any
// wider and the list becomes "everything within a country" rather
// than "nearby", which is the wrong product for an Explore-hub mini-map.
// maxZoom 18 matches OSM tile availability.
const map=L.map('map',{zoomControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false,minZoom:8,maxZoom:18}).setView([${lat},${lon}],11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
let merchantLayer=L.layerGroup().addTo(map),cacheLayer=L.layerGroup().addTo(map),eventLayer=L.layerGroup().addTo(map),meMarker=null;
const dot=(cls,size)=>L.divIcon({className:'',html:'<div class="'+cls+'"></div>',iconSize:[size,size]});
const emitBounds=()=>{const b=map.getBounds();post({type:'bounds',bbox:{minLat:b.getSouth(),maxLat:b.getNorth(),minLon:b.getWest(),maxLon:b.getEast()}});};
map.on('moveend',emitBounds);
map.on('zoomend',emitBounds);
window.LP_zoomBy=function(delta){
  map.setZoom(map.getZoom()+delta);
};
// Tracks whether the user has interacted with zoom; once true we
// never re-centre on LP_setHub. Without this, a late-arriving relay
// event (caches stream in for several seconds) would call setView
// and snap the viewport back, undoing the user's zoom out.
let userHasInteracted=false;
map.on('zoomstart',function(e){if(e.zoom!==undefined)userHasInteracted=true;});
window.LP_setHub=function(d){
  merchantLayer.clearLayers();cacheLayer.clearLayers();eventLayer.clearLayers();
  if(meMarker)map.removeLayer(meMarker);
  meMarker=L.marker([d.me.lat,d.me.lng],{icon:dot('lp-me',12)}).addTo(map);
  d.merchants.forEach(m=>L.marker([m.lat,m.lng],{icon:dot('lp-pin'+(m.lightning?'':' onchain'),14)}).addTo(merchantLayer));
  d.caches.forEach(c=>L.marker([c.lat,c.lng],{icon:dot('lp-cache'+(c.kind==='piggy'?' piggy':''),14)}).addTo(cacheLayer));
  d.events.forEach(e=>L.marker([e.lat,e.lng],{icon:dot('lp-event',14)}).addTo(eventLayer));
  // Only re-centre on the very first LP_setHub. After that the user's
  // viewport is sacred — late-arriving caches / events would otherwise
  // snap the map back and undo any zoom out.
  if(!userHasInteracted && !window.__lpDidCentre){
    map.setView([d.me.lat,d.me.lng],13);
    window.__lpDidCentre=true;
  }
  emitBounds();
};
// Tag the LP_zoomBy entry-point too so RN-button taps mark interaction
// before zoomstart fires (covers a race where zoomstart's event.zoom
// is undefined on programmatic setZoom calls).
const __origZoomBy=window.LP_zoomBy;
window.LP_zoomBy=function(delta){userHasInteracted=true;__origZoomBy(delta);};
post({type:'ready'});
// Also emit straight away — covers the case where LP_setHub hasn't
// been called yet (parent has no data) but the map already shows the
// injected viewport from LP_initialViewport or the HTML default.
emitBounds();
</script>
</body></html>`;

// Inline geohash decoder — same algorithm as MapScreen (kept duplicated
// rather than extracted because both files want zero-overhead inline use).
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const decodeGeohash = (gh: string): { lat: number; lng: number } => {
  let latLo = -90,
    latHi = 90,
    lonLo = -180,
    lonHi = 180,
    even = true;
  for (let i = 0; i < gh.length; i += 1) {
    const idx = GEOHASH_BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (idx >> bit) & 1;
      if (even) {
        const m = (lonLo + lonHi) / 2;
        if (set) lonLo = m;
        else lonHi = m;
      } else {
        const m = (latLo + latHi) / 2;
        if (set) latLo = m;
        else latHi = m;
      }
      even = !even;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lonLo + lonHi) / 2 };
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      height: 200,
      marginHorizontal: 16,
      marginBottom: 18,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      position: 'relative',
    },
    webview: { flex: 1, backgroundColor: 'transparent' },
    fallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    fallbackText: { color: colors.textSupplementary, fontSize: 13 },
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
    loadingPill: {
      position: 'absolute',
      top: 10,
      right: 10,
      backgroundColor: 'rgba(255,255,255,0.85)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 100,
    },
  });
