import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { NostrProfile, NostrContact, RelayConfig, SignerType } from '../types/nostr';

const NSEC_KEY = 'nostr_nsec';
const PUBKEY_KEY = 'nostr_pubkey';
const SIGNER_TYPE_KEY = 'nostr_signer_type';

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
    const fetchedProfile = await nostrService.fetchProfile(pk, relayUrls);
    if (fetchedProfile) {
      setProfile(fetchedProfile);
    }
  }, []);

  const loadContacts = useCallback(async (pk: string, relayUrls: string[]) => {
    const fetchedContacts = await nostrService.fetchContactList(pk, relayUrls);
    setContacts(fetchedContacts);

    // Fetch profiles for contacts in the background
    if (fetchedContacts.length > 0) {
      const contactPubkeys = fetchedContacts.map((c) => c.pubkey);
      const profileMap = await nostrService.fetchProfiles(contactPubkeys, relayUrls);
      setContacts((prev) =>
        prev.map((c) => ({
          ...c,
          profile: profileMap.get(c.pubkey) ?? c.profile,
        })),
      );
    }
  }, []);

  const loadRelays = useCallback(async (pk: string): Promise<string[]> => {
    const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
    setRelays(relayList);
    const readRelays = relayList.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, []);

  // Auto-login on startup
  useEffect(() => {
    (async () => {
      try {
        const storedSignerType = await SecureStore.getItemAsync(SIGNER_TYPE_KEY);
        if (storedSignerType === 'nsec') {
          const storedNsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (storedNsec) {
            const { pubkey: pk } = nostrService.decodeNsec(storedNsec);
            setPubkey(pk);
            setSignerType('nsec');
            setIsLoggedIn(true);

            const readRelays = await loadRelays(pk);
            await loadProfile(pk, readRelays);
            await loadContacts(pk, readRelays);
          }
        } else if (storedSignerType === 'amber') {
          const storedPubkey = await SecureStore.getItemAsync(PUBKEY_KEY);
          if (storedPubkey) {
            setPubkey(storedPubkey);
            setSignerType('amber');
            setIsLoggedIn(true);

            const readRelays = await loadRelays(storedPubkey);
            await loadProfile(storedPubkey, readRelays);
            await loadContacts(storedPubkey, readRelays);
          }
        }
      } catch (error) {
        console.warn('Nostr auto-login failed:', error);
      }
    })();
  }, [loadRelays, loadProfile, loadContacts]);

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
          const signature = await amberService.requestEventSignature(
            eventJson,
            '',
            pubkey,
          );
          const signed = { ...zapEvent, id: '', sig: signature };
          return JSON.stringify(signed);
        } catch {
          return null;
        }
      }

      return null;
    },
    [pubkey, isLoggedIn, signerType, getReadRelays],
  );

  return (
    <NostrContext.Provider
      value={{
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
      }}
    >
      {children}
    </NostrContext.Provider>
  );
};

export function useNostr() {
  const context = useContext(NostrContext);
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider');
  }
  return context;
}
