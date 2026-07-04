import { useCallback, startTransition } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { nip46Sign } from './nip46DmDecrypt';
import { NSEC_KEY } from './nostrAuthKeys';
import { perAccountKey } from '../services/perAccountStorage';
import { CONTACTS_CACHE_KEY_BASE, CONTACTS_TIMESTAMP_KEY_BASE } from './nostrCacheKeys';
import type { NostrContact, RelayConfig, SignerType } from '../types/nostr';

/**
 * The follow-list WRITE path (#779) — everything that mutates the user's
 * kind-3 contact list — pulled out of `NostrProvider` so the provider file
 * stays reviewable (file-size cap). This is the action half of the sibling
 * `NostrContactsContext`: `refreshContacts` / `followContact` /
 * `unfollowContact` / `addContact`, plus the private `publishContactList`
 * they all funnel through to sign + broadcast the updated kind-3.
 *
 * The `contacts` STATE itself still lives in the provider (it feeds
 * `followPubkeys` → the DM inbox), so this hook takes `contacts` +
 * `setContacts` as inputs and drives them; the relay-fetch `loadContacts`
 * loader is likewise owned by the provider (shared with the login paths)
 * and threaded in for `refreshContacts` to force-refresh through.
 */
export interface UseContactActionsParams {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  relays: RelayConfig[];
  contacts: NostrContact[];
  setContacts: React.Dispatch<React.SetStateAction<NostrContact[]>>;
  getReadRelays: () => string[];
  loadContacts: (pk: string, relayUrls: string[], opts?: { force?: boolean }) => Promise<void>;
}

export interface UseContactActionsResult {
  refreshContacts: () => Promise<void>;
  followContact: (pubkey: string) => Promise<boolean>;
  unfollowContact: (pubkey: string) => Promise<boolean>;
  addContact: (
    npubOrHex: string,
  ) => Promise<
    | { success: true; pubkey: string; alreadyFollowing?: boolean }
    | { success: false; error: string }
  >;
}

export function useContactActions({
  pubkey,
  isLoggedIn,
  signerType,
  relays,
  contacts,
  setContacts,
  getReadRelays,
  loadContacts,
}: UseContactActionsParams): UseContactActionsResult {
  const refreshContacts = useCallback(async () => {
    if (!pubkey) return;
    const readRelays = getReadRelays();
    // User-initiated refresh (e.g. pull-to-refresh) — bypass the 24h
    // contacts cache so newly-added follows surface immediately.
    await loadContacts(pubkey, readRelays, { force: true });
  }, [pubkey, getReadRelays, loadContacts]);

  const publishContactList = useCallback(
    async (updatedContacts: NostrContact[]): Promise<boolean> => {
      if (!pubkey || !isLoggedIn) return false;
      try {
        const event = nostrService.createContactListEvent(updatedContacts);
        const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
        const targetRelays = writeRelays.length > 0 ? writeRelays : nostrService.DEFAULT_RELAYS;

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return false;
          const { secretKey } = nostrService.decodeNsec(nsec);
          await nostrService.signAndPublishEvent(event, secretKey, targetRelays);
        } else if (signerType === 'amber') {
          const eventJson = JSON.stringify(event);
          const { event: signedEventJson } = await amberService.requestEventSignature(
            eventJson,
            '',
            pubkey,
          );
          if (!signedEventJson) return false;
          const signed = JSON.parse(signedEventJson);
          await nostrService.publishSignedEvent(signed, targetRelays);
        } else if (signerType === 'nip46') {
          const signedEventJson = await nip46Sign(event, pubkey);
          if (!signedEventJson) return false;
          await nostrService.publishSignedEvent(JSON.parse(signedEventJson), targetRelays);
        }
        return true;
      } catch (error) {
        console.warn('Failed to publish contact list:', error);
        return false;
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  const followContact = useCallback(
    async (contactPubkey: string): Promise<boolean> => {
      if (contacts.some((c) => c.pubkey === contactPubkey)) return true; // already following
      const newContact: NostrContact = {
        pubkey: contactPubkey,
        relay: null,
        petname: null,
        profile: null,
      };
      const updatedContacts = [...contacts, newContact];
      const success = await publishContactList(updatedContacts);
      if (success) {
        startTransition(() => setContacts(updatedContacts));
        // Update cache so restarts reflect the follow immediately.
        // Per-account namespaced (#288). Bumps the *contacts* timestamp
        // (the right freshness clock for kind-3 list reads) — pre-#442
        // code mistakenly wrote to CACHE_TIMESTAMP_KEY_BASE which is
        // the *profiles* cache freshness, leaving the contacts list's
        // own freshness clock stale after every follow.
        const cKey = perAccountKey(CONTACTS_CACHE_KEY_BASE, pubkey);
        const tKey = perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pubkey);
        AsyncStorage.setItem(cKey, JSON.stringify(updatedContacts)).catch(() => {});
        AsyncStorage.setItem(tKey, Date.now().toString()).catch(() => {});
        // Fetch profile for the new contact
        const readRelays = getReadRelays();
        const profileData = await nostrService.fetchProfile(contactPubkey, readRelays);
        if (profileData) {
          startTransition(() =>
            setContacts((prev) => {
              const updated = prev.map((c) =>
                c.pubkey === contactPubkey ? { ...c, profile: profileData } : c,
              );
              // Update cache with profile data
              AsyncStorage.setItem(cKey, JSON.stringify(updated)).catch(() => {});
              return updated;
            }),
          );
        }
      }
      return success;
    },
    [contacts, publishContactList, getReadRelays, pubkey, setContacts],
  );

  const unfollowContact = useCallback(
    async (contactPubkey: string): Promise<boolean> => {
      const updatedContacts = contacts.filter((c) => c.pubkey !== contactPubkey);
      const success = await publishContactList(updatedContacts);
      if (success) {
        startTransition(() => setContacts(updatedContacts));
        // Update cache so restarts reflect the unfollow immediately.
        // Per-account namespaced (#288).
        AsyncStorage.setItem(
          perAccountKey(CONTACTS_CACHE_KEY_BASE, pubkey),
          JSON.stringify(updatedContacts),
        ).catch(() => {});
        // Same fix as followContact above — bump the *contacts*
        // timestamp, not the *profiles* one.
        AsyncStorage.setItem(
          perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pubkey),
          Date.now().toString(),
        ).catch(() => {});
      }
      return success;
    },
    [contacts, publishContactList, pubkey, setContacts],
  );

  const addContact = useCallback(
    async (
      npubOrHex: string,
    ): Promise<
      | { success: true; pubkey: string; alreadyFollowing?: boolean }
      | { success: false; error: string }
    > => {
      try {
        let hex = npubOrHex.trim();
        // Strip nostr: URI prefix (NIP-21)
        if (hex.startsWith('nostr:')) {
          hex = hex.slice(6);
        }
        if (hex.startsWith('npub1')) {
          const decoded = nip19.decode(hex);
          if (decoded.type !== 'npub') return { success: false, error: 'Invalid npub' };
          hex = decoded.data;
        }
        if (!/^[0-9a-f]{64}$/i.test(hex)) {
          return { success: false, error: 'Invalid public key format' };
        }
        if (contacts.some((c) => c.pubkey === hex)) {
          // Already a follow — not a failure. Surface it as a neutral
          // "already connected" so the UI doesn't show a red error (#660).
          return { success: true, alreadyFollowing: true, pubkey: hex };
        }
        const success = await followContact(hex);
        return success
          ? { success: true, pubkey: hex }
          : { success: false, error: 'Failed to publish contact list' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Invalid key' };
      }
    },
    [contacts, followContact],
  );

  return { refreshContacts, followContact, unfollowContact, addContact };
}
