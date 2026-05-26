/**
 * Background-task registration for OS notifications (#279).
 *
 * Uses `expo-background-task` — WorkManager on Android, BGTaskScheduler on
 * iOS — to run `runBackgroundSync` periodically while the app's UI isn't
 * mounted. No custom native code: one cross-platform JS task, scheduled by
 * the OS. Cadence is OS-controlled with a ~15-minute floor (the WorkManager
 * minimum); iOS spaces it further based on usage. That periodicity is fine
 * for our DETECT-AND-PING model — we only need to notice that new traffic
 * arrived within a reasonable window, not stream it in real time. (A
 * realtime Android foreground service holding a live relay socket is a
 * possible future upgrade; the manifest permissions for it already ship via
 * plugins/withForegroundService.js.)
 *
 * `defineTask` MUST run in the global scope on every app start so the task
 * is registered when the OS relaunches the app headlessly to run it — hence
 * the side-effect import of this module from index.ts.
 */
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { runBackgroundSync } from './backgroundSyncService';

export const BACKGROUND_SYNC_TASK = 'lp-relay-bg-sync';

// ~15 min is the Android WorkManager floor; iOS treats it as a hint.
const MINIMUM_INTERVAL_MINUTES = 15;

if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      await runBackgroundSync();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      if (__DEV__) console.warn('[backgroundTask] sync failed:', e);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Register the periodic background sync. Idempotent — safe to call on every
 * app foreground / login. No-op (logged) when the OS reports background
 * execution is unavailable (e.g. Low Power Mode, or the user disabled
 * Background App Refresh).
 */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      if (__DEV__)
        console.log('[backgroundTask] background execution restricted — not registering');
      return;
    }
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
  } catch (e) {
    if (__DEV__) console.warn('[backgroundTask] register failed:', e);
  }
}

/** Unregister the task (e.g. on full sign-out). Idempotent. */
export async function unregisterBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
  } catch (e) {
    if (__DEV__) console.warn('[backgroundTask] unregister failed:', e);
  }
}
