/**
 * Developer switch: "Show device changes in chats" (#1267). When on, Marmot
 * chats draw local grey lines such as "Little Piggy · joined on 2 devices"
 * from the commits this device already processes. Nothing is ever sent.
 *
 * Alpha-only: deliberately departs from Marmot's "no device notices"
 * principle to make interop debugging visible. ON by default in dev and
 * preview builds, OFF in the store build. Revisit (flip the default or drop
 * the switch) when we leave alpha.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isProductionBuild } from '../utils/appEnvironment';

const KEY = 'device_notices_enabled_v1';

let cached: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

/** The default when the user hasn't chosen: on everywhere but the store build. */
export const defaultDeviceNoticesEnabled = (): boolean => !isProductionBuild();

export async function loadDeviceNoticesEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  cached = raw === null ? defaultDeviceNoticesEnabled() : raw === 'true';
  return cached;
}

export async function saveDeviceNoticesEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  for (const l of listeners) l(enabled);
  await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false').catch(() => {});
}

/** Told about every change made through `saveDeviceNoticesEnabled`. */
export function subscribeDeviceNoticesEnabled(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: drop the in-memory cache. */
export function __resetForTests(): void {
  cached = null;
}
