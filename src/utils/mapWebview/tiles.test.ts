// Locks the contracts of the Leaflet WebView head/body string builders
// in mapWebview/tiles.ts. These strings are interpolated into makeHtml
// template literals across MapScreen / ExploreMiniMap /
// LocationPickerSheet — drifting any one of them silently breaks one
// or more of those maps, so we pin the exact text shape here.

import {
  LEAFLET_BASE_CSS,
  LEAFLET_HEAD_TAGS,
  LEAFLET_MAP_BACKGROUND_CSS,
  LEAFLET_SCRIPT_TAG,
  LEAFLET_VERSION,
  POST_BRIDGE_JS,
  tileLayerJs,
} from './tiles';

describe('mapWebview/tiles', () => {
  it('pins the Leaflet CDN version so all three maps bump in lock-step', () => {
    expect(LEAFLET_VERSION).toBe('1.9.4');
    expect(LEAFLET_HEAD_TAGS).toContain(`leaflet@${LEAFLET_VERSION}/dist/leaflet.css`);
    expect(LEAFLET_SCRIPT_TAG).toContain(`leaflet@${LEAFLET_VERSION}/dist/leaflet.js`);
  });

  it('head tags carry the no-scale viewport meta', () => {
    expect(LEAFLET_HEAD_TAGS).toContain('user-scalable=no');
    expect(LEAFLET_HEAD_TAGS).toContain('initial-scale=1.0');
  });

  it('base CSS zeroes margin / padding and fills the viewport', () => {
    expect(LEAFLET_BASE_CSS).toBe('html,body,#map{margin:0;padding:0;height:100%;width:100%}');
  });

  it('map-background CSS is a separate rule so MapScreen can opt out', () => {
    expect(LEAFLET_MAP_BACKGROUND_CSS).toBe('#map{background:#eee}');
    expect(LEAFLET_BASE_CSS).not.toContain('background');
  });

  it('tileLayerJs emits the OSM URL + maxZoom:19', () => {
    expect(tileLayerJs()).toBe(
      "L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);",
    );
  });

  it('tileLayerJs appends extra options inside the same options object', () => {
    expect(tileLayerJs("attribution:'© OpenStreetMap contributors'")).toBe(
      "L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);",
    );
  });

  it('post bridge helper guards against a missing ReactNativeWebView', () => {
    expect(POST_BRIDGE_JS).toContain('window.ReactNativeWebView&&');
    expect(POST_BRIDGE_JS).toContain('postMessage(JSON.stringify');
  });
});
