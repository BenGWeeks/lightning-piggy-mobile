import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Info, LocateFixed, Maximize2, Minus, Plus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { BtcMapPlace } from '../services/btcMapService';
import { acceptsLightning } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import LegendSheet from './LegendSheet';

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
  /**
   * Default zoom level when the map first centres on the user. 13 is
   * the neighbourhood-level default that works for the Explore hub
   * (mixed merchants + caches). Use a lower number (~10) for the
   * Places list — most users want a wider Bitcoin-merchant net.
   */
  defaultZoom?: number;
  /**
   * When set, the map drops its own fixed height + margins and fills its
   * parent instead. Used by the cache detail hero, where the parent owns
   * a fixed photo-sized slot the map must match exactly.
   */
  fill?: boolean;
  /**
   * When set, caches render as a centred teardrop map-pin (pink + piggy
   * glyph for a Piglet, slate + map-pin glyph otherwise) instead of the
   * small dot used on the hub map. Used by the cache-detail hero. The
   * "me" dot is suppressed in this mode UNLESS `userLat`/`userLon` are
   * passed explicitly (then it represents the user's separate location
   * relative to the cache).
   */
  cachePin?: boolean;
  /**
   * Explicit user position. When set, drives the "me" dot independently
   * of `lat`/`lon` (which on cachePin views are the cache centre, not
   * the user). Used by the compass-navigation feature on cache-detail
   * so the user can see their position relative to the target.
   */
  userLat?: number | null;
  userLon?: number | null;
  /**
   * When set, the embedded map gains real Leaflet interactions —
   * drag-to-pan, pinch-to-zoom — and a recenter-on-me button. The
   * outer "tap anywhere to open the full map" affordance becomes an
   * explicit "Open map" button so panning gestures don't accidentally
   * navigate away. The Open map button always shows; recenter only
   * shows once we have a user fix.
   */
  interactive?: boolean;
  /**
   * BTC Map category keys present in the current view — surfaced in
   * the legend sheet (opened from the Legend button at bottom-left)
   * so the user can correlate the glyph on a Places pin with its
   * category name. Optional; on caches-only views (e.g. HuntScreen)
   * the parent omits and the sheet just shows pin-colour idioms.
   */
  legendCategories?: string[];
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
  defaultZoom = 13,
  fill = false,
  cachePin = false,
  userLat = null,
  userLon = null,
  interactive = false,
  legendCategories,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [legendVisible, setLegendVisible] = useState(false);

  // Inject a Leaflet zoom delta into the WebView. The +/− controls are
  // RN-level siblings of the WebView so they stay independent of
  // Leaflet's own gestures (which are disabled on non-interactive
  // views and enabled on interactive ones).
  const zoomBy = useCallback(
    (delta: number) => () => {
      if (!ready || !webviewRef.current) return;
      const js = `window.LP_zoomBy && window.LP_zoomBy(${delta}); true;`;
      webviewRef.current.injectJavaScript(js);
    },
    [ready],
  );

  // Recentre on the user — used by the LocateFixed button when the map
  // is interactive. The HTML defines LP_recenter as setView to whatever
  // `me` it last received, defaulting to the centre constructor arg.
  const recenterOnMe = useCallback(() => {
    if (!ready || !webviewRef.current) return;
    const js = `window.LP_recenter && window.LP_recenter(); true;`;
    webviewRef.current.injectJavaScript(js);
  }, [ready]);

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
    // On cachePin views, `me` carries the user's *separate* location
    // (when known) so the blue dot can be drawn next to the cache pin.
    // On hub views, lat/lon ARE the user — `me` and the centre coincide.
    const meLat = cachePin && userLat !== null ? userLat : lat;
    const meLon = cachePin && userLon !== null ? userLon : lon;
    const hasMe = cachePin ? userLat !== null && userLon !== null : true;
    const js = `window.LP_setHub && window.LP_setHub(${JSON.stringify({
      me: hasMe ? { lat: meLat, lng: meLon } : null,
      merchants: places,
      caches: cacheLocs,
      events: eventLocs,
      cachePin,
    })}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, [ready, lat, lon, merchants, caches, events, cachePin, userLat, userLon]);

  // When interactive, drag/zoom gestures need to reach the WebView, so
  // the outer wrapper must NOT be a TouchableOpacity (it'd capture
  // every touch as a tap). Non-interactive views keep the whole-map-
  // is-a-tap-target behaviour so the cache-detail hero etc. still
  // open the full map with one tap. Inlined as two return branches
  // (not a dynamic Wrapper component) — defining a component inside
  // render gives it a fresh identity every render, which forces React
  // to remount the WebView tree and the bridge collapses to a black
  // screen.
  const containerStyle = fill ? styles.containerFill : styles.container;
  const children = (
    <>
      {lat === null || lon === null ? (
        <View style={styles.fallback}>
          <ActivityIndicator color={colors.brandPink} />
          <Text style={styles.fallbackText}>Locating you…</Text>
        </View>
      ) : (
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: makeHtml(lat, lon, defaultZoom, interactive) }}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);
              if (msg.type === 'ready') setReady(true);
              else if (msg.type === 'bounds' && msg.bbox && onBoundsChange) {
                onBoundsChange(msg.bbox);
              }
            } catch {}
          }}
          // Gesture pass-through follows interactivity: non-interactive
          // views block touches so the parent ScrollView wins; interactive
          // views let touches through to Leaflet for pan + pinch-zoom.
          scrollEnabled={interactive}
          pointerEvents={interactive ? 'auto' : 'none'}
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
      {/* Recenter on me — only on interactive maps and only once we
          have a user fix. Blue to match the legend dot. */}
      {interactive && lat !== null && lon !== null ? (
        <>
          <TouchableOpacity
            style={styles.recenterButton}
            onPress={recenterOnMe}
            accessibilityLabel="Recenter on my location"
            testID="explore-minimap-recenter"
          >
            <LocateFixed size={18} color="#2D88FF" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.legendButton}
            onPress={() => setLegendVisible(true)}
            accessibilityLabel="Show map legend"
            testID="explore-minimap-legend"
          >
            <Info size={18} color={colors.brandPink} strokeWidth={2.5} />
          </TouchableOpacity>
        </>
      ) : null}
      {/* "Open map" — interactive maps need an explicit button since
          the whole map no longer is a tap target. Non-interactive maps
          keep the badge as a visual hint that the whole thing is
          tappable. Same look either way, only the role differs. */}
      {interactive ? (
        <TouchableOpacity
          style={styles.openBadge}
          onPress={onTapMap}
          accessibilityLabel="Open full map"
          testID="explore-minimap-open-button"
        >
          <Maximize2 size={12} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.openBadgeText}>Open map</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.openBadge}>
          <Maximize2 size={12} color={colors.white} strokeWidth={2.5} />
          <Text style={styles.openBadgeText}>Open map</Text>
        </View>
      )}
      {loading ? (
        <View style={styles.loadingPill}>
          <ActivityIndicator color={colors.brandPink} size="small" />
        </View>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <View style={containerStyle} testID="explore-minimap">
        {children}
        {/* LegendSheet only on interactive maps — non-interactive
            previews don't show the Legend button so there'd be no
            way to open it. */}
        <LegendSheet
          visible={legendVisible}
          onClose={() => setLegendVisible(false)}
          placesVisible={merchants.length > 0}
          availableCategories={legendCategories ?? []}
        />
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={containerStyle}
      activeOpacity={0.85}
      onPress={onTapMap}
      accessibilityLabel="Open full map"
      testID="explore-minimap"
    >
      {children}
    </TouchableOpacity>
  );
};

// ---- Leaflet HTML (no controls, mirrors the MapScreen pin language) -------

const makeHtml = (
  lat: number,
  lon: number,
  defaultZoom: number,
  interactive: boolean,
): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#eee}
    .lp-pin{width:14px;height:14px;border-radius:7px;background:#EC008C;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-pin.onchain{background:#F5A623}
    /* Round circles match the list-row iconWrap (pink for Piglet,
       slate for vanilla NIP-GC). Earlier diamond version made the
       map<>list mapping ambiguous at a glance. */
    .lp-cache{width:14px;height:14px;border-radius:7px;background:#6c7b8a;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-cache.piggy{background:#EC008C}
    .lp-event{width:14px;height:14px;border-radius:3px;background:#5b3aff;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    /* Pulsating "you" dot: solid blue core + an outward ripple via
       ::after that scales out and fades. Subtle enough not to nag,
       clear enough to spot at a glance. */
    .lp-me{position:relative;width:14px;height:14px;border-radius:7px;background:#2D88FF;border:2px solid #fff;box-shadow:0 0 0 3px rgba(45,136,255,0.25);z-index:1000}
    .lp-me::after{content:'';position:absolute;top:50%;left:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:rgba(45,136,255,0.45);animation:lp-pulse 1.8s ease-out infinite;z-index:-1}
    @keyframes lp-pulse{0%{transform:scale(0.4);opacity:1}100%{transform:scale(2.6);opacity:0}}
    /* Hide Leaflet's default UI for the preview */
    .leaflet-control-zoom,.leaflet-control-attribution{display:none!important}
  </style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const post=(m)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));
// minZoom 7 caps the bbox at about 400 km wide at UK latitudes — wider
// than that and the list becomes "everything within a country" rather
// than "nearby", which is the wrong product for an Explore-hub mini-map.
// Was 8 before; raised to 7 after user feedback that one more level
// out felt more natural on the Places list.
// maxZoom 18 matches OSM tile availability.
const __interactive=${interactive ? 'true' : 'false'};
const map=L.map('map',{zoomControl:false,dragging:__interactive,scrollWheelZoom:__interactive,doubleClickZoom:__interactive,touchZoom:__interactive,boxZoom:false,keyboard:false,minZoom:7,maxZoom:18,tap:__interactive}).setView([${lat},${lon}],${defaultZoom});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
let merchantLayer=L.layerGroup().addTo(map),cacheLayer=L.layerGroup().addTo(map),eventLayer=L.layerGroup().addTo(map),meMarker=null;
const dot=(cls,size)=>L.divIcon({className:'',html:'<div class="'+cls+'"></div>',iconSize:[size,size]});
// lucide PiggyBank / MapPin glyph paths — kept inline so the WebView
// needs no asset bundle. Used by the cache-detail hero's teardrop pin.
const PIGGY_SVG='<path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z"/><path d="M16 10h.01"/><path d="M2 8v1a2 2 0 0 0 2 2h1"/>';
const MAPPIN_SVG='<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>';
// The piggy glyph sits ~2px lower than the map-pin glyph in its viewBox,
// so it gets a slightly larger y-offset to stay optically centred.
const pinIcon=(piggy)=>L.divIcon({className:'',iconSize:[36,44],iconAnchor:[18,44],html:'<svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg"><path d="M18 2C9.7 2 3 8.7 3 17c0 10 15 25 15 25s15-15 15-25C33 8.7 26.3 2 18 2z" fill="'+(piggy?'#EC008C':'#6c7b8a')+'" stroke="#fff" stroke-width="2"/><g transform="translate(9 '+(piggy?9:7)+') scale(0.75)" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+(piggy?PIGGY_SVG:MAPPIN_SVG)+'</g></svg>'});
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
  if(meMarker){map.removeLayer(meMarker);meMarker=null;}
  // Render the blue dot whenever d.me is provided. The cache-detail
  // hero passes me=null unless an explicit user position was supplied
  // via the userLat/userLon props (see Props in ExploreMiniMap.tsx).
  if(d.me)meMarker=L.marker([d.me.lat,d.me.lng],{icon:dot('lp-me',12)}).addTo(map);
  d.merchants.forEach(m=>L.marker([m.lat,m.lng],{icon:dot('lp-pin'+(m.lightning?'':' onchain'),14)}).addTo(merchantLayer));
  d.caches.forEach(c=>L.marker([c.lat,c.lng],{icon:d.cachePin?pinIcon(c.kind==='piggy'):dot('lp-cache'+(c.kind==='piggy'?' piggy':''),14)}).addTo(cacheLayer));
  d.events.forEach(e=>L.marker([e.lat,e.lng],{icon:dot('lp-event',14)}).addTo(eventLayer));
  // Only re-centre on the very first LP_setHub. After that the user's
  // viewport is sacred — late-arriving caches / events would otherwise
  // snap the map back and undo any zoom out.
  //
  // Skipped on cachePin views: those want to stay locked on the cache
  // (the constructor's initial setView already did that), even when a
  // user dot arrives later — otherwise the dot's location would yank
  // the map away from the target, which is the wrong product.
  if(!d.cachePin && d.me && !userHasInteracted && !window.__lpDidCentre){
    map.setView([d.me.lat,d.me.lng],${defaultZoom});
    window.__lpDidCentre=true;
  }
  emitBounds();
};
// Tag the LP_zoomBy entry-point too so RN-button taps mark interaction
// before zoomstart fires (covers a race where zoomstart's event.zoom
// is undefined on programmatic setZoom calls).
const __origZoomBy=window.LP_zoomBy;
window.LP_zoomBy=function(delta){userHasInteracted=true;__origZoomBy(delta);};
// Recentre on the most recently posted d.me. Used by the LocateFixed
// button on interactive maps. If me was never sent we fall back to the
// HTML's constructor centre so the call is still safe.
let __lastMe=null;
const __setHubOrig=window.LP_setHub;
window.LP_setHub=function(d){__lastMe=d.me||__lastMe;__setHubOrig(d);};
window.LP_recenter=function(){
  userHasInteracted=true;
  const target=__lastMe || {lat:${lat},lng:${lon}};
  map.setView([target.lat,target.lng],Math.max(map.getZoom(),${defaultZoom}));
};
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
    // `fill` variant — no fixed height or margins; the parent owns the
    // size (e.g. the cache detail hero slot).
    containerFill: {
      flex: 1,
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
    // Recenter + Legend — clustered bottom-LEFT so they don't fight
    // the Open-map badge at bottom-right. White surface with the same
    // shadow so they read as a pair.
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
