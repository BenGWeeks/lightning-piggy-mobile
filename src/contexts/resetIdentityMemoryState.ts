import { useCallback } from 'react';
import type { NostrContact, NostrProfile } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { stopNativeDmEngineGlobal } from './nativeDmEngine';
import { clearMemoisedSecretKey, nip04PlaintextCache } from './nostrSecretKeyCache';

export interface IdentityMemoryState {
  setProfile: (profile: NostrProfile | null) => void;
  setContacts: (contacts: NostrContact[]) => void;
  setDmInbox: (entries: DmInboxEntry[]) => void;
  setAmberNip44Permission: (permission: 'unknown') => void;
  /** Resets the NIP-65 slice only — user-added relay overrides are an in-app
   * preference shared across identities. */
  resetRelayLists: () => void;
}

/**
 * Forget the outgoing identity's key material: the memoised secret, the
 * native engine's parsed key (Stage 2 M2 belt-and-braces — the live sub's
 * teardown stops its own handle, but a rust-nostr pool must never outlive its
 * account), and the NIP-04 plaintext cache.
 */
export function dropIdentityKeyMaterial(): void {
  clearMemoisedSecretKey();
  void stopNativeDmEngineGlobal();
  nip04PlaintextCache.clear();
}

/**
 * Drop the outgoing identity's in-memory state (key material, own profile,
 * follows, relay lists, DM inbox) before another identity becomes active —
 * on a switch, and when a login adds a second account while one is already
 * active. Persistent caches are per-account namespaced and stay on disk, so
 * switching back is instant.
 */
export function resetIdentityMemoryState(state: IdentityMemoryState): void {
  dropIdentityKeyMaterial();
  state.setAmberNip44Permission('unknown');
  state.setProfile(null);
  state.setContacts([]);
  state.resetRelayLists();
  state.setDmInbox([]);
}

/**
 * `resetIdentityMemory` for the provider's switch flow, plus the setter its
 * logins activate a pubkey through: adding an account while another is active
 * must drop the previous identity's in-memory state first (the login paths
 * used to flip the pubkey and leave the old profile, follows, relays and
 * inbox showing under the new account).
 */
export function useIdentityMemoryReset(
  pubkey: string | null,
  setPubkey: (pubkey: string | null) => void,
  state: IdentityMemoryState,
): { resetIdentityMemory: () => void; activateLoginPubkey: (pubkey: string | null) => void } {
  const { setProfile, setContacts, setDmInbox, setAmberNip44Permission, resetRelayLists } = state;
  const resetIdentityMemory = useCallback(
    () =>
      resetIdentityMemoryState({
        setProfile,
        setContacts,
        setDmInbox,
        setAmberNip44Permission,
        resetRelayLists,
      }),
    [setProfile, setContacts, setDmInbox, setAmberNip44Permission, resetRelayLists],
  );
  const activateLoginPubkey = useCallback(
    (next: string | null) => {
      if (next && pubkey && next !== pubkey) resetIdentityMemory();
      setPubkey(next);
    },
    [pubkey, setPubkey, resetIdentityMemory],
  );
  return { resetIdentityMemory, activateLoginPubkey };
}
