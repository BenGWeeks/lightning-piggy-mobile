/**
 * Per-account AsyncStorage key helpers + the global key list that
 * `migrateToPerAccountStorage` consults. Keeping this in one file
 * makes it easy to audit which keys are account-scoped vs device-
 * scoped and to drop the migration in 6 months without chasing
 * inline key constants.
 */

/**
 * Append `_${pubkey}` to the base key. Returns the global key when
 * pubkey is null/empty so the caller still has a sane (non-throwing)
 * value during the brief moment between provider mount and identity
 * hydration.
 */
export function perAccountKey(baseKey: string, pubkey: string | null | undefined): string {
  if (!pubkey) return baseKey;
  return `${baseKey}_${pubkey}`;
}

/**
 * Bases that get migrated from `${base}` → `${base}_${activePubkey}` on
 * first launch with multi-account enabled. Order doesn't matter; each
 * migration step is its own AsyncStorage round-trip and an idempotent
 * write+read pair.
 *
 * IMPORTANT: any key listed here MUST be read+written through
 * `perAccountKey(...)` at the call site, OR it will silently fall back
 * to the legacy global value forever.
 */
export const PER_ACCOUNT_STORAGE_BASES: readonly string[] = [
  // Groups list (kind-30200 hydration cache)
  'nostr_groups',
  // GroupsScreen "following only" toggle
  'groups_following_only',
  // Wallet metadata list — wallets become per-account in multi-account
  'wallet_list',
  // Nostr social-graph caches
  'nostr_contacts_cache',
  'nostr_contacts_timestamp',
  'nostr_profiles_cache',
  'nostr_cache_timestamp',
  'nostr_own_profile_cache',
  'nostr_own_profile_timestamp',
  'nostr_relay_list_cache',
  'nostr_relay_list_timestamp',
  // NIP-17 wrap cache (per signer-type)
  'amber_nip17_cache_v1',
  'amber_nip17_enabled',
  'nsec_nip17_cache_v1',
] as const;

/**
 * Bases NOT in the list above that are intentionally global today
 * (documented here so a future audit doesn't accidentally namespace
 * them):
 *   - electrum_server, blossom_server  → device-level config
 *   - app_theme_preference             → UI preference
 *   - dev_mode                         → debug toggle
 *   - learn_progress                   → user-level (not identity-level)
 *   - messages_window_days             → UI preference
 *   - onboarding_complete              → device-level
 *   - storage_migration_version        → migration tracker
 *   - team_profile_cache               → static data
 *   - zap_counterparties_v1            → device-wide LRU optimisation
 *   - contact_lightning_map            → derived from public profiles
 *   - boltz_swap_*, submarine_swap_*   → keyed by random swap id
 *   - txs_${walletId}                  → keyed by wallet id (which IS
 *                                        per-account once wallet_list
 *                                        is namespaced)
 *   - nostr_dm_inbox_v1_*, *_last_seen_v1_*, nostr_dm_conv_v1_*  →
 *     ALREADY namespaced inline (key embeds pubkey via inboxCacheKey
 *     / convCacheKey in NostrContext.tsx)
 *   - nostr_group_activity_${pubkey}   → ALREADY namespaced
 *   - group_messages_${groupId}        → keyed by random group id
 */
