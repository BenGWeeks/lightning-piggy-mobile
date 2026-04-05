const {
  withAndroidManifest,
  withInfoPlist,
  withEntitlementsPlist,
} = require('expo/config-plugins');

/**
 * Expo config plugin that adds NFC permissions and entitlements for
 * both Android and iOS so the app can read and write NDEF NFC tags.
 * Also registers lightning: URI scheme intent filter and NDEF discovery.
 */
function withNfcAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Add NFC permission
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    const hasNfcPermission = manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === 'android.permission.NFC',
    );
    if (!hasNfcPermission) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.NFC' },
      });
    }

    // Add NFC feature (required=false so non-NFC devices can still install)
    if (!manifest['uses-feature']) {
      manifest['uses-feature'] = [];
    }
    const hasNfcFeature = manifest['uses-feature'].some(
      (f) => f.$?.['android:name'] === 'android.hardware.nfc',
    );
    if (!hasNfcFeature) {
      manifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.nfc',
          'android:required': 'false',
        },
      });
    }

    // Add NDEF discovered intent filter and lightning: URI scheme
    // to the main activity so the app handles NFC tags and deep links
    const application = manifest.application;
    if (application && application[0]) {
      const activities = application[0].activity;
      if (Array.isArray(activities)) {
        const mainActivity = activities.find((a) => a.$?.['android:name'] === '.MainActivity');
        if (mainActivity) {
          if (!mainActivity['intent-filter']) {
            mainActivity['intent-filter'] = [];
          }
          const filters = mainActivity['intent-filter'];

          // Check existing intent filters to avoid duplicates
          const hasNdefFilter = filters.some((f) =>
            f.action?.some((a) => a.$?.['android:name'] === 'android.nfc.action.NDEF_DISCOVERED'),
          );

          if (!hasNdefFilter) {
            // NDEF discovered intent filter for NFC tags
            filters.push({
              action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
              category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
              data: [{ $: { 'android:mimeType': 'text/plain' } }],
            });
          }

          // Add lightning: scheme handler
          const hasLightningScheme = filters.some(
            (f) =>
              f.data?.some((d) => d.$?.['android:scheme'] === 'lightning') &&
              f.action?.some((a) => a.$?.['android:name'] === 'android.intent.action.VIEW'),
          );

          if (!hasLightningScheme) {
            filters.push({
              action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
              category: [
                { $: { 'android:name': 'android.intent.category.DEFAULT' } },
                { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
              ],
              data: [{ $: { 'android:scheme': 'lightning' } }],
            });
          }
        }
      }
    }

    return config;
  });
}

function withNfcIos(config) {
  // Add NFC usage description to Info.plist
  config = withInfoPlist(config, (config) => {
    config.modResults.NFCReaderUsageDescription =
      'Lightning Piggy uses NFC to read and write Lightning payment data and Nostr identities.';

    // Register NDEF tag reader session format
    if (!config.modResults['com.apple.developer.nfc.readersession.formats']) {
      config.modResults['com.apple.developer.nfc.readersession.formats'] = ['NDEF'];
    }

    return config;
  });

  // Add NFC entitlement
  config = withEntitlementsPlist(config, (config) => {
    if (!config.modResults['com.apple.developer.nfc.readersession.formats']) {
      config.modResults['com.apple.developer.nfc.readersession.formats'] = ['NDEF'];
    }
    return config;
  });

  return config;
}

module.exports = function withNfc(config) {
  config = withNfcAndroid(config);
  config = withNfcIos(config);
  return config;
};
