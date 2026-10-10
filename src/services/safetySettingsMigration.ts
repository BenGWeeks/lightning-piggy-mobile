// One-time migration of the safety settings from device-wide keys to
// per-account keys. Several family members share one phone, so a change made
// by one person (confirm-large-sends threshold, who can message them, Secret
// Mode, link previews) must not silently apply to everyone else.
//
// For each legacy device key: copy its value into every existing account's
// namespace (only where that account has no value yet), THEN delete the device
// key. Idempotent and safe to interrupt — copies never overwrite, and the
// device key is removed last, so a crash mid-way just re-runs the remaining
// copies next launch. New accounts created afterwards find no device key and
// start from the safe defaults.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadIdentities } from './identitiesStore';
import { perAccountKey } from './perAccountStorage';

export const SEND_THRESHOLD_KEY_BASE = 'send_threshold_sats_v1';
export const WOT_SETTINGS_KEY_BASE = '@lp:wot-settings:v1';
export const SECRET_MODE_KEY_BASE = 'secret_mode';
export const LINK_PREVIEW_KEY_BASE = 'link_preview_enabled_v1';

/** Display prefs that are per account but whose device key lives on as the
 * "phone default" template for new accounts (see accountDisplayPrefs). */
export const TEMPLATE_PREF_BASES: readonly string[] = [
  'app_locale_preference',
  'user_fiat_currency',
];

/** Device-wide keys that are now stored per account (and deleted once copied). */
export const SAFETY_SETTING_BASES: readonly string[] = [
  SEND_THRESHOLD_KEY_BASE,
  WOT_SETTINGS_KEY_BASE,
  SECRET_MODE_KEY_BASE,
  LINK_PREVIEW_KEY_BASE,
];

/** Everything wiped for a signed-out account. */
export const PER_ACCOUNT_SETTING_BASES: readonly string[] = [
  ...SAFETY_SETTING_BASES,
  ...TEMPLATE_PREF_BASES,
];

/**
 * Copy each legacy device value to every account in `pubkeys`, then remove the
 * device key. A no-op for a key with no device value. With no accounts to copy
 * to, the device key is kept (nothing to preserve it into yet).
 */
export async function migrateSafetySettingsToPerAccount(pubkeys: readonly string[]): Promise<void> {
  const owners = Array.from(new Set(pubkeys.filter(Boolean)));
  if (owners.length === 0) return;
  for (const base of PER_ACCOUNT_SETTING_BASES) {
    const legacy = await AsyncStorage.getItem(base);
    if (legacy === null) continue;
    for (const owner of owners) {
      const key = perAccountKey(base, owner);
      if ((await AsyncStorage.getItem(key)) === null) await AsyncStorage.setItem(key, legacy);
    }
    // Template prefs keep their device key as the new-account default.
    if (!TEMPLATE_PREF_BASES.includes(base)) await AsyncStorage.removeItem(base);
  }
}

let inFlight: Promise<void> | null = null;
let done = false;

/**
 * Run the migration once per process against the identity registry plus
 * `extraPubkey` (the caller's account, in case the registry write races).
 * Every per-account getter/setter awaits this first so no read can observe a
 * half-migrated state. Failures are swallowed and retried on the next call.
 */
export function ensureSafetySettingsMigrated(extraPubkey?: string | null): Promise<void> {
  if (done) return Promise.resolve();
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const blob = await loadIdentities();
        const owners = blob.identities.map((i) => i.pubkey);
        if (extraPubkey) owners.push(extraPubkey);
        await migrateSafetySettingsToPerAccount(owners);
        done = owners.length > 0;
      } catch {
        // Retry next call; readers fall back to defaults meanwhile.
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

/** Test-only: forget that the migration ran. */
export function __resetSafetyMigrationForTests(): void {
  inFlight = null;
  done = false;
}
