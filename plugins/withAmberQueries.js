const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Adds <queries> block to AndroidManifest.xml so Android allows
 * the app to discover and launch Amber (nostrsigner: scheme).
 */
module.exports = function withAmberQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest.queries) {
      manifest.queries = [];
    }

    manifest.queries.push({
      intent: [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
          data: [{ $: { 'android:scheme': 'nostrsigner' } }],
        },
      ],
    });

    return config;
  });
};
