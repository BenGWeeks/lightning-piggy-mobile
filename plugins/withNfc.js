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

          // INTENT FILTERS DELIBERATELY NOT REGISTERED IN THIS PR.
          //
          // The original PR registered:
          //   - NDEF_DISCOVERED `android:scheme="nostr"` — for tag taps
          //     to launch the app on a `nostr:npub1…` payload.
          //   - VIEW + BROWSABLE `android:scheme="lightning"` — for
          //     deep-linked Lightning URIs (`lightning:lnbc…`).
          //
          // Both register the app as a HANDLER, but the JS side has no
          // `Linking` URL listener / NavigationContainer `linking`
          // config to route the incoming intent yet. Result on a
          // shipping build: tapping a tag / following a `lightning:`
          // link launches the app to a blank Home screen and silently
          // does nothing — and worse, may intercept the URL away from
          // the user's preferred handler. Adding scan/route is
          // tracked as the deferred follow-up to PR #231.
          //
          // When that lands, restore the intent-filter registrations
          // here. Until then, NFC WRITE works fine without them
          // (writeNpubToTag drives the NfcManager session directly,
          // no intent involved).
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
    // NOTE: do NOT also set `com.apple.developer.nfc.readersession.formats`
    // here — that's an ENTITLEMENT key, not an Info.plist key. Apple's
    // build chain ignores it from Info.plist (and earlier versions
    // would warn). The same key is set correctly via
    // `withEntitlementsPlist` below.
    return config;
  });

  // Add NFC entitlement (correct location for readersession.formats).
  // Apple's App Store Connect validator (Xcode 16+ / SDK 26.x with min iOS 15.1)
  // rejects 'NDEF' here as "disallowed" and requires 'TAG' instead.
  // 'TAG' covers reading raw tag UIDs and writing NDEF — the NFCNDEFReaderSession
  // at runtime works without 'NDEF' being in this entitlement.
  config = withEntitlementsPlist(config, (config) => {
    if (!config.modResults['com.apple.developer.nfc.readersession.formats']) {
      config.modResults['com.apple.developer.nfc.readersession.formats'] = ['TAG'];
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
