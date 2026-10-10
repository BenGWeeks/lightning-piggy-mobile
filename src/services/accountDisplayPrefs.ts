// Per-account language and fiat currency. Family members sharing one phone each
// keep their own; switching accounts applies the new account's values.
//
// A separate phone template supplies the first value for a new account.
// Snapshot that value once; later changes by other accounts cannot change it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import {
  ensureSafetySettingsMigrated,
  phoneTemplateKey,
  displayDefault,
} from './safetySettingsMigration';

export const LOCALE_PREF_KEY_BASE = 'app_locale_preference';
export const CURRENCY_PREF_KEY_BASE = 'user_fiat_currency';

// Sync mirror of what we've loaded/saved, so a switch to an already-seen account
// can render its value on the very first frame (no flash of a default).
const cache = new Map<string, string>();
const cacheId = (base: string, pubkey: string) => `${base}:${pubkey}`;

export function peekAccountPref(base: string, pubkey: string | null): string | null {
  return pubkey ? (cache.get(cacheId(base, pubkey)) ?? null) : null;
}

/** The account's own value, else the phone default, else null. */
export async function loadAccountPref(base: string, pubkey: string | null): Promise<string | null> {
  try {
    if (pubkey) {
      await ensureSafetySettingsMigrated(pubkey);
      const own = await AsyncStorage.getItem(perAccountKey(base, pubkey));
      if (own !== null) {
        cache.set(cacheId(base, pubkey), own);
        await AsyncStorage.setItem(phoneTemplateKey(base), own);
        return own;
      }
    }
    const value = (await AsyncStorage.getItem(phoneTemplateKey(base))) ?? displayDefault(base);
    if (pubkey) {
      await AsyncStorage.setItem(perAccountKey(base, pubkey), value);
      cache.set(cacheId(base, pubkey), value);
    }
    return value;
  } catch {
    return null;
  }
}

export async function saveAccountPref(
  base: string,
  value: string,
  pubkey: string | null,
): Promise<void> {
  if (pubkey) cache.set(cacheId(base, pubkey), value);
  try {
    if (pubkey) {
      await ensureSafetySettingsMigrated(pubkey);
      await AsyncStorage.setItem(perAccountKey(base, pubkey), value);
    }
    await AsyncStorage.setItem(phoneTemplateKey(base), value); // phone default for new accounts
  } catch {
    // Best-effort; in-memory state already took effect.
  }
}

export function forgetAccountPrefs(pubkey: string): void {
  for (const base of [LOCALE_PREF_KEY_BASE, CURRENCY_PREF_KEY_BASE]) {
    cache.delete(cacheId(base, pubkey));
  }
}

/** Test-only. */
export function __resetAccountPrefsForTests(): void {
  cache.clear();
}
