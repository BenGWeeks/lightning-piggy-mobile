const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Sets android:largeHeap="true" on the <application> element.
 *
 * The Map screen uses a WebView running Leaflet + OSM tiles, and on
 * GrapheneOS Vanadium the WebView's native library load (libmonochrome_64.so
 * via dlopen) needs ~230 MB of contiguous address space. Hermes + the
 * standard RN libs typically eat the first 30-60 MB of the 64-bit virtual
 * space before the WebView gets to allocate, so the dlopen fails and the
 * map renders blank.
 *
 * `largeHeap` is the Android-level escape hatch: lets the app request more
 * heap than the per-app default and gives the JVM more headroom to keep
 * the address layout sparse. Combined with the LP_initialViewport hydrate
 * (see MapScreen) and the userInitiated-gated viewport persistence, this
 * keeps the map functional on GrapheneOS / Vanadium without breaking
 * stock Chrome WebView.
 *
 * Side effects: slightly higher idle memory on low-RAM Android. Acceptable
 * trade for the Map screen working at all on GrapheneOS.
 */
module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest?.application;
    if (!application || !application[0]) return config;
    application[0].$['android:largeHeap'] = 'true';
    return config;
  });
};
