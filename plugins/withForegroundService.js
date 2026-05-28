const { withAndroidManifest } = require('expo/config-plugins');

/**
 * withForegroundService — adds the Android manifest entries needed for
 * a persistent foreground service that maintains the relay WebSocket +
 * LNbits / NWC subscriptions while the app is backgrounded or closed.
 *
 * Why a foreground service (and not WorkManager / JobScheduler):
 *
 *   - Doze mode (Android 6+) and App Standby Buckets (Android 9+) will
 *     suspend background WebSockets within minutes for an idle app.
 *     Periodic WorkManager jobs run at most every 15 min and are
 *     coalesced under battery saver, missing real-time messages.
 *   - A *foreground* service holds a `dataSync` (or
 *     `specialUse` on Android 14+) type, displays a persistent
 *     notification, and is exempt from Doze. This is the only
 *     Doze-immune path that does NOT require Google Play Services.
 *   - FCM (the alternative) requires GMS, which doesn't exist on
 *     GrapheneOS / microG / un-googled devices — see issue #279.
 *
 * What this plugin lands today (the "architectural commitment" part of
 * the foundation PR):
 *
 *   1. `<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>`
 *      — required for any foreground service on Android 9+.
 *   2. `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>`
 *      — required on Android 14 (API 34)+ in addition to the above for
 *      `foregroundServiceType="dataSync"`.
 *   3. `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
 *      — required on Android 13+ to display the persistent foreground
 *      notification at all (POST_NOTIFICATIONS is a runtime permission;
 *      requested lazily by `notificationService.ts`).
 *   4. `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>`
 *      — so we can re-arm the listener after device reboot.
 *   5. `<uses-permission android:name="android.permission.WAKE_LOCK"/>`
 *      — partial wake lock during socket-recovery windows.
 *
 * What is INTENTIONALLY deferred to a follow-up PR:
 *
 *   - The actual Java/Kotlin `Service` class (`NostrRelayService.java`)
 *     and its `<service>` registration. Adding the `<service>` entry
 *     without a class behind it would break the prebuild — the
 *     manifest references a class that doesn't compile. So we land
 *     the *permissions* now (which are independently meaningful: they
 *     show up in the install prompt for the user and force the next
 *     iteration to confirm them) and leave the `<service>` add to the
 *     PR that ships the actual Kotlin code.
 *   - A `BootReceiver` to re-launch the service after reboot (uses the
 *     RECEIVE_BOOT_COMPLETED permission added above).
 *
 * Idempotent across `npx expo prebuild` runs — checks for existing
 * permission entries before pushing.
 */
const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK',
];

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    const existing = new Set(
      manifest['uses-permission']
        .map((p) => p.$ && p.$['android:name'])
        .filter((n) => typeof n === 'string'),
    );

    for (const perm of REQUIRED_PERMISSIONS) {
      if (!existing.has(perm)) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }

    // TODO(#279 follow-up): once the Kotlin Service class lands, add
    // its <service> entry here — example shape:
    //
    //   const application = manifest.application?.[0];
    //   if (application) {
    //     application.service = application.service ?? [];
    //     const has = application.service.some(
    //       (s) => s.$?.['android:name'] === '.NostrRelayService',
    //     );
    //     if (!has) {
    //       application.service.push({
    //         $: {
    //           'android:name': '.NostrRelayService',
    //           'android:exported': 'false',
    //           'android:foregroundServiceType': 'dataSync',
    //         },
    //       });
    //     }
    //   }
    //
    // The same follow-up should add the BootReceiver:
    //
    //   application.receiver = application.receiver ?? [];
    //   ...register .BootReceiver with android.intent.action.BOOT_COMPLETED.

    return config;
  });
};
