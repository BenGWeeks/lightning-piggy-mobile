import * as SecureStore from 'expo-secure-store';

export const NSEC_KEY = 'nostr_nsec';
export const PUBKEY_KEY = 'nostr_pubkey';
export const SIGNER_TYPE_KEY = 'nostr_signer_type';

// Hardened write options for the legacy single-active-identity slots, which
// hold the nsec + persisted identity metadata. Matches the repo's existing
// sensitive-write pattern (identitiesStore.ts, walletStorageService.ts):
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY keeps the secret off iCloud/backup
// migration. Used by persistActiveIdentityKeys AND the login flows that write
// these keys directly.
export const LEGACY_IDENTITY_SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
