import { requireOptionalNativeModule, Platform } from 'expo-modules-core';

/**
 * JS face of the native BackgroundDmService Expo module (#279 realtime
 * upgrade). Exposes start/stop for the Android persistent foreground service
 * that hosts the headless DM-watch task.
 *
 * `requireOptionalNativeModule` (not `requireNativeModule`) so that a JS
 * bundle running against a binary that predates this native module — e.g. an
 * Expo Go session, or a dev client built before the prebuild — degrades to a
 * no-op instead of throwing at import time. The control layer already guards
 * on Platform.OS === 'android'; this adds a second guard for "native module
 * not present in this build".
 */
interface BackgroundDmNativeModule {
  startService(): Promise<void>;
  stopService(): Promise<void>;
}

const nativeModule =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<BackgroundDmNativeModule>('BackgroundDmService')
    : null;

/** True when the native foreground-service module is available in this build. */
export function isBackgroundDmServiceAvailable(): boolean {
  return nativeModule != null;
}

/**
 * Start the native Android foreground service (which spins up the headless JS
 * watch task). No-op when not Android or the native module isn't present.
 */
export async function startForegroundService(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.startService();
}

/** Stop the native Android foreground service. No-op when unavailable. */
export async function stopForegroundService(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.stopService();
}
