import { useCallback, startTransition, type Dispatch, type SetStateAction } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { nip46Sign } from './nip46DmDecrypt';
import { NSEC_KEY } from './nostrAuthKeys';
import { perAccountKey } from '../services/perAccountStorage';
import { CONTACTS_CACHE_KEY_BASE, CONTACTS_TIMESTAMP_KEY_BASE } from './nostrCacheKeys';
import { prepareContactListUpdate, type ContactChange } from '../services/contactListSync';
import { Toast } from '../components/BrandedToast';
import { t } from '../i18n';
import type { NostrContact, RelayConfig, SignerType } from '../types/nostr';

/**
 * The follow-list WRITE path (#779) — everything that mutates the user's
 * kind-3 contact list — pulled out of `NostrProvider` so the provider file
 * stays reviewable (file-size cap). This is the action half of the sibling
 * `NostrContactsContext`: `refreshContacts` / `followContact` /
 * `unfollowContact` / `addContact`, plus the private `publishContactList`
 * they all funnel through to sign + broadcast the updated kind-3.
 *
 * Every write is a read-modify-write against the newest kind-3 on the
 * relays, never the in-memory `contacts` (#1271): see `contactListSync`.
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
  setContacts: Dispatch<SetStateAction<NostrContact[]>>;
  getReadRelays: () => string[];
  loadContacts: (
    pk: string,
    relayUrls: string[],
    opts?: { force?: boolean; awaitProfiles?: boolean },
  ) => Promise<void>;
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
    // contacts cache so newly-added follows surface immediately. Resolve
    // as soon as the (force-fetched) contact LIST is in state, without
    // blocking on the kind-0 profile batch: the caller's spinner should
    // clear in seconds, and avatars stream in progressively via the
    // profile batch's onBatch hook. This is what keeps pull-to-refresh
    // from hanging ~90s on a large follow list, while the follow-gate /
    // DM-inbox refresh (which only needs the contact list) still sees an
    // up-to-date follow set. (#852)
    await loadContacts(pubkey, readRelays, { force: true, awaitProfiles: false });
  }, [pubkey, getReadRelays, loadContacts]);

  const publishContactList = useCallback(
    async (event: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    }): Promise<boolean> => {
      if (!pubkey || !isLoggedIn) return false;
      try {
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
        } else {
          // No usable signer (null / unsupported): nothing was published, so
          // report failure. Returning true here would let the callers commit
          // the follow/unfollow to local state + cache while the kind-3 never
          // hit a relay, silently diverging the device from the network.
          console.warn('Failed to publish contact list: no active signer');
          return false;
        }
        return true;
      } catch (error) {
        console.warn('Failed to publish contact list:', error);
        return false;
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  // Fetch-merge-publish one follow/unfollow, then mirror the result into
  // state + the per-account cache (#288). Returns the new list, or null when
  // nothing was published (no kind-3 to build on, or the signer declined).
  const updateContactList = useCallback(
    async (change: ContactChange): Promise<NostrContact[] | null> => {
      if (!pubkey || !isLoggedIn) return null;
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const update = await prepareContactListUpdate({
        pubkey,
        relays: [...getReadRelays(), ...writeRelays, ...nostrService.DEFAULT_RELAYS],
        localContacts: contacts,
        change,
      });
      if (!update) {
        // Couldn't reach a relay copy and the local one is empty: publishing
        // now could replace the user's real follow list with one entry.
        Toast.show({ type: 'error', text1: t('followList.unavailable') });
        return null;
      }
      if (update.changed && !(await publishContactList(update.event))) return null;
      startTransition(() => setContacts(update.contacts));
      // Bumps the *contacts* timestamp (the freshness clock for kind-3 list
      // reads), not the profiles one (#442).
      AsyncStorage.setItem(
        perAccountKey(CONTACTS_CACHE_KEY_BASE, pubkey),
        JSON.stringify(update.contacts),
      ).catch(() => {});
      AsyncStorage.setItem(
        perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pubkey),
        Date.now().toString(),
      ).catch(() => {});
      return update.contacts;
    },
    [pubkey, isLoggedIn, relays, getReadRelays, contacts, publishContactList, setContacts],
  );

  const followContact = useCallback(
    async (contactPubkey: string): Promise<boolean> => {
      if (contacts.some((c) => c.pubkey === contactPubkey)) return true; // already following
      const updated = await updateContactList({ type: 'follow', pubkey: contactPubkey });
      if (!updated) return false;
      // Fetch the new contact's profile so the row gets a name + avatar.
      const profileData = await nostrService.fetchProfile(contactPubkey, getReadRelays());
      if (profileData) {
        const cKey = perAccountKey(CONTACTS_CACHE_KEY_BASE, pubkey);
        startTransition(() =>
          setContacts((prev) => {
            const next = prev.map((c) =>
              c.pubkey === contactPubkey ? { ...c, profile: profileData } : c,
            );
            AsyncStorage.setItem(cKey, JSON.stringify(next)).catch(() => {});
            return next;
          }),
        );
      }
      return true;
    },
    [contacts, updateContactList, getReadRelays, pubkey, setContacts],
  );

  const unfollowContact = useCallback(
    async (contactPubkey: string): Promise<boolean> =>
      (await updateContactList({ type: 'unfollow', pubkey: contactPubkey })) !== null,
    [updateContactList],
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
