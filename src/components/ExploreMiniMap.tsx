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
import { ME_DOT_CSS, ME_DOT_JS } from '../utils/mapMeDot';
import { MAP_PIN_SVG_PALETTE_JS } from '../utils/mapPinSvgs';
import { decodeGeohash } from '../utils/geohash';
import {
  LEAFLET_BASE_CSS,
  LEAFLET_HEAD_TAGS,
  LEAFLET_MAP_BACKGROUND_CSS,
  LEAFLET_SCRIPT_TAG,
  POST_BRIDGE_JS,
  tileLayerJs,
} from '../utils/mapWebview/tiles';

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
   * Reported horizontal accuracy in metres for the user fix. When set
   * (and userLat/userLon are too), the map draws a translucent blue
   * halo around the "me" dot sized to this radius — the standard
   * idiom on Apple Maps / Google Maps for "how well do we know where
   * you are". Omit on dev-pinned positions where the value is exact.
   */
  userAccuracyMetres?: number | null;
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
  /**
   * Fires `true` the moment the user starts touching the inline map and
   * `false` when the touch ends (or is cancelled). Callers wrap the map
   * in a scrollable parent (ScrollView with RefreshControl, FlatList)
   * use this to disable scrolling / pull-to-refresh for the duration —
   * otherwise a vertical pan that starts on the map gets stolen by the
   * parent and either refreshes the page or scrolls the list under the
   * user's finger. Notification-only: doesn't claim the gesture, so
   * Leaflet's own pan/pinch on the interactive map still works.
   */
  onInteractionChange?: (active: boolean) => void;
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
  userAccuracyMetres = null,
  interactive = false,
  legendCategories,
  onInteractionChange,
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

  // Snapshot of the pin payload at first WebView mount. Baked straight
  // into the HTML so pins render alongside Leaflet on the very first
  // paint — eliminates the React→WebView round-trip that the useEffect
  // path below incurs (LP_setHub fires only after `ready`, which itself
  // waits on the Leaflet CDN fetch). Without this, cached merchants
  // still take a few hundred ms to appear on the map even though they
  // were already in React state synchronously courtesy of PR #550's
  // peekCachedPlacesSync seed.
  //
  // Stored in a ref so it doesn't change across renders — the HTML is
  // frozen at first mount; live updates flow through the existing
  // `useEffect → injectJavaScript → LP_setHub` path below.
  const initialHubPayloadRef = useRef<string | null>(null);
  if (initialHubPayloadRef.current === null && lat !== null && lon !== null) {
    const places = merchants.map((m) => ({
      lat: m.lat,
      lng: m.lon,
      lightning: acceptsLightning(m),
      category: m.icon ?? null,
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
    const meLat = cachePin && userLat !== null ? userLat : lat;
    const meLon = cachePin && userLon !== null ? userLon : lon;
    const hasMe = cachePin ? userLat !== null && userLon !== null : true;
    initialHubPayloadRef.current = JSON.stringify({
      me: hasMe ? { lat: meLat, lng: meLon, accuracy: userAccuracyMetres ?? null } : null,
      merchants: places,
      caches: cacheLocs,
      events: eventLocs,
      cachePin,
    });
  }

  // Memoised HTML — only rebuilt when the map's structural inputs
  // change (centre / zoom / interactivity). Stable across merchant /
  // cache updates so we don't remount the WebView on every relay tick.
  const html = useMemo(() => {
    const __t0 = performance.now();
    const out = makeHtml(
      lat ?? 0,
      lon ?? 0,
      defaultZoom,
      interactive,
      initialHubPayloadRef.current ?? '',
    );
    const __dt = performance.now() - __t0;
    if (__dt > 50) {
      console.log(
        `[PerfBlock] ExploreMiniMap makeHtml: ${Math.round(__dt)}ms (${out.length} chars)`,
      );
    }
    return out;
  }, [lat, lon, defaultZoom, interactive]);

  // Notify the parent every time a finger lands on / leaves the map.
  // The parent uses these to disable its own scroll + pull-to-refresh
  // for the duration; without that, a vertical pan that starts on an
  // inline map either pulls the page or scrolls the list under the
  // user's finger instead of panning Leaflet. onTouch* props don't
  // claim the gesture, so the WebView still gets its native touches.
  const handleTouchStart = useCallback(() => onInteractionChange?.(true), [onInteractionChange]);
  const handleTouchEnd = useCallback(() => onInteractionChange?.(false), [onInteractionChange]);

  // Re-emit pins whenever data changes after the bridge is up.
  useEffect(() => {
    if (!ready || !webviewRef.current || lat === null || lon === null) return;
    const places = merchants.map((m) => ({
      lat: m.lat,
      lng: m.lon,
      lightning: acceptsLightning(m),
      // BTC Map's curated category glyph name (storefront / cafe /
      // restaurant / …). Pass through so the Leaflet renderer can
      // pick the matching inline lucide SVG. Unknown / null falls
      // back to a generic Store glyph.
      category: m.icon ?? null,
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
      me: hasMe ? { lat: meLat, lng: meLon, accuracy: userAccuracyMetres ?? null } : null,
      merchants: places,
      caches: cacheLocs,
      events: eventLocs,
      cachePin,
    })}); true;`;
    webviewRef.current.injectJavaScript(js);
  }, [ready, lat, lon, merchants, caches, events, cachePin, userLat, userLon, userAccuracyMetres]);

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
          source={{ html }}
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
      <View
        style={containerStyle}
        testID="explore-minimap"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
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
    // Wrapping View captures touch lifecycle (notification-only) so the
    // parent scroll container can freeze itself while the user is
    // interacting with the map. TouchableOpacity's typing doesn't
    // expose onTouch* — putting it on the inner View keeps types happy
    // without losing the tap-to-open behaviour.
    //
    // The wrapping View takes `containerStyle` too so `fill` mode's
    // `flex: 1` propagates through; without it the unstyled View
    // collapses to 0 px in a parent that constrains by height (cache
    // detail hero), and the WebView paints into a 0×0 box (the empty
    // grey container Ben saw on the cache-detail screen).
    <View
      style={containerStyle}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <TouchableOpacity
        style={styles.tapFillOverlay}
        activeOpacity={0.85}
        onPress={onTapMap}
        accessibilityLabel="Open full map"
        testID="explore-minimap"
      >
        {children}
      </TouchableOpacity>
    </View>
  );
};

// ---- Leaflet HTML (no controls, mirrors the MapScreen pin language) -------

const makeHtml = (
  lat: number,
  lon: number,
  defaultZoom: number,
  interactive: boolean,
  // JSON-encoded LP_setHub payload to render alongside Leaflet on the
  // very first paint. Empty string skips the inline call (subscriber
  // updates will land via injectJavaScript when relay data arrives).
  // See `initialHubPayloadRef` in the component for the bake site.
  initialHubPayloadJson: string,
): string => `<!DOCTYPE html>
<html>
<head>
  ${LEAFLET_HEAD_TAGS}
  <style>
    ${LEAFLET_BASE_CSS}
    ${LEAFLET_MAP_BACKGROUND_CSS}
    .lp-pin{width:14px;height:14px;border-radius:7px;background:#EC008C;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-pin.onchain{background:#F5A623}
    /* Round circles match the list-row iconWrap (pink for Piglet,
       slate for vanilla NIP-GC). Earlier diamond version made the
       map<>list mapping ambiguous at a glance. */
    /* Cache pin — small dot kept only as a fallback class; the actual
       cache markers use the cacheCircle() SVG below so the glyph
       matches the list-row iconWrap on HuntScreen. Purple is the new
       NIP-GC colour (was slate; user-visible inconsistency with the
       list which was already using brand colours). */
    .lp-cache{width:14px;height:14px;border-radius:7px;background:#7A5CFF;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    .lp-cache.piggy{background:#EC008C}
    .lp-event{width:14px;height:14px;border-radius:3px;background:#5b3aff;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
    /* Pulsating "you" dot: solid blue core + an outward ripple via
       ::after that scales out and fades. Subtle enough not to nag,
       clear enough to spot at a glance. */
    ${ME_DOT_CSS}
    /* Hide Leaflet's default UI for the preview */
    .leaflet-control-zoom,.leaflet-control-attribution{display:none!important}
  </style>
</head>
<body>
<div id="map"></div>
${LEAFLET_SCRIPT_TAG}
<script>
${ME_DOT_JS}
${POST_BRIDGE_JS}
// minZoom 7 caps the bbox at about 400 km wide at UK latitudes — wider
// than that and the list becomes "everything within a country" rather
// than "nearby", which is the wrong product for an Explore-hub mini-map.
// Was 8 before; raised to 7 after user feedback that one more level
// out felt more natural on the Places list.
// maxZoom 18 matches OSM tile availability.
const __interactive=${interactive ? 'true' : 'false'};
const map=L.map('map',{zoomControl:false,dragging:__interactive,scrollWheelZoom:__interactive,doubleClickZoom:__interactive,touchZoom:__interactive,boxZoom:false,keyboard:false,minZoom:7,maxZoom:18,tap:__interactive}).setView([${lat},${lon}],${defaultZoom});
${tileLayerJs()}
let merchantLayer=L.layerGroup().addTo(map),cacheLayer=L.layerGroup().addTo(map),eventLayer=L.layerGroup().addTo(map);
const dot=(cls,size)=>L.divIcon({className:'',html:'<div class="'+cls+'"></div>',iconSize:[size,size]});
// SVG palette + categorySvg() helper — sourced from
// src/utils/mapPinSvgs/. The WebView can't import TS modules
// directly, so the index module exports a generated JS string we
// interpolate here. One file per icon in that folder; future BTC Map
// categories add a new file + one line in CATEGORY_SVGS.
${MAP_PIN_SVG_PALETTE_JS}
// The piggy glyph sits ~2px lower than the map-pin glyph in its viewBox,
// so it gets a slightly larger y-offset to stay optically centred.
const pinIcon=(piggy)=>L.divIcon({className:'',iconSize:[36,44],iconAnchor:[18,44],html:'<svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg"><path d="M18 2C9.7 2 3 8.7 3 17c0 10 15 25 15 25s15-15 15-25C33 8.7 26.3 2 18 2z" fill="'+(piggy?'#EC008C':'#7A5CFF')+'" stroke="#fff" stroke-width="2"/><g transform="translate(9 '+(piggy?9:7)+') scale(0.75)" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+(piggy?PIGGY_SVG:MAPPIN_SVG)+'</g></svg>'});
// Small-circle marker base. Used for cache pins AND merchant pins so
// both surfaces read as the same kind-of-thing (a place with an icon
// telling you what kind). 28-px circle with the supplied SVG glyph
// inside; iconAnchor is the centre so the dot's middle sits on the
// real lat/lon. Zap badge sits top-right (nudged 4 px outside the
// circle border so it doesn't overlap the inner glyph) — used for
// LP Piggies, which always carry a payout-lnurl-w per NIP-32 label.
const ZAP_BADGE='<g transform="translate(20 -2)"><circle cx="6" cy="6" r="6" fill="#FFB200" stroke="#fff" stroke-width="1.5"/><path d="M6.8 1.8 L3.2 7.2 L5.8 7.2 L5.2 10.2 L8.8 4.8 L6.2 4.8 Z" fill="#fff"/></g>';
const placeCircle=(fillColour,innerSvg,withZap)=>L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,14],html:'<svg width="32" height="32" viewBox="-2 -2 32 32" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="14" r="12" fill="'+fillColour+'" stroke="#fff" stroke-width="2"/><g transform="translate(7 7) scale(0.583)" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+innerSvg+'</g>'+(withZap?ZAP_BADGE:'')+'</svg>'});
const cacheCircle=(piggy)=>placeCircle(piggy?'#EC008C':'#7A5CFF',piggy?PIGGY_SVG:MAPPIN_SVG,piggy);
const merchantCircle=(category,lightning)=>placeCircle(lightning?'#EC008C':'#F7931A',categorySvg(category),false);
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
  // placeOrUpdateMe (from src/utils/mapMeDot.ts) reuses the existing
  // marker via setLatLng() when one's already on the map — that keeps
  // the .lp-me CSS pulse continuous instead of restarting on every
  // setHub call. Same helper used by the full MapScreen so the dot
  // animation is byte-identical across surfaces.
  if(d.me){
    placeOrUpdateMe(map,[d.me.lat,d.me.lng],d.me.accuracy);
  } else {
    removeMe(map);
  }
  d.merchants.forEach(m=>L.marker([m.lat,m.lng],{icon:merchantCircle(m.category,m.lightning)}).addTo(merchantLayer));
  d.caches.forEach(c=>L.marker([c.lat,c.lng],{icon:d.cachePin?pinIcon(c.kind==='piggy'):cacheCircle(c.kind==='piggy')}).addTo(cacheLayer));
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
// Render any pins the parent already had cached at mount time —
// runs synchronously on first paint, no React round-trip required.
// See initialHubPayloadRef in the component. Empty string skips
// (parent had nothing to bake).
${initialHubPayloadJson ? 'try{LP_setHub(' + initialHubPayloadJson + ');}catch(_){}' : ''}
post({type:'ready'});
// Also emit straight away — covers the case where LP_setHub hasn't
// been called yet (parent has no data) but the map already shows the
// injected viewport from LP_initialViewport or the HTML default.
emitBounds();
</script>
</body></html>`;

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
    // The non-interactive wrapper's inner TouchableOpacity used to own
    // containerStyle. We moved that to the outer View so `fill` mode's
    // flex propagates correctly; the TouchableOpacity now just needs
    // to fill its parent.
    tapFillOverlay: { flex: 1 },
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
