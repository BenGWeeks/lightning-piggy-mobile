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
 * What the TS layer now adds on top (the realtime-DM upgrade, #279):
 *
 *   - `src/services/backgroundDmService.ts` — the control + worker layer
 *     for the persistent watch: it posts the foreground status chip,
 *     opens the live kind-1059 relay subscription, decrypts (nsec) or
 *     posts contentless (Amber/NIP-46), and fires signer-aware local
 *     notifications. Driven by the "Background message notifications"
 *     toggle in Account → Security (default OFF).
 *
 * What is STILL INTENTIONALLY deferred to a follow-up PR (the native glue
 * this config plugin cannot supply without a Kotlin compile):
 *
 *   - The actual Java/Kotlin `Service` class (`NostrRelayService.kt`) and
 *     its `<service>` registration, plus the headless-JS host that calls
 *     `backgroundDmService.runBackgroundDmWatch()` from the service. We
 *     deliberately do NOT push a `<service>` entry here yet: registering a
 *     `<service android:name=".NostrRelayService">` whose class doesn't
 *     compile breaks the prebuild. The permissions below are independently
 *     meaningful (they show in the install prompt and gate the next
 *     iteration), so they land now; the `<service>` add ships with the
 *     Kotlin code. The ready-to-use shape is in the TODO block below.
 *   - A `BootReceiver` to re-launch the service after reboot (uses the
 *     RECEIVE_BOOT_COMPLETED permission added above).
 *
 * Until that native host lands, the TS watch only persists while the app's
 * JS context is alive — it already improves the foreground experience and
 * becomes a true background watch the moment the native service keeps the
 * context running.
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

    // TODO(native foreground service, #279): once the Kotlin Service class
    // + headless-JS host land (the host calls
    // backgroundDmService.runBackgroundDmWatch()), add the <service> entry
    // here. Do NOT enable this block before the class compiles — a manifest
    // <service> pointing at a missing class breaks the prebuild. Ready shape:
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
