/**
 * backgroundDmHeadlessTask — registers the headless JS task that the native
 * Android foreground service (modules/background-dm-service →
 * BackgroundDmService.kt) runs to keep the NIP-17 relay subscription alive
 * while the app is backgrounded or swiped away (#279 realtime upgrade).
 *
 * HOW IT FITS TOGETHER.
 *   1. The user enables "Background message notifications" → the TS control
 *      layer (backgroundDmService.startBackgroundDmWatch) calls the native
 *      module's startService(), which starts BackgroundDmService.
 *   2. BackgroundDmService is a HeadlessJsTaskService: it spins up a headless
 *      JS context and runs the task registered HERE under the name
 *      "BackgroundDmTask" (must match BackgroundDmService.HEADLESS_TASK_NAME).
 *   3. This task opens the live kind-1059 subscription via
 *      runBackgroundDmWatch() and returns a Promise that never resolves, so
 *      the native service keeps the JS context — and the WebSocket — alive
 *      until the service is stopped.
 *
 * MUST be imported for its side effect from index.ts (the app entry) so the
 * task is registered the moment the JS bundle evaluates — including when the
 * OS relaunches the app headlessly to (re)start the service after a reboot,
 * where no React tree ever mounts.
 *
 * Android-only: AppRegistry.registerHeadlessTask is harmless on iOS (no native
 * service ever invokes it), but we guard anyway to keep the contract explicit.
 */
import { AppRegistry, Platform } from 'react-native';
import { runBackgroundDmWatch } from './backgroundDmService';
import { loadBackgroundDmEnabled } from './backgroundDmPreference';
import { stopForegroundService } from '../../modules/background-dm-service';

/** Must match BackgroundDmService.HEADLESS_TASK_NAME (Kotlin). */
export const BACKGROUND_DM_HEADLESS_TASK = 'BackgroundDmTask';

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(BACKGROUND_DM_HEADLESS_TASK, () => async () => {
    // Self-check the persisted preference. The native BootReceiver starts the
    // service blindly on reboot (it can't read AsyncStorage), so this is the
    // one place that can refuse to run a watch the user disabled — stop the
    // service and return immediately if so.
    const enabled = await loadBackgroundDmEnabled().catch(() => false);
    if (!enabled) {
      await stopForegroundService().catch(() => {});
      return;
    }

    // Arm the live subscription. runBackgroundDmWatch resolves as soon as the
    // subscription is OPEN (not when it ends) — but the native
    // HeadlessJsTaskService keeps the JS context alive only while the returned
    // task Promise is pending. So we deliberately DO NOT await-and-return on
    // the open: we return a Promise that never settles, anchoring the context
    // so the WebSocket stays alive until the service is stopped. The
    // subscription's own callbacks keep firing notifications in the meantime.
    await runBackgroundDmWatch();
    return new Promise<void>(() => {
      // Intentionally never resolves — see the comment above. The service is
      // torn down by stopService() (from stopBackgroundDmWatch), which kills
      // this headless context outright.
    });
  });
}
