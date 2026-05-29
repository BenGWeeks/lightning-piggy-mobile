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

          // NDEF_DISCOVERED for the lightningpiggy://hunt/<coord> scheme.
          // Without this, tapping a written Piglet tag while the app is
          // foreground/background does nothing — Android's NFC dispatch
          // has no activity to route the URI to. The earlier nostr: /
          // lightning: registrations were intentionally disabled because
          // the JS side had no Linking handler; we now route both
          // `lightningpiggy://hunt/<coord>` and `nostr:naddr1…` in
          // App.tsx, so re-enabling for our own scheme is safe.
          //
          // Scoped to `lightningpiggy` only (NOT `nostr:` or `lightning:`)
          // so we don't intercept the user's preferred Nostr / Lightning
          // wallet for those broader schemes.
          const hasNdefLpFilter = filters.some(
            (f) =>
              Array.isArray(f.action) &&
              f.action.some(
                (a) => a.$?.['android:name'] === 'android.nfc.action.NDEF_DISCOVERED',
              ) &&
              Array.isArray(f.data) &&
              f.data.some((d) => d.$?.['android:scheme'] === 'lightningpiggy'),
          );
          if (!hasNdefLpFilter) {
            filters.push({
              action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
              category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
              data: [{ $: { 'android:scheme': 'lightningpiggy' } }],
            });
          }

          // NDEF_DISCOVERED for the `nostr:` scheme — conference contact
          // badges whose first record is `nostr:nprofile1…` / `nostr:npub1…`
          // (#754). Without this, tapping such a tag while the app is
          // foreground/background routes to whatever generic Nostr app the
          // OS picks (or nothing). The VIEW intent filter in app.config.ts
          // covers the deep-link / cold-launch case; this NDEF filter covers
          // a foreground tag tap. Scoped to `nostr` only — the JS router in
          // App.tsx decodes npub / nprofile → ContactProfile and falls back
          // to UnsupportedEntity for note / nevent.
          const hasNdefNostrFilter = filters.some(
            (f) =>
              Array.isArray(f.action) &&
              f.action.some(
                (a) => a.$?.['android:name'] === 'android.nfc.action.NDEF_DISCOVERED',
              ) &&
              Array.isArray(f.data) &&
              f.data.some((d) => d.$?.['android:scheme'] === 'nostr'),
          );
          if (!hasNdefNostrFilter) {
            filters.push({
              action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
              category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
              data: [{ $: { 'android:scheme': 'nostr' } }],
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
