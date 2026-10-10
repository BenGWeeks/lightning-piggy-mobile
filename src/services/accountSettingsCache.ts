// Synchronous mirror of per-account settings that must be right on the very
// first frame after an account switch (trust tier, language, currency).
//
// Filled for EVERY account in the identity registry at startup (prewarm in
// `safetySettingsMigration`), then kept current by each setting's own
// load/save. Readers `peek` during render: `undefined` means "not known yet"
// (the caller must stay in its safe/gated state), `null` means "known: this
// account has no stored value".
//
// Deliberately import-free so the migration, the display prefs and the WoT
// service can all share it without a module cycle.

const values = new Map<string, Map<string, string | null>>();

export function peekAccountSetting(base: string, pubkey: string | null): string | null | undefined {
  return pubkey ? values.get(pubkey)?.get(base) : undefined;
}

export function rememberAccountSetting(base: string, pubkey: string, value: string | null): void {
  let forAccount = values.get(pubkey);
  if (!forAccount) {
    forAccount = new Map();
    values.set(pubkey, forAccount);
  }
  forAccount.set(base, value);
}

/** Prewarm write: never replaces a value a load/save already recorded. */
export function rememberAccountSettingIfUnknown(
  base: string,
  pubkey: string,
  value: string | null,
): void {
  if (peekAccountSetting(base, pubkey) === undefined) rememberAccountSetting(base, pubkey, value);
}

/** Sign-out: drop everything mirrored for this account. */
export function forgetAccountSettings(pubkey: string): void {
  values.delete(pubkey);
}

/** Test-only. */
export function __resetAccountSettingsCacheForTests(): void {
  values.clear();
}
