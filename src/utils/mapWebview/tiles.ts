// Shared boilerplate for every Leaflet WebView in the app —
// MapScreen.tsx (full-screen map), ExploreMiniMap.tsx (inline preview)
// and LocationPickerSheet.tsx (draggable pin). Each of those files
// used to inline its own copy of the Leaflet CDN <link>/<script>, the
// base `html,body,#map { … }` reset, the OSM tile-layer init line and
// a one-liner `post()` bridge helper. Drift between them broke
// silently — bump leaflet here, every map gets the bump.
//
// All exports are plain TS strings interpolated into the WebView's
// makeHtml(…) template literal. The WebView is a sandboxed HTML
// island so React modules cannot reach it; string-template injection
// is the next-best abstraction (mirrors the pattern used by
// `mapMeDot.ts` and `mapPinSvgs/`).

// Leaflet version is centralised here so all three maps stay aligned.
export const LEAFLET_VERSION = '1.9.4';

// Head-tag boilerplate: viewport meta + Leaflet CSS. Interpolated into
// the `<head>` block of every map. The viewport meta locks scale so
// pinch-zoom drives Leaflet's own zoom instead of the WebView's text
// zoom layer (which would blur tiles).
export const LEAFLET_HEAD_TAGS = `
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" />
`.trim();

// Base reset used by every map. ExploreMiniMap + LocationPickerSheet
// stack a `background:#eee` rule on top of this so the tile gutter
// doesn't flash white before the first tile decodes; MapScreen omits
// the background entirely. The base rule is identical across all
// three sites — the optional background lives in each caller.
export const LEAFLET_BASE_CSS = 'html,body,#map{margin:0;padding:0;height:100%;width:100%}';

// Mini-map / picker pre-tile background — paired with LEAFLET_BASE_CSS
// in `<style>`. Kept as a separate rule so MapScreen can opt out
// without forking the reset.
export const LEAFLET_MAP_BACKGROUND_CSS = '#map{background:#eee}';

// Leaflet `<script>` import tag — paired with LEAFLET_HEAD_TAGS for a
// consistent CDN version. Goes inside `<body>` immediately before the
// inline script that uses `L.…`.
export const LEAFLET_SCRIPT_TAG = `<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"></script>`;

// OSM tile-layer JS — every map uses the same OSM tile endpoint and
// the same maxZoom of 19 (Leaflet's default zoom ceiling that OSM
// reliably ships tiles for). MapScreen adds an attribution string;
// the mini-maps suppress the control entirely so it's not lost on
// them. Callers can pass extra options via `extraOptions`.
export const tileLayerJs = (extraOptions?: string): string => {
  const opts = extraOptions ? `,${extraOptions}` : '';
  return `L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19${opts}}).addTo(map);`;
};

// One-line `post()` helper bound to React Native's WebView bridge.
// All three maps had identical copies of this. Inlined into the
// WebView's `<script>` block so handler code can call `post({…})`
// without any further plumbing.
export const POST_BRIDGE_JS =
  'const post=(m)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));';
