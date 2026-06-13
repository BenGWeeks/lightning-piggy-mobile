import * as SecureStore from 'expo-secure-store';
import type { StoredIdentity } from '../services/identitiesStore';
import { NSEC_KEY, PUBKEY_KEY, SIGNER_TYPE_KEY } from './nostrAuthKeys';

// Promote one registered identity into the legacy single-identity SecureStore
// slots (`SIGNER_TYPE_KEY` + either `NSEC_KEY` or `PUBKEY_KEY`) so a hard
// restart resumes on it. Shared by `switchIdentity` and the logout-with-
// successor path in NostrContext — both flip the active identity and must
// leave the same persisted state, so the write lives in one place.
//
// For nsec we write the secret and clear the stale amber pubkey slot; for
// amber we write the pubkey and clear the stale nsec. The two flows differ
// only in whether they pre-clear the OTHER slot (switchIdentity does, the
// logout successor path historically did not — `clearOtherSlot` preserves
// that), so behaviour stays byte-for-byte identical post-extraction.
export async function persistActiveIdentityKeys(
  identity: Pick<StoredIdentity, 'pubkey' | 'signerType' | 'nsec'>,
  opts: { clearOtherSlot?: boolean } = {},
): Promise<void> {
  const clearOtherSlot = opts.clearOtherSlot === true;
  await SecureStore.setItemAsync(SIGNER_TYPE_KEY, identity.signerType);
  if (identity.signerType === 'nsec' && identity.nsec) {
    await SecureStore.setItemAsync(NSEC_KEY, identity.nsec);
    if (clearOtherSlot) await SecureStore.deleteItemAsync(PUBKEY_KEY);
  } else if (identity.signerType === 'amber') {
    await SecureStore.setItemAsync(PUBKEY_KEY, identity.pubkey);
    if (clearOtherSlot) await SecureStore.deleteItemAsync(NSEC_KEY);
  }
}
