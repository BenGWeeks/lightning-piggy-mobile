const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Adds <queries> block to AndroidManifest.xml so Android allows
 * the app to discover and launch Amber (nostrsigner:) and Nostr apps (nostr:).
 */
module.exports = function withAmberQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.queries) {
      manifest.queries = [];
    }

    // Collect existing schemes to avoid duplicates on repeated prebuilds
    const existingSchemes = new Set();
    manifest.queries.forEach((query) => {
      if (!query || !query.intent) return;
      query.intent.forEach((intent) => {
        if (!intent || !intent.data) return;
        intent.data.forEach((data) => {
          const scheme = data && data.$ && data.$['android:scheme'];
          if (scheme) existingSchemes.add(scheme);
        });
      });
    });

    const requiredSchemes = ['nostrsigner', 'nostr'];
    const missingSchemes = requiredSchemes.filter((s) => !existingSchemes.has(s));

    if (missingSchemes.length > 0) {
      manifest.queries.push({
        intent: missingSchemes.map((scheme) => ({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
          data: [{ $: { 'android:scheme': scheme } }],
        })),
      });
    }

    return config;
  });
};
