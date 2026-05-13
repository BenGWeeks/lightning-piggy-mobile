// Persistent settings for the web-of-trust cache/event/message filter.
// Single AsyncStorage key as JSON so future fields land here without proliferating keys.
//
// History: pre-#535 this stored a boolean `filterEnabled`. As of #535 the
// filter is a 3-tier picker (friends / fof / all). Old payloads with the
// boolean are migrated on load: `false` (off) → 'all', `true` (on) → 'friends'.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lp:wot-settings:v1';

// The 3 tiers from issue #535. Default 'friends' — only kind-3 follows pass.
// 'fof' adds friends-of-follows (one hop). 'all' disables the filter entirely.
// Wider tiers are secret-mode-gated at the UI level (see WebOfTrustBottomSheet),
// not at the storage layer — the persisted value still has to round-trip even
// when secret mode is later disabled.
export type WotTier = 'friends' | 'fof' | 'all';

export interface WotSettings {
  wotTier: WotTier;
}

const DEFAULTS: WotSettings = { wotTier: 'friends' };

// Mirror of trustGraphService's threat model: any payload we can't validate
// strictly should fall back to the safest tier ('friends'), not the widest.
const isWotTier = (v: unknown): v is WotTier => v === 'friends' || v === 'fof' || v === 'all';

export const loadWotSettings = async (): Promise<WotSettings> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // New shape — wotTier present and valid.
    if (parsed && typeof parsed === 'object' && isWotTier(parsed.wotTier)) {
      return { wotTier: parsed.wotTier };
    }
    // Legacy migration: pre-#535 stored `{ filterEnabled: boolean }`. Map
    // false → 'all' (filter explicitly off), true (or missing) → 'friends'.
    if (parsed && typeof parsed === 'object' && typeof parsed.filterEnabled === 'boolean') {
      return { wotTier: parsed.filterEnabled ? 'friends' : 'all' };
    }
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

export const saveWotSettings = async (settings: WotSettings): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort; in-memory state still drives the session.
  }
};
