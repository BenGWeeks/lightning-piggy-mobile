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
 *   - A *foreground* service holds a `specialUse` type, displays a persistent
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
 *   2. `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>`
 *      — required on Android 14 (API 34)+ in addition to the above for
 *      `foregroundServiceType="specialUse"` (chosen over dataSync because
 *      Android 15 caps dataSync at 6h/24h and bans it from BOOT_COMPLETED;
 *      the module manifest declares the mandatory FGS_SUBTYPE property).
 *   3. `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
 *      — required on Android 13+ to display the persistent foreground
 *      notification at all (POST_NOTIFICATIONS is a runtime permission;
 *      requested lazily by `notificationService.ts`).
 *   4. `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>`
 *      — so we can re-arm the listener after device reboot.
 *   (WAKE_LOCK was dropped with the HeadlessJsTaskService-based service —
 *   the custom Service holds no wake lock; see BackgroundDmService.kt.)
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
 * Where the native glue now lives (it HAS landed — #279):
 *
 *   - The Kotlin foreground `Service` (`BackgroundDmService`, a
 *     custom Service that dispatches the `BackgroundDmTask` headless JS
 *     task via HeadlessJsTaskContext — no wake lock, calling `backgroundDmService.runBackgroundDmWatch()`), its JS↔native
 *     start/stop bridge (`BackgroundDmModule`), and the reboot `BootReceiver`
 *     all live in the local Expo module `modules/background-dm-service`.
 *   - Crucially, the `<service android:foregroundServiceType="specialUse">` and
 *     the `<receiver>` for BOOT_COMPLETED are declared in THAT module's own
 *     AndroidManifest.xml — NOT injected here. The classes they name live in
 *     the same module, so they compile together and the manifest can never
 *     point at a missing class (the exact prebuild hazard this plugin
 *     previously side-stepped by deferring the `<service>` add). The module
 *     manifest is merged into the app manifest at build time.
 *
 * So this plugin's job is now narrowly the PERMISSIONS — they're declared
 * here because they're app-wide (they surface in the install prompt) and a
 * couple of them (POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED) are requested /
 * used from JS, not just by the module. The `<service>`/`<receiver>` wiring is
 * the module's responsibility.
 *
 * Idempotent across `npx expo prebuild` runs — checks for existing
 * permission entries before pushing.
 */
const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
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

    // The <service android:foregroundServiceType="specialUse"> and the reboot
    // <receiver> are declared by the local Expo module's own manifest
    // (modules/background-dm-service/android/src/main/AndroidManifest.xml),
    // which merges into the app manifest at build time. They live there — not
    // injected here — so the manifest entries and the Kotlin classes they name
    // compile together and can never drift into a missing-class prebuild break.

    return config;
  });
};
