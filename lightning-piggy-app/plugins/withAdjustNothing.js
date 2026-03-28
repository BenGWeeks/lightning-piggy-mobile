const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Sets android:windowSoftInputMode="adjustNothing" on the main activity.
 * This prevents the keyboard from pushing/resizing the app layout.
 */
module.exports = function withAdjustNothing(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const mainActivity = manifest.manifest.application[0].activity.find(
      (a) => a.$['android:name'] === '.MainActivity'
    );
    if (mainActivity) {
      mainActivity.$['android:windowSoftInputMode'] = 'adjustNothing';
    }
    return config;
  });
};
