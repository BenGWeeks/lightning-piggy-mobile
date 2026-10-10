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
// start from the safe defaults. A persisted flag stops it re-running once it
// has completed against a readable, non-empty identity registry.
//
// Every launch also PREWARMS `accountSettingsCache` for every registered
// account (one multiGet), so the first switch after a cold start renders the
// destination account's trust tier, language and currency on the first frame.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadIdentities } from './identitiesStore';
import { perAccountKey } from './perAccountStorage';
import { rememberAccountSettingIfUnknown } from './accountSettingsCache';

export const SEND_THRESHOLD_KEY_BASE = 'send_threshold_sats_v1';
export const WOT_SETTINGS_KEY_BASE = '@lp:wot-settings:v1';
export const SECRET_MODE_KEY_BASE = 'secret_mode';
export const LINK_PREVIEW_KEY_BASE = 'link_preview_enabled_v1';

/** Display preferences retain a separate template for new accounts. */
export const TEMPLATE_PREF_BASES: readonly string[] = [
  'app_locale_preference',
  'user_fiat_currency',
];

export const phoneTemplateKey = (base: string): string => `phone_template:${base}`;
export const displayDefault = (base: string): string =>
  base === 'app_locale_preference' ? 'system' : 'USD';

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

/** Settings mirrored synchronously for every registered account (see header). */
export const PREWARMED_SETTING_BASES: readonly string[] = [
  WOT_SETTINGS_KEY_BASE,
  ...TEMPLATE_PREF_BASES,
];

export const SAFETY_MIGRATION_DONE_KEY = 'safety_settings_per_account_migrated_v1';

/**
 * Copy each legacy device value to every account in `pubkeys`, then remove the
 * device key. A no-op for a key with no device value. With no accounts to copy
 * to, the device key is kept (nothing to preserve it into yet). Pass
 * `deleteLegacy: false` to copy without deleting — used when the identity
 * registry is empty, so accounts we can't see yet still inherit the old value
 * on a later run instead of falling back to the (wider) defaults.
 */
export async function migrateSafetySettingsToPerAccount(
  pubkeys: readonly string[],
  { deleteLegacy = true }: { deleteLegacy?: boolean } = {},
): Promise<void> {
  const owners = Array.from(new Set(pubkeys.filter(Boolean)));
  if (owners.length === 0) return;
  // Preserve the pre-rename Secret Mode value before fanning it out.
  const oldSecret = await AsyncStorage.getItem('dev_mode');
  if (oldSecret !== null && (await AsyncStorage.getItem(SECRET_MODE_KEY_BASE)) === null) {
    await AsyncStorage.setItem(SECRET_MODE_KEY_BASE, oldSecret);
  }
  for (const base of PER_ACCOUNT_SETTING_BASES) {
    const legacy = await AsyncStorage.getItem(base);
    const isDisplay = TEMPLATE_PREF_BASES.includes(base);
    if (legacy === null && !isDisplay) continue;
    const value =
      legacy ?? (await AsyncStorage.getItem(phoneTemplateKey(base))) ?? displayDefault(base);
    for (const owner of owners) {
      const key = perAccountKey(base, owner);
      if ((await AsyncStorage.getItem(key)) === null) await AsyncStorage.setItem(key, value);
    }
    if (isDisplay && (await AsyncStorage.getItem(phoneTemplateKey(base))) === null) {
      await AsyncStorage.setItem(phoneTemplateKey(base), value);
    }
    if (!deleteLegacy) continue;
    if (base === SECRET_MODE_KEY_BASE) await AsyncStorage.removeItem('dev_mode');
    await AsyncStorage.removeItem(base);
  }
}

/** Load every account's prewarmed settings into the sync cache in one read. */
async function prewarmAccountSettings(owners: readonly string[]): Promise<void> {
  const pairs = owners.flatMap((owner) =>
    PREWARMED_SETTING_BASES.map((base) => ({ owner, base, key: perAccountKey(base, owner) })),
  );
  if (pairs.length === 0) return;
  const rows = await AsyncStorage.multiGet(pairs.map((p) => p.key));
  const byKey = new Map(rows);
  for (const { owner, base, key } of pairs) {
    rememberAccountSettingIfUnknown(base, owner, byKey.get(key) ?? null);
  }
}

let inFlight: Promise<void> | null = null;
let done = false;

/**
 * Run the migration once per process against the identity registry plus
 * `extraPubkey` (the caller's account, in case the registry write races),
 * then prewarm the settings cache. Every per-account getter/setter awaits
 * this first so no read can observe a half-migrated state. Failures reject
 * and are retried on the next call.
 */
export function ensureSafetySettingsMigrated(extraPubkey?: string | null): Promise<void> {
  if (done) return Promise.resolve();
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const blob = await loadIdentities();
        const registered = blob.identities.map((i) => i.pubkey);
        const owners = extraPubkey ? [...registered, extraPubkey] : [...registered];
        if ((await AsyncStorage.getItem(SAFETY_MIGRATION_DONE_KEY)) !== 'true') {
          // An empty registry (pre-registry install, or a registry write that
          // hasn't landed yet) can't tell us who else shares the phone: copy
          // to the caller only, keep the device keys, and retry next launch.
          const complete = registered.length > 0;
          await migrateSafetySettingsToPerAccount(owners, { deleteLegacy: complete });
          if (complete) await AsyncStorage.setItem(SAFETY_MIGRATION_DONE_KEY, 'true');
        }
        // Best-effort: a failed prewarm only costs the instant first frame.
        await prewarmAccountSettings(owners).catch(() => {});
        done = owners.length > 0;
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
