const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Sets android:windowSoftInputMode="adjustResize" on the main activity.
 * This allows the keyboard to resize the layout so bottom sheets can
 * slide up above the keyboard.
 */
module.exports = function withAdjustNothing(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest?.application;
    if (!application || !application[0]) return config;
    const activities = application[0].activity;
    if (!Array.isArray(activities)) return config;
    const mainActivity = activities.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity.$['android:windowSoftInputMode'] = 'adjustResize';
    }
    return config;
  });
};
