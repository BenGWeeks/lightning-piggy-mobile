/**
 * Persisted on/off preference for the Android background DM watch (#279
 * realtime upgrade). Split out from `backgroundDmService` so the Settings
 * screen can read/write the flag without importing the whole relay/decrypt
 * service graph (and so the service can read the flag on launch without a
 * circular import).
 *
 * Default OFF: the feature shows a persistent "watching for messages"
 * notification and keeps a relay socket alive, which costs battery — opt-in
 * only, and the Settings copy is honest about the trade-off.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKGROUND_DM_ENABLED_KEY = 'bg_dm_watch_enabled_v1';

let cached: boolean | null = null;

/** Read the persisted preference. Defaults to false (off) when unset. */
export async function loadBackgroundDmEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  const raw = await AsyncStorage.getItem(BACKGROUND_DM_ENABLED_KEY).catch(() => null);
  cached = raw === 'true';
  return cached;
}

/** Persist the preference. */
export async function setBackgroundDmEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  await AsyncStorage.setItem(BACKGROUND_DM_ENABLED_KEY, enabled ? 'true' : 'false').catch(() => {});
}

/** Test hook: drop the in-memory cache so tests don't poison each other. */
export function __resetForTests(): void {
  cached = null;
}
