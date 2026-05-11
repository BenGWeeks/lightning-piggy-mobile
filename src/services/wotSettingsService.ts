/**
 * Persistent settings for the web-of-trust cache/event filter.
 * The key piece of data is whether the filter is on; it defaults
 * ON for safety (see `trustGraphService` for the threat model).
 *
 * Stored under a single AsyncStorage key as JSON so future additions
 * (e.g. "include L2 friends-of-friends") have a place to land
 * without proliferating keys.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lp:wot-settings:v1';

export interface WotSettings {
  /** Filter caches/events to only those from pubkeys in the trust set.
   * Default true. Turning this off is a deliberate, warned action. */
  filterEnabled: boolean;
}

const DEFAULTS: WotSettings = { filterEnabled: true };

export const loadWotSettings = async (): Promise<WotSettings> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Per-field type validation — corrupted-but-JSON storage (e.g.
    // `{ "filterEnabled": "false" }`) would otherwise flow a non-
    // boolean through TrustGraphContext and silently flip the safety
    // filter. Treat anything that isn't strictly `boolean` as missing
    // and fall back to DEFAULTS (Copilot review on PR #488).
    const filterEnabled =
      typeof parsed?.filterEnabled === 'boolean' ? parsed.filterEnabled : DEFAULTS.filterEnabled;
    return { filterEnabled };
  } catch {
    return DEFAULTS;
  }
};

export const saveWotSettings = async (settings: WotSettings): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort; the in-memory state still drives the session.
  }
};
