import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  startTransition,
} from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { NostrProfile, NostrContact, RelayConfig, SignerType } from '../types/nostr';

const NSEC_KEY = 'nostr_nsec';
const PUBKEY_KEY = 'nostr_pubkey';
const SIGNER_TYPE_KEY = 'nostr_signer_type';
const CONTACTS_CACHE_KEY = 'nostr_contacts_cache';
const PROFILES_CACHE_KEY = 'nostr_profiles_cache';
const CACHE_TIMESTAMP_KEY = 'nostr_cache_timestamp';
const CONTACTS_TIMESTAMP_KEY = 'nostr_contacts_timestamp';
const OWN_PROFILE_CACHE_KEY = 'nostr_own_profile_cache';
const OWN_PROFILE_TIMESTAMP_KEY = 'nostr_own_profile_timestamp';
const RELAY_LIST_CACHE_KEY = 'nostr_relay_list_cache';
const RELAY_LIST_TIMESTAMP_KEY = 'nostr_relay_list_timestamp';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Read a JSON-serialised cache value and its timestamp in a single
 * `multiGet` call. Returns the parsed value (or null if missing / corrupt)
 * and the cache age in ms (Infinity when no timestamp exists yet).
 */
async function readCachedWithTtl<T>(
  dataKey: string,
  tsKey: string,
): Promise<{ value: T | null; ageMs: number }> {
  try {
    const pairs = await AsyncStorage.multiGet([dataKey, tsKey]);
    let dataStr: string | null = null;
    let tsStr: string | null = null;
    for (const [k, v] of pairs) {
      if (k === dataKey) dataStr = v;
      else if (k === tsKey) tsStr = v;
    }
    const value = dataStr ? (JSON.parse(dataStr) as T) : null;
    const ageMs = tsStr ? Date.now() - parseInt(tsStr, 10) : Infinity;
    return { value, ageMs };
  } catch {
    return { value: null, ageMs: Infinity };
  }
}

interface NostrContextType {
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  profile: NostrProfile | null;
  contacts: NostrContact[];
  relays: RelayConfig[];
  signerType: SignerType | null;
  loginWithNsec: (nsec: string) => Promise<{ success: boolean; error?: string }>;
  loginWithAmber: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshContacts: () => Promise<void>;
  signZapRequest: (
    recipientPubkey: string,
    amountSats: number,
    comment: string,
  ) => Promise<string | null>;
  publishProfile: (profileData: {
    name?: string;
    display_name?: string;
    picture?: string;
    banner?: string;
    about?: string;
    lud16?: string;
    nip05?: string;
  }) => Promise<boolean>;
  followContact: (pubkey: string) => Promise<boolean>;
  unfollowContact: (pubkey: string) => Promise<boolean>;
  addContact: (npubOrHex: string) => Promise<{ success: boolean; error?: string }>;
  sendDirectMessage: (
    recipientPubkey: string,
    plaintext: string,
  ) => Promise<{ success: boolean; error?: string }>;
  fetchConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<SignedEvent | null>;
}

export interface SignedEvent {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface ConversationMessage {
  id: string;
  fromMe: boolean;
  text: string;
  createdAt: number;
}

const NostrContext = createContext<NostrContextType | undefined>(undefined);

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [contacts, setContacts] = useState<NostrContact[]>([]);
  const [relays, setRelays] = useState<RelayConfig[]>([]);
  const [signerType, setSignerType] = useState<SignerType | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);

  // Publish the logged-in pubkey through the nostrService module so
  // non-React consumers (e.g. WalletContext's zap sender resolver) can
  // read it without introducing a circular provider dependency.
  useEffect(() => {
    nostrService.setCurrentUserPubkey(pubkey);
  }, [pubkey]);

  useEffect(() => {
    // Publish read relays so zap-receipt queries from WalletContext hit
    // the user's configured relays in addition to the app-level defaults.
    const read = relays.filter((r) => r.read).map((r) => r.url);
    nostrService.setCurrentUserReadRelays(read);
  }, [relays]);

  const getReadRelays = useCallback((): string[] => {
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, [relays]);

  const loadProfile = useCallback(async (pk: string, relayUrls: string[]) => {
    const t0 = Date.now();
    // Cache-fresh fast path: hydrate UI from cache and skip the relay RTT.
    const { value: cached, ageMs } = await readCachedWithTtl<NostrProfile>(
      OWN_PROFILE_CACHE_KEY,
      OWN_PROFILE_TIMESTAMP_KEY,
    );
    if (cached && ageMs < CACHE_MAX_AGE_MS) {
      setProfile(cached);
      if (__DEV__) console.log(`[Nostr] fetchProfile: skipped (cache fresh)`);
      return;
    }
    const fetchedProfile = await nostrService.fetchProfile(pk, relayUrls);
    if (__DEV__) console.log(`[Nostr] fetchProfile: ${Date.now() - t0}ms`);
    if (fetchedProfile) {
      setProfile(fetchedProfile);
      InteractionManager.runAfterInteractions(() => {
        AsyncStorage.setItem(OWN_PROFILE_CACHE_KEY, JSON.stringify(fetchedProfile)).catch(() => {});
        AsyncStorage.setItem(OWN_PROFILE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
      });
    }
  }, []);

  const loadContactsFromCache = useCallback(async () => {
    try {
      const t0 = Date.now();
      // One multiGet round-trip for all three caches. Contacts freshness
      // is gated by CONTACTS_TIMESTAMP_KEY (the contact-list's own write
      // time), not the profiles timestamp — they get separate keys so a
      // successful contact refresh isn't blocked by an unrelated profiles
      // cache entry.
      const pairs = await AsyncStorage.multiGet([
        CONTACTS_CACHE_KEY,
        PROFILES_CACHE_KEY,
        CONTACTS_TIMESTAMP_KEY,
      ]);
      let contactsJson: string | null = null;
      let profilesJson: string | null = null;
      let contactsTsStr: string | null = null;
      for (const [k, v] of pairs) {
        if (k === CONTACTS_CACHE_KEY) contactsJson = v;
        else if (k === PROFILES_CACHE_KEY) profilesJson = v;
        else if (k === CONTACTS_TIMESTAMP_KEY) contactsTsStr = v;
      }
      if (contactsTsStr && Date.now() - parseInt(contactsTsStr, 10) > CACHE_MAX_AGE_MS) {
        if (__DEV__) console.log('[Nostr] contacts cache expired, skipping');
        return false;
      }
      if (contactsJson) {
        const cached: NostrContact[] = JSON.parse(contactsJson);
        if (profilesJson) {
          const profileMap: Record<string, NostrProfile> = JSON.parse(profilesJson);
          const withProfiles = cached.map((c) => ({
            ...c,
            profile: profileMap[c.pubkey] ?? c.profile,
          }));
          startTransition(() => setContacts(withProfiles));
          if (__DEV__)
            console.log(
              `[Nostr] loaded ${withProfiles.length} contacts from cache in ${Date.now() - t0}ms`,
            );
        } else {
          startTransition(() => setContacts(cached));
          if (__DEV__)
            console.log(
              `[Nostr] loaded ${cached.length} contacts (no profiles) from cache in ${Date.now() - t0}ms`,
            );
        }
        return true;
      }
    } catch (error) {
      console.warn('Failed to load contacts cache:', error);
    }
    return false;
  }, []);

  const loadContacts = useCallback(async (pk: string, relayUrls: string[]) => {
    const t0 = Date.now();

    // Read the contact-list cache AND profile cache concurrently — both
    // are independent AsyncStorage round-trips, and the profile cache is
    // also used for merging into whichever contact list we end up with.
    const [
      { value: cachedContacts, ageMs: contactsAgeMs },
      { value: cachedProfileMapOrNull, ageMs: cacheAgeMs },
    ] = await Promise.all([
      readCachedWithTtl<NostrContact[]>(CONTACTS_CACHE_KEY, CONTACTS_TIMESTAMP_KEY),
      readCachedWithTtl<Record<string, NostrProfile>>(PROFILES_CACHE_KEY, CACHE_TIMESTAMP_KEY),
    ]);
    const cachedProfileMap = cachedProfileMapOrNull ?? {};
    const contactsCacheFresh = contactsAgeMs < CACHE_MAX_AGE_MS;
    const cacheFresh = cacheAgeMs < CACHE_MAX_AGE_MS;

    let fetchedContacts: NostrContact[];
    if (contactsCacheFresh && cachedContacts) {
      fetchedContacts = cachedContacts;
      if (__DEV__)
        console.log(
          `[Nostr] fetchContactList: skipped (cache fresh @ ${Math.round(contactsAgeMs / 1000)}s old, ${fetchedContacts.length} contacts)`,
        );
    } else {
      fetchedContacts = await nostrService.fetchContactList(pk, relayUrls);
      if (__DEV__)
        console.log(
          `[Nostr] fetchContactList: ${Date.now() - t0}ms, ${fetchedContacts.length} contacts`,
        );
      InteractionManager.runAfterInteractions(() => {
        AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(fetchedContacts)).catch(() => {});
        AsyncStorage.setItem(CONTACTS_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
      });
    }

    startTransition(() =>
      setContacts(
        fetchedContacts.map((c) => ({
          ...c,
          profile: cachedProfileMap[c.pubkey] ?? c.profile,
        })),
      ),
    );

    if (fetchedContacts.length === 0) return;

    const missingFromCache = fetchedContacts
      .map((c) => c.pubkey)
      .filter((pk) => !cachedProfileMap[pk]);

    // Fast path: cache is fresh *and* covers every current contact. Avatars
    // are already hydrated from cache above, so skip the 30-40s batch.
    if (cacheFresh && missingFromCache.length === 0) {
      if (__DEV__)
        console.log(
          `[Nostr] fetchProfiles: skipped (cache fresh @ ${Math.round(cacheAgeMs / 1000)}s old, all ${fetchedContacts.length} contacts cached)`,
        );
      return;
    }

    // When the cache is fresh, the "missing" contacts are the ones who had
    // no kind-0 response last time we asked. Re-querying on every cold
    // start costs 3s for contacts that probably just never published a
    // profile. Wait until the TTL expires before retrying them.
    if (cacheFresh) {
      if (__DEV__)
        console.log(
          `[Nostr] fetchProfiles: skipped (cache fresh, ${missingFromCache.length} unknown profiles will retry after TTL)`,
        );
      return;
    }

    // Cache stale — refresh all contacts' profiles. (When cacheFresh is
    // true we've already returned via one of the two fast paths above, so
    // the dropped "X served from cache" suffix would always be 0.)
    const pubkeysToFetch = fetchedContacts.map((c) => c.pubkey);
    const t1 = Date.now();
    const profileMap = await nostrService.fetchProfiles(pubkeysToFetch, relayUrls, (partial) => {
      // Update UI incrementally as each batch of profiles arrives
      startTransition(() =>
        setContacts((prev) =>
          prev.map((c) => ({
            ...c,
            profile: partial.get(c.pubkey) ?? c.profile,
          })),
        ),
      );
    });
    if (__DEV__)
      console.log(
        `[Nostr] fetchProfiles: ${Date.now() - t1}ms, ${profileMap.size}/${pubkeysToFetch.length} profiles loaded`,
      );

    // Merge new profiles on top of existing cache so we don't lose
    // previously-known profiles for contacts we didn't refetch.
    InteractionManager.runAfterInteractions(() => {
      const merged: Record<string, NostrProfile> = { ...cachedProfileMap };
      profileMap.forEach((v, k) => {
        merged[k] = v;
      });
      AsyncStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(merged)).catch(() => {});
      AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
    });
  }, []);

  const loadRelays = useCallback(async (pk: string): Promise<string[]> => {
    const t0 = Date.now();
    // Cache-fresh fast path — NIP-65 relay lists rarely change, so serve
    // from cache when under the TTL and skip the ~3s relay round trip.
    const { value: cached, ageMs } = await readCachedWithTtl<RelayConfig[]>(
      RELAY_LIST_CACHE_KEY,
      RELAY_LIST_TIMESTAMP_KEY,
    );
    if (cached && ageMs < CACHE_MAX_AGE_MS) {
      setRelays(cached);
      if (__DEV__) console.log(`[Nostr] fetchRelayList: skipped (cache fresh)`);
      const readRelays = cached.filter((r) => r.read).map((r) => r.url);
      return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
    }
    const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
    if (__DEV__)
      console.log(`[Nostr] fetchRelayList: ${Date.now() - t0}ms, ${relayList.length} relays`);
    setRelays(relayList);
    InteractionManager.runAfterInteractions(() => {
      AsyncStorage.setItem(RELAY_LIST_CACHE_KEY, JSON.stringify(relayList)).catch(() => {});
      AsyncStorage.setItem(RELAY_LIST_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
    });
    const readRelays = relayList.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, []);

  // Auto-login on startup: load cache immediately, refresh from relays in background
  useEffect(() => {
    (async () => {
      try {
        const storedSignerType = await SecureStore.getItemAsync(SIGNER_TYPE_KEY);
        let pk: string | null = null;

        if (storedSignerType === 'nsec') {
          const storedNsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (storedNsec) {
            pk = nostrService.decodeNsec(storedNsec).pubkey;
            setPubkey(pk);
            setSignerType('nsec');
            setIsLoggedIn(true);
          }
        } else if (storedSignerType === 'amber') {
          const storedPubkey = await SecureStore.getItemAsync(PUBKEY_KEY);
          if (storedPubkey) {
            pk = storedPubkey;
            setPubkey(pk);
            setSignerType('amber');
            setIsLoggedIn(true);
          }
        }

        if (!pk) return;

        // Load cached contacts immediately (no network, <100ms)
        await loadContactsFromCache();

        // Defer relay fetches until after animations/rendering complete.
        // Seed the working relay set from the cached NIP-65 relay list so
        // `loadProfile` / `loadContacts` hit the relays the user actually
        // publishes to — not `DEFAULT_RELAYS`, which might miss their
        // kind-0/kind-3 entirely. Only falls back to DEFAULT_RELAYS on
        // the very first login (before any relay cache exists).
        InteractionManager.runAfterInteractions(async () => {
          let workingRelays: string[] = nostrService.DEFAULT_RELAYS;
          // Ignore the timestamp here — even a stale cached relay list is
          // better than DEFAULT_RELAYS for reaching user-only relays.
          const { value: cachedRelays } = await readCachedWithTtl<RelayConfig[]>(
            RELAY_LIST_CACHE_KEY,
            RELAY_LIST_TIMESTAMP_KEY,
          );
          if (cachedRelays) {
            const readRelays = cachedRelays.filter((r) => r.read).map((r) => r.url);
            if (readRelays.length > 0) workingRelays = readRelays;
          }

          const t0 = Date.now();
          Promise.all([
            loadRelays(pk!).catch((e) => console.warn('[Nostr] relay refresh failed:', e)),
            loadProfile(pk!, workingRelays).catch((e) =>
              console.warn('[Nostr] profile refresh failed:', e),
            ),
            loadContacts(pk!, workingRelays).catch((e) =>
              console.warn('[Nostr] contact refresh failed:', e),
            ),
          ]).then(() => {
            if (__DEV__) console.log(`[Nostr] parallel refresh complete in ${Date.now() - t0}ms`);
          });
        });
      } catch (error) {
        console.warn('Nostr auto-login failed:', error);
      }
    })();
  }, [loadRelays, loadProfile, loadContacts, loadContactsFromCache]);

  const loginWithNsec = useCallback(
    async (nsec: string): Promise<{ success: boolean; error?: string }> => {
      setIsLoggingIn(true);
      try {
        const trimmed = nsec.trim();
        if (!trimmed.startsWith('nsec1')) {
          return { success: false, error: 'Key must start with nsec1' };
        }

        const { pubkey: pk } = nostrService.decodeNsec(trimmed);
        setPubkey(pk);

        // Store credentials
        await SecureStore.setItemAsync(NSEC_KEY, trimmed);
        await SecureStore.setItemAsync(SIGNER_TYPE_KEY, 'nsec');

        setSignerType('nsec');
        setIsLoggedIn(true);
        setIsLoggingIn(false);

        // Load cached contacts immediately, fetch fresh data in background
        await loadContactsFromCache();
        InteractionManager.runAfterInteractions(async () => {
          try {
            const readRelays = await loadRelays(pk);
            await loadProfile(pk, readRelays);
            loadContacts(pk, readRelays).catch((e) =>
              console.warn('Background contact refresh failed:', e),
            );
          } catch (error) {
            console.warn('Nsec post-login refresh failed:', error);
          }
        });

        return { success: true };
      } catch (error) {
        // Sanitize error messages to never expose nsec
        let message = error instanceof Error ? error.message : 'Failed to login';
        if (message.includes('nsec')) message = 'Invalid private key';
        return { success: false, error: message };
      } finally {
        setIsLoggingIn(false);
      }
    },
    [loadRelays, loadProfile, loadContacts, loadContactsFromCache],
  );

  const loginWithAmber = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!amberService.isAmberSupported()) {
      return { success: false, error: 'Amber is only supported on Android' };
    }
    setIsLoggingIn(true);
    try {
      // Native module uses startActivityForResult — returns pubkey directly
      const pk = await amberService.requestPublicKey();

      setPubkey(pk);
      await SecureStore.setItemAsync(PUBKEY_KEY, pk);
      await SecureStore.setItemAsync(SIGNER_TYPE_KEY, 'amber');

      setSignerType('amber');
      setIsLoggedIn(true);
      setIsLoggingIn(false);

      // Load cached contacts immediately, fetch fresh data in background
      await loadContactsFromCache();
      InteractionManager.runAfterInteractions(async () => {
        try {
          const readRelays = await loadRelays(pk);
          await loadProfile(pk, readRelays);
          loadContacts(pk, readRelays).catch((e) =>
            console.warn('Background contact refresh failed:', e),
          );
        } catch (error) {
          console.warn('Amber post-login refresh failed:', error);
        }
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Amber login failed';
      return { success: false, error: message };
    } finally {
      setIsLoggingIn(false);
    }
  }, [loadRelays, loadProfile, loadContacts, loadContactsFromCache]);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(NSEC_KEY);
    await SecureStore.deleteItemAsync(PUBKEY_KEY);
    await SecureStore.deleteItemAsync(SIGNER_TYPE_KEY);
    await AsyncStorage.multiRemove([
      CONTACTS_CACHE_KEY,
      CONTACTS_TIMESTAMP_KEY,
      PROFILES_CACHE_KEY,
      CACHE_TIMESTAMP_KEY,
      OWN_PROFILE_CACHE_KEY,
      OWN_PROFILE_TIMESTAMP_KEY,
      RELAY_LIST_CACHE_KEY,
      RELAY_LIST_TIMESTAMP_KEY,
    ]);

    setPubkey(null);
    setProfile(null);
    setContacts([]);
    setRelays([]);
    setSignerType(null);
    setIsLoggedIn(false);

    nostrService.cleanup();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!pubkey) return;
    const readRelays = getReadRelays();
    await loadProfile(pubkey, readRelays);
  }, [pubkey, getReadRelays, loadProfile]);

  const refreshContacts = useCallback(async () => {
    if (!pubkey) return;
    const readRelays = getReadRelays();
    await loadContacts(pubkey, readRelays);
  }, [pubkey, getReadRelays, loadContacts]);

  const signZapRequest = useCallback(
    async (
      recipientPubkey: string,
      amountSats: number,
      comment: string,
    ): Promise<string | null> => {
      if (!pubkey || !isLoggedIn) return null;

      const readRelays = getReadRelays();
      const zapEvent = nostrService.createZapRequestEvent(
        pubkey,
        recipientPubkey,
        amountSats * 1000,
        readRelays,
        comment,
      );

      if (signerType === 'nsec') {
        const nsec = await SecureStore.getItemAsync(NSEC_KEY);
        if (!nsec) return null;
        const { secretKey } = nostrService.decodeNsec(nsec);
        const signed = nostrService.signEvent(zapEvent, secretKey);
        return JSON.stringify(signed);
      } else if (signerType === 'amber') {
        try {
          const eventJson = JSON.stringify(zapEvent);
          const { event: signedEventJson } = await amberService.requestEventSignature(
            eventJson,
            '',
            pubkey,
          );
          // Amber returns the fully signed event with correct id and sig
          return signedEventJson || null;
        } catch {
          return null;
        }
      }

      return null;
    },
    [pubkey, isLoggedIn, signerType, getReadRelays],
  );

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
        }
        return true;
      } catch (error) {
        console.warn('Failed to publish contact list:', error);
        return false;
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  const publishProfile = useCallback(
    async (profileData: {
      name?: string;
      display_name?: string;
      picture?: string;
      banner?: string;
      about?: string;
      lud16?: string;
      nip05?: string;
    }): Promise<boolean> => {
      if (!pubkey || !isLoggedIn) return false;
      try {
        const event = nostrService.createProfileEvent(profileData);
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
        }

        // Refresh profile to pick up changes
        const readRelays = getReadRelays();
        const updated = await nostrService.fetchProfile(pubkey, readRelays);
        if (updated) setProfile(updated);

        return true;
      } catch (error) {
        console.warn('Failed to publish profile:', error);
        return false;
      }
    },
    [pubkey, isLoggedIn, signerType, relays, getReadRelays],
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
        // Update cache so restarts reflect the follow immediately
        AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(updatedContacts)).catch(() => {});
        AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
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
              AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
              return updated;
            }),
          );
        }
      }
      return success;
    },
    [contacts, publishContactList, getReadRelays],
  );

  const unfollowContact = useCallback(
    async (contactPubkey: string): Promise<boolean> => {
      const updatedContacts = contacts.filter((c) => c.pubkey !== contactPubkey);
      const success = await publishContactList(updatedContacts);
      if (success) {
        startTransition(() => setContacts(updatedContacts));
        // Update cache so restarts reflect the unfollow immediately
        AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(updatedContacts)).catch(() => {});
        AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
      }
      return success;
    },
    [contacts, publishContactList],
  );

  const addContact = useCallback(
    async (npubOrHex: string): Promise<{ success: boolean; error?: string }> => {
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
          return { success: false, error: 'Already following this contact' };
        }
        const success = await followContact(hex);
        return success
          ? { success: true }
          : { success: false, error: 'Failed to publish contact list' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Invalid key' };
      }
    },
    [contacts, followContact],
  );

  const sendDirectMessage = useCallback(
    async (
      recipientPubkey: string,
      plaintext: string,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalizedRecipientPubkey = recipientPubkey.trim();
      if (!/^[0-9a-f]{64}$/i.test(normalizedRecipientPubkey)) {
        return { success: false, error: 'Invalid public key format' };
      }
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = writeRelays.length > 0 ? writeRelays : nostrService.DEFAULT_RELAYS;
      try {
        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const event = await nostrService.createDirectMessageEvent(
            secretKey,
            normalizedRecipientPubkey,
            plaintext,
          );
          await nostrService.signAndPublishEvent(event, secretKey, targetRelays);
          return { success: true };
        } else if (signerType === 'amber') {
          const ciphertext = await amberService.requestNip04Encrypt(
            plaintext,
            normalizedRecipientPubkey,
            pubkey,
          );
          if (!ciphertext) return { success: false, error: 'Amber returned empty ciphertext' };
          const event = {
            kind: 4,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', normalizedRecipientPubkey]],
            content: ciphertext,
          };
          const { event: signedEventJson } = await amberService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedEventJson) return { success: false, error: 'Amber returned empty event' };
          const signed = JSON.parse(signedEventJson);
          await nostrService.publishSignedEvent(signed, targetRelays);
          return { success: true };
        }
        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  const fetchConversation = useCallback(
    async (otherPubkey: string): Promise<ConversationMessage[]> => {
      if (!pubkey || !isLoggedIn) return [];
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return [];

      const readRelays = getReadRelays();
      const events = await nostrService.fetchDirectMessageEvents(pubkey, normalized, readRelays);
      if (events.length === 0) return [];

      let cachedSecretKey: Uint8Array | null = null;
      const getSecretKey = async (): Promise<Uint8Array | null> => {
        if (cachedSecretKey) return cachedSecretKey;
        const nsec = await SecureStore.getItemAsync(NSEC_KEY);
        if (!nsec) return null;
        cachedSecretKey = nostrService.decodeNsec(nsec).secretKey;
        return cachedSecretKey;
      };

      const decrypted: ConversationMessage[] = [];
      for (const ev of events) {
        const fromMe = ev.pubkey === pubkey;
        const counterparty = fromMe ? normalized : ev.pubkey;
        try {
          let plaintext: string | null = null;
          if (signerType === 'nsec') {
            const secretKey = await getSecretKey();
            if (!secretKey) continue;
            plaintext = await nostrService.decryptNip04WithSecret(
              secretKey,
              counterparty,
              ev.content,
            );
          } else if (signerType === 'amber') {
            plaintext = await amberService.requestNip04Decrypt(ev.content, counterparty, pubkey);
          }
          if (plaintext === null) continue;
          decrypted.push({
            id: ev.id,
            fromMe,
            text: plaintext,
            createdAt: ev.created_at,
          });
        } catch (error) {
          if (__DEV__) console.warn('[Nostr] decrypt DM failed:', error);
        }
      }

      decrypted.sort((a, b) => a.createdAt - b.createdAt);
      return decrypted;
    },
    [pubkey, isLoggedIn, signerType, getReadRelays],
  );

  const signEvent = useCallback(
    async (event: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    }): Promise<SignedEvent | null> => {
      if (!pubkey || !isLoggedIn) return null;
      try {
        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return null;
          const { secretKey } = nostrService.decodeNsec(nsec);
          return nostrService.signEvent(event, secretKey) as SignedEvent;
        } else if (signerType === 'amber') {
          const { event: signedEventJson } = await amberService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedEventJson) return null;
          return JSON.parse(signedEventJson) as SignedEvent;
        }
        return null;
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] signEvent failed:', error);
        return null;
      }
    },
    [pubkey, isLoggedIn, signerType],
  );

  const contextValue = useMemo(
    () => ({
      isLoggedIn,
      isLoggingIn,
      profile,
      contacts,
      relays,
      signerType,
      loginWithNsec,
      loginWithAmber,
      logout,
      refreshProfile,
      refreshContacts,
      signZapRequest,
      publishProfile,
      followContact,
      unfollowContact,
      addContact,
      sendDirectMessage,
      fetchConversation,
      signEvent,
    }),
    [
      isLoggedIn,
      isLoggingIn,
      profile,
      contacts,
      relays,
      signerType,
      loginWithNsec,
      loginWithAmber,
      logout,
      refreshProfile,
      refreshContacts,
      signZapRequest,
      publishProfile,
      followContact,
      unfollowContact,
      addContact,
      sendDirectMessage,
      fetchConversation,
      signEvent,
    ],
  );

  return <NostrContext.Provider value={contextValue}>{children}</NostrContext.Provider>;
};

export function useNostr() {
  const context = useContext(NostrContext);
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider');
  }
  return context;
}
