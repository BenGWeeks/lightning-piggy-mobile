import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
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
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  followContact: (pubkey: string) => Promise<boolean>;
  unfollowContact: (pubkey: string) => Promise<boolean>;
  addContact: (npubOrHex: string) => Promise<{ success: boolean; error?: string }>;
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

  const getReadRelays = useCallback((): string[] => {
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, [relays]);

  const loadProfile = useCallback(async (pk: string, relayUrls: string[]) => {
    const t0 = Date.now();
    const fetchedProfile = await nostrService.fetchProfile(pk, relayUrls);
    if (__DEV__) console.log(`[Nostr] fetchProfile: ${Date.now() - t0}ms`);
    if (fetchedProfile) {
      setProfile(fetchedProfile);
    }
  }, []);

  const loadContactsFromCache = useCallback(async () => {
    try {
      const t0 = Date.now();
      const [contactsJson, profilesJson, timestampStr] = await Promise.all([
        AsyncStorage.getItem(CONTACTS_CACHE_KEY),
        AsyncStorage.getItem(PROFILES_CACHE_KEY),
        AsyncStorage.getItem(CACHE_TIMESTAMP_KEY),
      ]);
      // Skip stale cache (older than 24h)
      if (timestampStr && Date.now() - parseInt(timestampStr, 10) > CACHE_MAX_AGE_MS) {
        if (__DEV__) console.log('[Nostr] cache expired, skipping');
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
          setContacts(withProfiles);
          if (__DEV__)
            console.log(
              `[Nostr] loaded ${withProfiles.length} contacts from cache in ${Date.now() - t0}ms`,
            );
        } else {
          setContacts(cached);
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
    const fetchedContacts = await nostrService.fetchContactList(pk, relayUrls);
    if (__DEV__)
      console.log(
        `[Nostr] fetchContactList: ${Date.now() - t0}ms, ${fetchedContacts.length} contacts`,
      );
    setContacts(fetchedContacts);

    // Cache the contact list
    try {
      await AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(fetchedContacts));
    } catch {}

    // Fetch profiles in background after UI is idle
    if (fetchedContacts.length > 0) {
      const contactPubkeys = fetchedContacts.map((c) => c.pubkey);
      const t1 = Date.now();
      const profileMap = await nostrService.fetchProfiles(contactPubkeys, relayUrls);
      if (__DEV__)
        console.log(
          `[Nostr] fetchProfiles: ${Date.now() - t1}ms, ${profileMap.size}/${contactPubkeys.length} profiles loaded`,
        );
      setContacts((prev) =>
        prev.map((c) => ({
          ...c,
          profile: profileMap.get(c.pubkey) ?? c.profile,
        })),
      );

      // Cache profiles
      try {
        const profileObj: Record<string, NostrProfile> = {};
        profileMap.forEach((v, k) => {
          profileObj[k] = v;
        });
        await AsyncStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(profileObj));
        await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      } catch {}
    }
  }, []);

  const loadRelays = useCallback(async (pk: string): Promise<string[]> => {
    const t0 = Date.now();
    const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
    if (__DEV__)
      console.log(`[Nostr] fetchRelayList: ${Date.now() - t0}ms, ${relayList.length} relays`);
    setRelays(relayList);
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

        // Defer relay fetches until after animations/rendering complete
        InteractionManager.runAfterInteractions(async () => {
          try {
            const readRelays = await loadRelays(pk!);
            await loadProfile(pk!, readRelays);
            // Refresh contacts from relays in background
            loadContacts(pk!, readRelays);
          } catch (error) {
            console.warn('Nostr background refresh failed:', error);
          }
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

        // Fetch relay list and profile, then dismiss spinner
        const readRelays = await loadRelays(pk);
        await loadProfile(pk, readRelays);
        setIsLoggingIn(false);

        // Contacts fetched in the background after sheet closes
        loadContacts(pk, readRelays);

        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to login';
        return { success: false, error: message };
      } finally {
        setIsLoggingIn(false);
      }
    },
    [loadRelays, loadProfile, loadContacts],
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

      // Fetch relay list and profile, then dismiss spinner
      const readRelays = await loadRelays(pk);
      await loadProfile(pk, readRelays);
      setIsLoggingIn(false);

      // Contacts fetched in the background after sheet closes
      loadContacts(pk, readRelays);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Amber login failed';
      return { success: false, error: message };
    } finally {
      setIsLoggingIn(false);
    }
  }, [loadRelays, loadProfile, loadContacts]);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(NSEC_KEY);
    await SecureStore.deleteItemAsync(PUBKEY_KEY);
    await SecureStore.deleteItemAsync(SIGNER_TYPE_KEY);
    await AsyncStorage.multiRemove([CONTACTS_CACHE_KEY, PROFILES_CACHE_KEY, CACHE_TIMESTAMP_KEY]);

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
        setContacts(updatedContacts);
        // Fetch profile for the new contact
        const readRelays = getReadRelays();
        const profileData = await nostrService.fetchProfile(contactPubkey, readRelays);
        if (profileData) {
          setContacts((prev) =>
            prev.map((c) => (c.pubkey === contactPubkey ? { ...c, profile: profileData } : c)),
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
        setContacts(updatedContacts);
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
      followContact,
      unfollowContact,
      addContact,
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
      followContact,
      unfollowContact,
      addContact,
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
