import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  startTransition,
} from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { NostrProfile, NostrContact, RelayConfig, SignerType } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { partnerFromRumor, unwrapWrapNsec, unwrapWrapViaNip44 } from '../utils/nip17Unwrap';

// Module-scope memo for the current user's secret key. Five paths in this
// file need access to the nsec (sign, publishProfile, publishContactList,
// sendDirectMessage, decrypt), and each one was previously hitting
// SecureStore + bech32-decoding afresh. Memoising keyed by pubkey means
// we read disk + decode once per login and invalidate on logout.
let _cachedSecretKey: { pubkey: string; secretKey: Uint8Array } | null = null;
async function getMemoisedSecretKey(expectedPubkey: string): Promise<Uint8Array | null> {
  if (_cachedSecretKey && _cachedSecretKey.pubkey === expectedPubkey) {
    return _cachedSecretKey.secretKey;
  }
  const nsec = await SecureStore.getItemAsync(NSEC_KEY);
  if (!nsec) return null;
  const { pubkey, secretKey } = nostrService.decodeNsec(nsec);
  if (pubkey !== expectedPubkey) return null;
  _cachedSecretKey = { pubkey, secretKey };
  return secretKey;
}
function clearMemoisedSecretKey(): void {
  _cachedSecretKey = null;
}

// AsyncStorage keys scoped to the Amber NIP-17 pipeline.
const AMBER_NIP17_CACHE_KEY = 'amber_nip17_cache_v1';
const AMBER_NIP17_CACHE_CAP = 5000;
const AMBER_NIP17_ENABLED_KEY = 'amber_nip17_enabled';

// The nsec signer has the same wrap-id → DmInboxEntry cache shape as
// Amber. Without it, every thread open re-fetches and re-decrypts the
// full NIP-17 inbox — see #176.
const NSEC_NIP17_CACHE_KEY = 'nsec_nip17_cache_v1';

/** Persistent wrap-id → DmInboxEntry cache. Only ever contains rumors
 * from followed senders — see refreshDmInbox's filter gate. */
type AmberNip17CacheEntry = DmInboxEntry & { wrapId: string };

/** Yield to the JS event loop so UI interactions can tick between
 * chunks of a synchronous decrypt loop (#177). `await`ing an already-
 * resolved promise only drains the microtask queue, which still
 * starves UI events — setTimeout(0) returns to the task scheduler. */
const DECRYPT_YIELD_EVERY = 15;
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — for all-cached fast path
// A contact whose kind-0 we couldn't resolve on the previous attempt is
// retried much sooner than 24 h. The "miss" often reflects the user's
// profile being on a relay we hadn't hit yet at that moment, not that
// they've never published one — a shorter retry window turns a few of
// those no-profile contacts into resolved ones within the hour.
const MISSING_PROFILE_RETRY_MS = 60 * 60 * 1000; // 1 hour

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
  /**
   * Re-fetch the logged-in user's kind-0.
   *
   * Default (no arg / `force: false`): honours the 24h cache — a no-op
   * when a cached profile is still fresh. Safe to call from
   * `useFocusEffect` on any tab without racking up relay round-trips.
   *
   * `force: true`: bypass the cache and hit relays. Reserved for
   * explicit user-initiated refreshes (pull-to-refresh, manual
   * "reload my profile" actions).
   */
  refreshProfile: (opts?: { force?: boolean }) => Promise<void>;
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
  dmInbox: DmInboxEntry[];
  dmInboxLoading: boolean;
  refreshDmInbox: () => Promise<void>;
  /**
   * Tri-state for the NIP-17 silent-decrypt fast path.
   *  - 'unknown': haven't tried yet in this session
   *  - 'granted': a decrypt succeeded silently → cache the plaintext, no dialogs
   *  - 'denied':  a decrypt rejected with PERMISSION_NOT_GRANTED → Account
   *              should surface a one-tap grant button rather than flood the
   *              signer with dialogs on subsequent refreshes
   */
  amberNip44Permission: 'unknown' | 'granted' | 'denied';
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
  const [dmInbox, setDmInbox] = useState<DmInboxEntry[]>([]);
  const [dmInboxLoading, setDmInboxLoading] = useState(false);
  const [amberNip44Permission, setAmberNip44Permission] = useState<
    'unknown' | 'granted' | 'denied'
  >('unknown');

  // Single-flight guard: coalesce overlapping refreshDmInbox calls (e.g.
  // useFocusEffect firing while a pull-to-refresh is still in-flight) so
  // they don't race on the AsyncStorage wrap-id cache.
  const dmInboxInFlight = useRef<Promise<void> | null>(null);

  /**
   * Set of followed pubkeys (lowercase hex). Used to gate who can land a
   * rumor in the inbox — see refreshDmInbox. Rebuilt from `contacts`
   * whenever that state updates.
   */
  const followPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) set.add(c.pubkey.toLowerCase());
    return set;
  }, [contacts]);

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

  const loadProfile = useCallback(
    async (pk: string, relayUrls: string[], opts?: { force?: boolean }) => {
      const t0 = Date.now();
      // Cache-fresh fast path: hydrate UI from cache and skip the relay RTT.
      // `force` bypasses it for user-initiated refreshes.
      const { value: cached, ageMs } = await readCachedWithTtl<NostrProfile>(
        OWN_PROFILE_CACHE_KEY,
        OWN_PROFILE_TIMESTAMP_KEY,
      );
      if (!opts?.force && cached && ageMs < CACHE_MAX_AGE_MS) {
        setProfile(cached);
        if (__DEV__) console.log(`[Nostr] fetchProfile: skipped (cache fresh)`);
        return;
      }
      const fetchedProfile = await nostrService.fetchProfile(pk, relayUrls);
      if (__DEV__) console.log(`[Nostr] fetchProfile: ${Date.now() - t0}ms`);
      if (fetchedProfile) {
        setProfile(fetchedProfile);
        InteractionManager.runAfterInteractions(() => {
          AsyncStorage.setItem(OWN_PROFILE_CACHE_KEY, JSON.stringify(fetchedProfile)).catch(
            () => {},
          );
          AsyncStorage.setItem(OWN_PROFILE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
        });
      }
    },
    [],
  );

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

  const loadContacts = useCallback(
    async (pk: string, relayUrls: string[], opts?: { force?: boolean }) => {
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
      const contactsCacheFresh = !opts?.force && contactsAgeMs < CACHE_MAX_AGE_MS;
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
      // `force` skips this fast path so user-initiated refreshes always
      // re-hit relays.
      if (!opts?.force && cacheFresh && missingFromCache.length === 0) {
        if (__DEV__)
          console.log(
            `[Nostr] fetchProfiles: skipped (cache fresh @ ${Math.round(cacheAgeMs / 1000)}s old, all ${fetchedContacts.length} contacts cached)`,
          );
        return;
      }

      // When the cache is fresh, the "missing" contacts are the ones who had
      // no kind-0 response last time we asked. Re-querying on every cold
      // start costs 3 s for contacts that probably just never published a
      // profile — so we skip — but only for MISSING_PROFILE_RETRY_MS, much
      // shorter than the 24 h fast-path TTL, so a transient relay miss
      // resolves within the hour. `force` bypasses this too.
      const missingRetryFresh = !opts?.force && cacheAgeMs < MISSING_PROFILE_RETRY_MS;
      if (missingRetryFresh) {
        if (__DEV__)
          console.log(
            `[Nostr] fetchProfiles: skipped (cache ${Math.round(cacheAgeMs / 1000)}s old, ${missingFromCache.length} unknown profiles will retry after ${Math.round(MISSING_PROFILE_RETRY_MS / 1000)}s)`,
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
    },
    [],
  );

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
    clearMemoisedSecretKey();
    setAmberNip44Permission('unknown');
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
      // DM-inbox state is identity-scoped — decrypted rumors and the
      // Amber NIP-17 permission intent belong to the logged-in user,
      // not globally.
      'amber_nip17_cache_v1',
      'amber_nip17_enabled',
      'nsec_nip17_cache_v1',
    ]);

    setPubkey(null);
    setProfile(null);
    setContacts([]);
    setRelays([]);
    setSignerType(null);
    setIsLoggedIn(false);

    nostrService.cleanup();
  }, []);

  const refreshProfile = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!pubkey) return;
      const readRelays = getReadRelays();
      // Default respects the 24h cache so useFocusEffect callers don't
      // thrash the network on every tab switch. `force: true` is for
      // pull-to-refresh and other explicit user actions where we want
      // the latest kind-0 regardless of cache freshness.
      await loadProfile(pubkey, readRelays, { force: opts?.force === true });
    },
    [pubkey, getReadRelays, loadProfile],
  );

  const refreshContacts = useCallback(async () => {
    if (!pubkey) return;
    const readRelays = getReadRelays();
    // User-initiated refresh (e.g. pull-to-refresh) — bypass the 24h
    // contacts cache so newly-added follows surface immediately.
    await loadContacts(pubkey, readRelays, { force: true });
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

        // We just signed and published this kind-0, so the client already
        // has the authoritative new profile. Shortcut the relay round-trip
        // by updating local state + the 24h own-profile cache in-place,
        // otherwise the top-right profile icon keeps the pre-publish
        // avatar/name until the next force-refresh (up to 24h — see #148).
        //
        // Apply the same "drop falsy values" rule createProfileEvent uses
        // (service.ts:520-524) so local state matches exactly what was
        // published — a caller passing `name: ""` otherwise leaves the
        // cache with an empty string while the kind-0 on the wire omits
        // the field entirely.
        const nullIfEmpty = (v: string | undefined): string | null => (v ? v : null);
        const updatedProfile: NostrProfile = {
          pubkey,
          npub: nip19.npubEncode(pubkey),
          name: nullIfEmpty(profileData.name),
          displayName: nullIfEmpty(profileData.display_name),
          picture: nullIfEmpty(profileData.picture),
          banner: nullIfEmpty(profileData.banner),
          about: nullIfEmpty(profileData.about),
          lud16: nullIfEmpty(profileData.lud16),
          nip05: nullIfEmpty(profileData.nip05),
        };
        setProfile(updatedProfile);
        InteractionManager.runAfterInteractions(() => {
          AsyncStorage.setItem(OWN_PROFILE_CACHE_KEY, JSON.stringify(updatedProfile)).catch(
            () => {},
          );
          AsyncStorage.setItem(OWN_PROFILE_TIMESTAMP_KEY, Date.now().toString()).catch(() => {});
        });

        return true;
      } catch (error) {
        console.warn('Failed to publish profile:', error);
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
      // Union the user's published write relays with DEFAULT_RELAYS. Publish
      // uses Promise.any, so one responsive relay is enough — but a user
      // whose NIP-65 list has a single entry (and no in-app UI to edit it)
      // hits a single-point failure the moment that relay is slow.
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
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

  /**
   * Decrypt one NIP-04 payload with whichever signer is active. Returns
   * null (not throw) on failure so batch callers don't abort the whole
   * loop on one bad event.
   */
  const decryptNip04ViaSigner = useCallback(
    async (counterpartyPubkey: string, ciphertext: string): Promise<string | null> => {
      if (!pubkey) return null;
      try {
        if (signerType === 'nsec') {
          const secretKey = await getMemoisedSecretKey(pubkey);
          if (!secretKey) return null;
          return await nostrService.decryptNip04WithSecret(
            secretKey,
            counterpartyPubkey,
            ciphertext,
          );
        }
        if (signerType === 'amber') {
          return await amberService.requestNip04Decrypt(ciphertext, counterpartyPubkey, pubkey);
        }
        return null;
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] NIP-04 decrypt failed:', error);
        return null;
      }
    },
    [pubkey, signerType],
  );

  /**
   * Silent Amber NIP-44 decrypt wrapped as the callback shape expected by
   * unwrapWrapViaNip44. Throws on PERMISSION_NOT_GRANTED so the caller
   * can flip the permission flag and stop iterating rather than falling
   * back to the Intent dialog (which would flood one dialog per wrap).
   */
  const amberNip44DecryptSilent = useCallback(
    async (ciphertext: string, counterpartyPubkey: string): Promise<string> => {
      if (!pubkey) throw new Error('Not logged in');
      return amberService.requestNip44DecryptSilent(ciphertext, counterpartyPubkey, pubkey);
    },
    [pubkey],
  );

  const fetchConversation = useCallback(
    async (otherPubkey: string): Promise<ConversationMessage[]> => {
      if (!pubkey || !isLoggedIn) return [];
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return [];

      const readRelays = getReadRelays();
      const decrypted: ConversationMessage[] = [];

      // NIP-04 — peer-scoped fetch, two directions.
      const kind4Events = await nostrService.fetchDirectMessageEvents(
        pubkey,
        normalized,
        readRelays,
      );
      let kind4Decrypted = 0;
      for (const ev of kind4Events) {
        const fromMe = ev.pubkey === pubkey;
        const counterparty = fromMe ? normalized : ev.pubkey.toLowerCase();
        const plaintext = await decryptNip04ViaSigner(counterparty, ev.content);
        if (plaintext === null) continue;
        decrypted.push({ id: ev.id, fromMe, text: plaintext, createdAt: ev.created_at });
        if (++kind4Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
      }

      // NIP-17 — partner pubkey is hidden inside the encrypted rumor, so
      // we can't peer-scope at the relay. Pull all gift wraps addressed to
      // me, unwrap, keep only rumors whose partner matches the current
      // peer. Amber path reuses the persistent wrap-id cache populated by
      // refreshDmInbox so re-entering a thread doesn't re-round-trip.
      const { kind1059 } = await nostrService.fetchInboxDmEvents(pubkey, readRelays);
      if (kind1059.length > 0) {
        const onSkip = (reason: string, wrapId: string) => {
          if (__DEV__) console.warn(`[Nostr] NIP-17 thread unwrap skip (${wrapId}): ${reason}`);
        };
        if (signerType === 'nsec') {
          const secretKey = await getMemoisedSecretKey(pubkey);
          if (secretKey) {
            // Reuse the persistent wrap-id cache populated by
            // refreshDmInbox — re-entering a thread shouldn't re-decrypt
            // the full inbox (#176). Cache writes happen only in the
            // inbox refresh path; here we read-only short-circuit.
            const raw = await AsyncStorage.getItem(NSEC_NIP17_CACHE_KEY);
            const cache: Record<string, AmberNip17CacheEntry> = raw ? JSON.parse(raw) : {};
            let nip17Decrypted = 0;
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                if (cached.partnerPubkey !== normalized) continue;
                decrypted.push({
                  id: wrap.id,
                  fromMe: cached.fromMe,
                  text: cached.text,
                  createdAt: cached.createdAt,
                });
                continue;
              }
              const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
              if (++nip17Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
              if (!rumor) continue;
              const partnership = partnerFromRumor(rumor, pubkey);
              if (!partnership || partnership.partnerPubkey !== normalized) continue;
              decrypted.push({
                id: wrap.id,
                fromMe: partnership.fromMe,
                text: rumor.content,
                createdAt: rumor.created_at,
              });
            }
          }
        } else if (signerType === 'amber') {
          const amberEnabled = (await AsyncStorage.getItem(AMBER_NIP17_ENABLED_KEY)) === 'true';
          if (amberEnabled) {
            const raw = await AsyncStorage.getItem(AMBER_NIP17_CACHE_KEY);
            const cache: Record<string, AmberNip17CacheEntry> = raw ? JSON.parse(raw) : {};
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                if (cached.partnerPubkey !== normalized) continue;
                decrypted.push({
                  id: wrap.id,
                  fromMe: cached.fromMe,
                  text: cached.text,
                  createdAt: cached.createdAt,
                });
                continue;
              }
              // Not cached. For thread view we DO fall back to the Intent
              // dialog if the silent path rejects — the user has actively
              // opened this thread, one approval prompt per wrap is fine.
              // The inbox refresh uses the silent-only path to avoid the
              // flood, so cached entries cover the hot path.
              try {
                const rumor = await unwrapWrapViaNip44(
                  wrap,
                  (ct, cp) => amberService.requestNip44Decrypt(ct, cp, pubkey),
                  onSkip,
                );
                if (!rumor) continue;
                const partnership = partnerFromRumor(rumor, pubkey);
                if (!partnership || partnership.partnerPubkey !== normalized) continue;
                decrypted.push({
                  id: wrap.id,
                  fromMe: partnership.fromMe,
                  text: rumor.content,
                  createdAt: rumor.created_at,
                });
              } catch (error) {
                if (__DEV__) console.warn('[Nostr] Amber NIP-17 thread unwrap failed:', error);
              }
            }
          }
        }
      }

      decrypted.sort((a, b) => a.createdAt - b.createdAt);
      return decrypted;
    },
    [pubkey, isLoggedIn, signerType, getReadRelays, decryptNip04ViaSigner],
  );

  const refreshDmInbox = useCallback(async (): Promise<void> => {
    if (!pubkey || !isLoggedIn) {
      setDmInbox([]);
      return;
    }
    // Single-flight: if a refresh is already in flight, piggy-back on it
    // rather than kicking off a second concurrent fetch that would race
    // the AsyncStorage wrap-id cache.
    if (dmInboxInFlight.current) {
      return dmInboxInFlight.current;
    }

    // Capture local references once so the closure isn't affected by
    // mid-flight signer / identity changes. If we detect pubkey/signerType
    // has changed by the time we're about to commit, we bail without
    // mutating state to avoid leaking entries into the wrong session.
    const refreshForPubkey = pubkey;
    const refreshForSigner = signerType;
    const refreshFollows = followPubkeys;

    const task = (async () => {
      setDmInboxLoading(true);
      try {
        const readRelays = getReadRelays();
        const { kind4, kind1059 } = await nostrService.fetchInboxDmEvents(
          refreshForPubkey,
          readRelays,
        );
        const entries: DmInboxEntry[] = [];

        // NIP-04 — partner pubkey is in the envelope, so we can apply the
        // follow filter BEFORE decrypting. A non-followed sender never
        // gets a round-trip through Amber, let alone land in state.
        let kind4Decrypted = 0;
        for (const ev of kind4) {
          const fromMe = ev.pubkey.toLowerCase() === refreshForPubkey;
          const partnerPubkey = (
            fromMe ? (ev.tags.find((t) => t[0] === 'p')?.[1] ?? '') : ev.pubkey
          ).toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(partnerPubkey)) continue;
          if (!refreshFollows.has(partnerPubkey)) continue;
          const plaintext = await decryptNip04ViaSigner(partnerPubkey, ev.content);
          if (plaintext === null) continue;
          entries.push({
            partnerPubkey,
            fromMe,
            createdAt: ev.created_at,
            text: plaintext,
            wireKind: 4,
          });
          if (++kind4Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
        }

        // NIP-17 — partner pubkey is INSIDE the encrypted rumor, so we
        // have to decrypt to know who sent it. For the nsec signer this
        // is cheap pure-JS, so iterate freely and drop non-follows after
        // decrypt. For Amber, guard behind the opt-in toggle + silent-only
        // decrypt path: if Amber hasn't pre-approved nip44_decrypt, we
        // flip amberNip44Permission='denied' so Account can prompt the
        // user for a one-time grant, and stop iterating instead of
        // flooding dialogs.
        const onSkip = (reason: string, wrapId: string) => {
          if (__DEV__) console.warn(`[Nostr] NIP-17 inbox unwrap skip (${wrapId}): ${reason}`);
        };

        if (refreshForSigner === 'nsec' && kind1059.length > 0) {
          const secretKey = await getMemoisedSecretKey(refreshForPubkey);
          if (secretKey) {
            // Persistent wrap-id cache mirroring the Amber branch. Only
            // ever contains rumors from followed senders — see the
            // filter gate below. This is the fix for #176.
            const raw = await AsyncStorage.getItem(NSEC_NIP17_CACHE_KEY);
            const cache: Record<string, AmberNip17CacheEntry> = raw ? JSON.parse(raw) : {};
            const newlyCached: AmberNip17CacheEntry[] = [];
            let nip17Decrypted = 0;
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                // Cache entry exists → it was from a followed sender
                // when first stored. Re-check against the *current*
                // follow set so unfollowed partners don't keep
                // surfacing from cache.
                if (!refreshFollows.has(cached.partnerPubkey)) continue;
                entries.push({
                  partnerPubkey: cached.partnerPubkey,
                  fromMe: cached.fromMe,
                  createdAt: cached.createdAt,
                  text: cached.text,
                  wireKind: cached.wireKind,
                });
                continue;
              }
              const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
              if (++nip17Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
              if (!rumor) continue;
              const partnership = partnerFromRumor(rumor, refreshForPubkey);
              if (!partnership) continue;
              // B1 — drop non-follows at the data layer. No caching, no
              // state. The filter is load-bearing ("parental control"),
              // so it runs here not in the view.
              if (!refreshFollows.has(partnership.partnerPubkey)) continue;
              const entry: AmberNip17CacheEntry = {
                wrapId: wrap.id,
                partnerPubkey: partnership.partnerPubkey,
                fromMe: partnership.fromMe,
                createdAt: rumor.created_at,
                text: rumor.content,
                wireKind: rumor.kind,
              };
              cache[wrap.id] = entry;
              newlyCached.push(entry);
              entries.push({
                partnerPubkey: entry.partnerPubkey,
                fromMe: entry.fromMe,
                createdAt: entry.createdAt,
                text: entry.text,
                wireKind: entry.wireKind,
              });
            }

            if (newlyCached.length > 0) {
              const items = Object.values(cache);
              const toWrite =
                items.length > AMBER_NIP17_CACHE_CAP
                  ? items.sort((a, b) => b.createdAt - a.createdAt).slice(0, AMBER_NIP17_CACHE_CAP)
                  : items;
              const next: Record<string, AmberNip17CacheEntry> = {};
              for (const item of toWrite) next[item.wrapId] = item;
              await AsyncStorage.setItem(NSEC_NIP17_CACHE_KEY, JSON.stringify(next)).catch(
                () => {},
              );
            }
          }
        } else if (refreshForSigner === 'amber' && kind1059.length > 0) {
          const amberEnabled = (await AsyncStorage.getItem(AMBER_NIP17_ENABLED_KEY)) === 'true';
          if (!amberEnabled) {
            if (__DEV__) {
              console.log(
                `[Nostr] Skipping ${kind1059.length} NIP-17 wrap(s) — Account toggle is off`,
              );
            }
          } else {
            // Persistent cache keyed by wrap id. Only ever contains rumors
            // from *followed* senders — see the filter gate below.
            const raw = await AsyncStorage.getItem(AMBER_NIP17_CACHE_KEY);
            const cache: Record<string, AmberNip17CacheEntry> = raw ? JSON.parse(raw) : {};
            const newlyCached: AmberNip17CacheEntry[] = [];
            let permissionDenied = false;

            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                // Cache entry exists → it was from a followed sender when
                // first stored. Re-check against the *current* follow set
                // so unfollowed partners don't keep surfacing from cache.
                if (!refreshFollows.has(cached.partnerPubkey)) continue;
                entries.push({
                  partnerPubkey: cached.partnerPubkey,
                  fromMe: cached.fromMe,
                  createdAt: cached.createdAt,
                  text: cached.text,
                  wireKind: cached.wireKind,
                });
                continue;
              }
              // Uncached — unwrap via Amber's silent content-resolver path.
              // If Amber hasn't granted blanket nip44_decrypt permission,
              // this throws PERMISSION_NOT_GRANTED and we stop iterating.
              try {
                const rumor = await unwrapWrapViaNip44(wrap, amberNip44DecryptSilent, onSkip);
                if (!rumor) continue;
                const partnership = partnerFromRumor(rumor, refreshForPubkey);
                if (!partnership) continue;
                // B1 — never cache rumors from non-followed senders. The
                // cost is re-decrypting them on the next refresh, but the
                // silent path is ~1 ms per call and keeps plaintext off
                // AsyncStorage.
                if (!refreshFollows.has(partnership.partnerPubkey)) continue;
                const entry: AmberNip17CacheEntry = {
                  wrapId: wrap.id,
                  partnerPubkey: partnership.partnerPubkey,
                  fromMe: partnership.fromMe,
                  createdAt: rumor.created_at,
                  text: rumor.content,
                  wireKind: rumor.kind,
                };
                cache[wrap.id] = entry;
                newlyCached.push(entry);
                entries.push({
                  partnerPubkey: entry.partnerPubkey,
                  fromMe: entry.fromMe,
                  createdAt: entry.createdAt,
                  text: entry.text,
                  wireKind: entry.wireKind,
                });
              } catch (error) {
                const code = (error as { code?: string })?.code;
                const message = (error as Error)?.message ?? '';
                if (code === 'PERMISSION_NOT_GRANTED' || /PERMISSION_NOT_GRANTED/.test(message)) {
                  permissionDenied = true;
                  if (__DEV__) {
                    console.log(
                      `[Nostr] Amber NIP-44 permission not granted — stopping NIP-17 unwrap for this refresh`,
                    );
                  }
                  break;
                }
                if (__DEV__) console.warn('[Nostr] Amber NIP-17 unwrap failed:', error);
              }
            }

            setAmberNip44Permission(permissionDenied ? 'denied' : 'granted');

            if (newlyCached.length > 0) {
              const items = Object.values(cache);
              const toWrite =
                items.length > AMBER_NIP17_CACHE_CAP
                  ? items.sort((a, b) => b.createdAt - a.createdAt).slice(0, AMBER_NIP17_CACHE_CAP)
                  : items;
              const next: Record<string, AmberNip17CacheEntry> = {};
              for (const item of toWrite) next[item.wrapId] = item;
              await AsyncStorage.setItem(AMBER_NIP17_CACHE_KEY, JSON.stringify(next)).catch(
                () => {},
              );
            }
          }
        }

        // Identity-change guard: if the user logged out or switched signer
        // while we were mid-flight, don't leak these entries into a
        // different session's state.
        if (refreshForPubkey !== pubkey || refreshForSigner !== signerType) return;

        setDmInbox(entries);
      } catch (error) {
        if (__DEV__) console.warn('[Nostr] refreshDmInbox failed:', error);
      } finally {
        setDmInboxLoading(false);
      }
    })();

    dmInboxInFlight.current = task;
    try {
      await task;
    } finally {
      dmInboxInFlight.current = null;
    }
  }, [
    pubkey,
    isLoggedIn,
    signerType,
    getReadRelays,
    followPubkeys,
    decryptNip04ViaSigner,
    amberNip44DecryptSilent,
  ]);

  useEffect(() => {
    if (!isLoggedIn) setDmInbox([]);
  }, [isLoggedIn]);

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
      dmInbox,
      dmInboxLoading,
      refreshDmInbox,
      amberNip44Permission,
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
      dmInbox,
      dmInboxLoading,
      refreshDmInbox,
      amberNip44Permission,
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
