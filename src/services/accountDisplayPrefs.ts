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
import {
  __resetAccountSettingsCacheForTests,
  peekAccountSetting,
  rememberAccountSetting,
} from './accountSettingsCache';

export const LOCALE_PREF_KEY_BASE = 'app_locale_preference';
export const CURRENCY_PREF_KEY_BASE = 'user_fiat_currency';

// The sync mirror lives in `accountSettingsCache`: prewarmed for every
// registered account at startup, so a switch renders the destination
// account's value on the very first frame (no flash of a default).
//
// `revisions` counts saves per account+pref. A load captures it before its
// first await and drops its own writes if a save landed meanwhile, so a slow
// first load can never overwrite what the user just picked.
const revisions = new Map<string, number>();
const revisionId = (base: string, pubkey: string) => `${base}:${pubkey}`;
const revisionOf = (base: string, pubkey: string) => revisions.get(revisionId(base, pubkey)) ?? 0;

export function peekAccountPref(base: string, pubkey: string | null): string | null {
  return peekAccountSetting(base, pubkey) ?? null;
}

/** The account's own value, else the phone default, else null. */
export async function loadAccountPref(base: string, pubkey: string | null): Promise<string | null> {
  const revision = pubkey ? revisionOf(base, pubkey) : 0;
  const superseded = () => !!pubkey && revisionOf(base, pubkey) !== revision;
  try {
    if (pubkey) {
      await ensureSafetySettingsMigrated(pubkey);
      const own = await AsyncStorage.getItem(perAccountKey(base, pubkey));
      if (superseded()) return peekAccountPref(base, pubkey);
      if (own !== null) {
        rememberAccountSetting(base, pubkey, own);
        await AsyncStorage.setItem(phoneTemplateKey(base), own);
        return own;
      }
    }
    const value = (await AsyncStorage.getItem(phoneTemplateKey(base))) ?? displayDefault(base);
    if (pubkey) {
      // Checked synchronously before the write is queued: a save that lands
      // after this point queues its own write behind ours, so it still wins.
      if (superseded()) return peekAccountPref(base, pubkey);
      rememberAccountSetting(base, pubkey, value);
      await AsyncStorage.setItem(perAccountKey(base, pubkey), value);
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
  if (pubkey) {
    revisions.set(revisionId(base, pubkey), revisionOf(base, pubkey) + 1);
    rememberAccountSetting(base, pubkey, value);
  }
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

/** Test-only. */
export function __resetAccountPrefsForTests(): void {
  revisions.clear();
  __resetAccountSettingsCacheForTests();
}
