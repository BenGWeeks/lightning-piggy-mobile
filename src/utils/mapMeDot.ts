// Single source of truth for the "you" dot rendered inside every
// Leaflet WebView in the app — the inline mini-maps on Explore /
// Hunt and the full-screen MapScreen. Lives as a plain TS string
// constant because the WebView's HTML is built outside React, so we
// can't share a React component there; this is the next-best
// abstraction.
//
// The dot uses two visual layers:
//   1. Solid blue core (14×14, white border, blue glow box-shadow)
//   2. A pulsing ::after halo that scales out and fades — the
//      "I'm alive" signal at any zoom level.
// Plus an OPTIONAL L.circle accuracy halo drawn by callers when the
// fix carries `coords.accuracy` — that one is sized in real metres
// so it scales with zoom, giving the GPS-accuracy "smudge" that
// matches Apple / Google Maps.

export const ME_DOT_PULSE_DURATION_MS = 2000;

/**
 * CSS to embed inside the Leaflet WebView's `<style>` block. Used by
 * MapScreen.tsx + ExploreMiniMap.tsx — keep these two consumers in
 * lock-step. The pulse duration (2 s) is calm enough not to nag and
 * fast enough that the dot feels live; previous mini-map setting of
 * 1.8 s read as "too fast" relative to the static dot on MapScreen,
 * which had no pulse at all.
 */
export const ME_DOT_CSS = `
.lp-me{position:relative;width:14px;height:14px;border-radius:7px;background:#2D88FF;border:2px solid #fff;box-shadow:0 0 0 3px rgba(45,136,255,0.25);z-index:1000}
.lp-me::after{content:'';position:absolute;top:50%;left:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:rgba(45,136,255,0.45);animation:lp-pulse 2s ease-out infinite;z-index:-1}
@keyframes lp-pulse{0%{transform:scale(0.4);opacity:1}100%{transform:scale(2.6);opacity:0}}
`.trim();

/**
 * JavaScript snippet (string) to embed inside the Leaflet `<script>`
 * block. Defines:
 *
 *   • `meIconHtml()` — inner HTML for the divIcon
 *   • `drawAccuracyCircle(map, latlng, m)` — translucent halo
 *   • `__lpMeState` — module-level holder for { marker, accuracyCircle }
 *   • `placeOrUpdateMe(map, latlng, m)` — the function both maps should
 *     call when they have a new fix. Reuses the existing marker via
 *     `setLatLng()` rather than rebuilding the DOM each call — REUSING
 *     keeps the CSS pulse animation playing continuously. Rebuilding
 *     restarts the animation from frame 0 every time, which made the
 *     inline mini-map (where setHub re-fires on every relay event)
 *     visibly stutter vs the full map's smooth single-shot pulse.
 *
 * Both maps now route through `placeOrUpdateMe` so the dot looks
 * byte-identical AND animates continuously regardless of how often
 * the parent re-emits.
 */
export const ME_DOT_JS = `
function meIconHtml(){return '<div class="lp-me"></div>';}
function drawAccuracyCircle(map, latlng, accuracyMetres){
  if(typeof accuracyMetres!=='number'||accuracyMetres<=0)return null;
  return L.circle(latlng,{radius:accuracyMetres,color:'#2D88FF',weight:1,opacity:0.4,fillColor:'#2D88FF',fillOpacity:0.12,interactive:false}).addTo(map);
}
var __lpMeState = { marker: null, accuracyCircle: null };
function placeOrUpdateMe(map, latlng, accuracyMetres){
  if (__lpMeState.marker) {
    __lpMeState.marker.setLatLng(latlng);
  } else {
    __lpMeState.marker = L.marker(latlng, {
      icon: L.divIcon({ className: '', html: meIconHtml(), iconSize: [14,14], iconAnchor: [7,7] }),
    }).addTo(map);
  }
  var hasAccuracy = typeof accuracyMetres === 'number' && accuracyMetres > 0;
  if (__lpMeState.accuracyCircle) {
    if (hasAccuracy) {
      __lpMeState.accuracyCircle.setLatLng(latlng);
      __lpMeState.accuracyCircle.setRadius(accuracyMetres);
    } else {
      map.removeLayer(__lpMeState.accuracyCircle);
      __lpMeState.accuracyCircle = null;
    }
  } else if (hasAccuracy) {
    __lpMeState.accuracyCircle = drawAccuracyCircle(map, latlng, accuracyMetres);
  }
}
function removeMe(map){
  if (__lpMeState.marker) { map.removeLayer(__lpMeState.marker); __lpMeState.marker = null; }
  if (__lpMeState.accuracyCircle) { map.removeLayer(__lpMeState.accuracyCircle); __lpMeState.accuracyCircle = null; }
}
`.trim();
