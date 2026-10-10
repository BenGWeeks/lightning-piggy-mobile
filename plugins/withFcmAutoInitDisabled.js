const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * Keeps Firebase Cloud Messaging dormant until the user opts in.
 *
 * `android.googleServicesFile` (app.config.ts) initialises Firebase at app
 * start so the OPT-IN Marmot push (MIP-05) can fetch an FCM token. By
 * default FCM would then register a token with Google on every launch,
 * whether or not push is on. With auto-init off, nothing talks to FCM until
 * `getDevicePushTokenAsync()` is called — i.e. only after the user turns on
 * "Message notifications via push (Marmot)" (src/services/marmotPushRegistration.ts).
 * Un-googled devices (GrapheneOS, microG) are unaffected either way.
 */
module.exports = function withFcmAutoInitDisabled(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      'firebase_messaging_auto_init_enabled',
      'false',
    );
    return config;
  });
};
