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

          // NDEF_DISCOVERED filters for the schemes LP handles on an NFC tap.
          // Without these, tapping a tag does nothing in foreground/background
          // (or lands in another wallet) — Android's NFC dispatch has no LP
          // activity to route the URI to. All four are routed by the Linking
          // handler in App.tsx:
          //   - `lightningpiggy` — record 1 of a Hunt/Piglet tag
          //     (`lightningpiggy://hunt/<coord>`) → opens the cache page.
          //   - `lightning` / `lnurlw` / `lnurl` — standalone LNURL-withdraw
          //     tags / gift cards whose FIRST record is the withdraw URI
          //     (`lnurl://` is the rare spec-allowed cleartext form) → in-app claim
          //     (#341 rework: replaced a passive foreground listener that lost
          //     to the system dispatch). Android dispatches on the FIRST NDEF
          //     record only, so Piglets (record 1 = `lightningpiggy`) are
          //     unaffected — their `lightning:` bearer is record 3. Android
          //     shows its app chooser if another LN wallet also handles
          //     `lightning`/`lnurlw`, so we don't hijack the user's preferred
          //     wallet.
          const addNdefScheme = (scheme) => {
            const exists = filters.some(
              (f) =>
                Array.isArray(f.action) &&
                f.action.some(
                  (a) => a.$?.['android:name'] === 'android.nfc.action.NDEF_DISCOVERED',
                ) &&
                Array.isArray(f.data) &&
                f.data.some((d) => d.$?.['android:scheme'] === scheme),
            );
            if (!exists) {
              filters.push({
                action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
                category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
                data: [{ $: { 'android:scheme': scheme } }],
              });
            }
          };
          // `lnurl` is the rare spec-allowed cleartext form App.tsx also routes;
          // register it so `lnurl://…` tags aren't a silent no-op on Android.
          ['lightningpiggy', 'lightning', 'lnurlw', 'lnurl'].forEach(addNdefScheme);
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
  // Always overwrite (no `if (!...)` guard) — a stale `['NDEF']` from a prior
  // plugin run or upstream config would silently survive otherwise and the
  // App Store validator would re-reject the IPA with the same error.
  config = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.nfc.readersession.formats'] = ['TAG'];
    return config;
  });

  return config;
}

module.exports = function withNfc(config) {
  config = withNfcAndroid(config);
  config = withNfcIos(config);
  return config;
};
