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
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { NostrProfile, NostrContact, RelayConfig, SignerType } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { getUserRelays, setUserRelays, mergeRelays } from '../services/nostrRelayStorage';
import { perAccountKey } from '../services/perAccountStorage';
import {
  loadIdentities,
  upsertIdentity,
  removeIdentity as removeIdentityFromStore,
  setActiveIdentity,
  type StoredIdentity,
} from '../services/identitiesStore';
import { migrateToPerAccountStorage } from '../services/migrateToPerAccountStorage';
import { perfLog } from '../utils/perfLog';
import {
  setActivePubkeyForWalletStorage,
  deleteNwcUrl,
  deleteXpub,
  deleteMnemonic,
} from '../services/walletStorageService';
import { NSEC_KEY, PUBKEY_KEY, SIGNER_TYPE_KEY } from './nostrAuthKeys';
import { useMessageSend } from './useMessageSend';
import type { EncryptedUpload } from '../services/imageUploadService';
import { nip04PlaintextCache, clearMemoisedSecretKey } from './nostrSecretKeyCache';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  wrapCacheFileName,
  AMBER_NIP17_ENABLED_KEY_LEGACY,
  DM_CONV_CACHE_PREFIX,
  DM_CONV_LAST_SEEN_PREFIX,
  inboxCacheKey,
  inboxLastSeenKey,
} from './nostrDmCache';
import { useDmInbox } from './useDmInbox';
import { useGroupMessaging } from './useGroupMessaging';
import { useCacheNotifications } from './useCacheNotifications';
import {
  CONTACTS_CACHE_KEY_BASE,
  PROFILES_CACHE_KEY_BASE,
  CACHE_TIMESTAMP_KEY_BASE,
  CONTACTS_TIMESTAMP_KEY_BASE,
  OWN_PROFILE_CACHE_KEY_BASE,
  OWN_PROFILE_TIMESTAMP_KEY_BASE,
  RELAY_LIST_CACHE_KEY_BASE,
  RELAY_LIST_TIMESTAMP_KEY_BASE,
  CACHE_MAX_AGE_MS,
  MISSING_PROFILE_RETRY_MS,
  readCachedWithTtl,
} from './nostrCacheKeys';
import type { RefreshDmInboxOptions, SignedEvent, ConversationMessage } from './nostrContextTypes';

export { OWN_PROFILE_CACHE_KEY_BASE } from './nostrCacheKeys';
export { notifyGroupMessage, subscribeGroupMessages, subscribeDmMessages } from './nostrEventBus';
export type { RefreshDmInboxOptions, SignedEvent, ConversationMessage } from './nostrContextTypes';

interface NostrContextType {
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  /** Logged-in user's hex pubkey, or null when logged out. */
  pubkey: string | null;
  profile: NostrProfile | null;
  contacts: NostrContact[];
  relays: RelayConfig[];
  /**
   * Relays the user has explicitly added in-app via the Nostr settings
   * screen (#202). Subset of `relays` — exposed separately so the
   * editor UI can distinguish user-managed rows (removable) from
   * NIP-65 / default rows (read-only here; users edit those via
   * another Nostr client for now).
   */
  userRelays: RelayConfig[];
  /**
   * Add or update a user-managed relay. Replaces any existing entry
   * with the same URL (so toggling read/write on an existing user
   * relay works through the same call). Persists to AsyncStorage.
   */
  addUserRelay: (config: RelayConfig) => Promise<void>;
  /** Remove a user-managed relay by URL. Persists to AsyncStorage. */
  removeUserRelay: (url: string) => Promise<void>;
  signerType: SignerType | null;
  // Multi-account registry — every signed-in identity on this device.
  // Drives the drawer header switcher and the AccountSwitcherSheet
  // (#288). The active identity is the one whose `pubkey` matches the
  // `pubkey` field above; everything else is "warm in the drawer".
  identities: StoredIdentity[];
  // Flip the active identity to a registered one. No-op if pubkey is
  // already active or unknown to the registry. Tears down in-memory
  // state for the previous identity but keeps its disk caches around
  // so a switch back is instant.
  switchIdentity: (pubkey: string) => Promise<void>;
  // Remove a single identity from the registry. If it's the active
  // one, behaves like `logout` (with a successor switch if available);
  // otherwise wipes that identity's caches + entry, leaves active alone.
  signOutIdentity: (pubkey: string) => Promise<void>;
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
  // Fetch kind-0 profiles for arbitrary pubkeys (non-followed DM senders) (#664).
  fetchProfilesForPubkeys: (pubkeys: string[]) => Promise<Map<string, NostrProfile>>;
  signZapRequest: (
    recipientPubkey: string,
    amountSats: number,
    comment: string,
    // Optional kind-1/7516/etc event id to scope the zap to a single
    // note. When set, the resulting 9735 receipt carries the same `e`
    // tag — enables per-note aggregation (e.g. zaps-received pill on
    // find-log rows). Omit for plain zap-the-author flows.
    zapEventId?: string,
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
  addContact: (
    npubOrHex: string,
  ) => Promise<
    | { success: true; pubkey: string; alreadyFollowing?: boolean }
    | { success: false; error: string }
  >;
  sendDirectMessage: (
    recipientPubkey: string,
    plaintext: string,
  ) => Promise<{ success: boolean; error?: string }>;
  /**
   * Send an encrypted NIP-17 kind-15 file message (e.g. a voice note) to a
   * 1:1 recipient. The blob is already AES-encrypted + uploaded; this
   * gift-wraps the URL + decryption key. See #235.
   */
  sendFileMessage: (
    recipientPubkey: string,
    file: EncryptedUpload,
  ) => Promise<{ success: boolean; error?: string }>;
  /**
   * Persist an optimistic local- DM message to the per-conversation
   * cache so it survives navigating away + back before the NIP-17
   * self-wrap echo arrives. The matching merge dedup against the real
   * relay echo lives in `mergeConversationMessages`. Without this,
   * leaving the thread after sending a GIF (or any message) would
   * drop the optimistic bubble until the relay round-trip completes.
   */
  appendLocalDmMessage: (otherPubkey: string, msg: ConversationMessage) => Promise<void>;
  /**
   * Send a NIP-17 group chat message to multiple recipients. Builds one
   * kind-14 rumor with `subject` + `p` tags for every member, then NIP-59
   * seal+wraps it once per recipient (including the sender for cross-device
   * visibility). NSEC-only — Amber group send is a follow-up. See PR #227.
   */
  sendGroupMessage: (input: {
    groupId: string;
    subject: string;
    memberPubkeys: string[];
    text?: string;
    /** Encrypted NIP-17 kind-15 file message (voice note) sent to the group. */
    file?: EncryptedUpload;
  }) => Promise<{ success: boolean; wrapsPublished?: number; error?: string }>;
  /**
   * Publish a parameterised-replaceable kind-30200 group-state event for
   * client-side group consensus. Idempotent on (creator, d-tag) — relays
   * keep only the latest per the NIP-33 spec.
   */
  publishGroupState: (input: {
    groupId: string;
    name: string;
    memberPubkeys: string[];
  }) => Promise<{ success: boolean; error?: string }>;
  fetchConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  /**
   * Read the persisted per-peer conversation cache synchronously-ish
   * (AsyncStorage is actually async but single `getItem` is fast).
   * Returns `[]` when no cache exists. Use this to paint a thread's
   * cached messages instantly on mount, *before* awaiting the slower
   * `fetchConversation` relay round-trip — Arcade's `db_only=true`
   * pattern. The user sees the thread fill immediately, then a fresh
   * merge replaces it once relay returns.
   */
  getCachedConversation: (otherPubkey: string) => Promise<ConversationMessage[]>;
  dmInbox: DmInboxEntry[];
  dmInboxLoading: boolean;
  /**
   * Refresh the NIP-04 + NIP-17 DM inbox from read relays.
   *
   * Default (no arg / `force: false`): honours a 30s TTL — calls
   * within that window are no-ops. Safe to call from
   * `useFocusEffect` on the Messages tab without racking up relay
   * round-trips on every tab bounce.
   *
   * `force: true`: bypass the TTL and hit relays. Reserved for
   * explicit user-initiated refreshes (pull-to-refresh).
   *
   * `signal`: optional AbortSignal for cancelling the in-flight
   * refresh. Checked between batches in the decrypt loops so a
   * navigation-away can stop the JS-thread churn (#286). Aborting
   * is best-effort — a refresh that's mid-batch will finish that
   * batch (≤ DECRYPT_YIELD_EVERY items) before bailing out.
   */
  refreshDmInbox: (opts?: RefreshDmInboxOptions) => Promise<void>;
  /**
   * Arm the live NIP-17 DM subscription. Idempotent. Call from any
   * DM-receiving screen (Messages tab, ConversationScreen) via
   * useFocusEffect — first call opens the sub, subsequent are no-ops.
   * Cold-boot does NOT arm the sub by itself, so Home stays responsive.
   */
  armLiveDmSub: () => void;
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

const NostrContext = createContext<NostrContextType | undefined>(undefined);

// Module-evaluation perf marker. Fires the first time this file is parsed,
// before any provider mounts. Catches "RN bundle finished loading,
// JS engine started executing our code" — the upstream of every other
// [Perf] line in this file.
perfLog('NostrContext module-eval');

let __nostrProviderFirstRenderLogged = false;
let __nostrProviderLoggedInLogged = false;
export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!__nostrProviderFirstRenderLogged) {
    __nostrProviderFirstRenderLogged = true;
    perfLog('NostrProvider first render');
  }
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [contacts, setContacts] = useState<NostrContact[]>([]);
  // `nip65Relays` mirrors the user's published kind-10002 list (or the
  // last cached snapshot of it). `userRelays` are explicit in-app
  // overrides persisted to AsyncStorage by the Nostr settings screen
  // (#202). The exposed `relays` memo is the merge — defaults +
  // NIP-65 + user overrides — so every existing read/write filter
  // call site picks up user-added relays without further plumbing.
  const [nip65Relays, setNip65Relays] = useState<RelayConfig[]>([]);
  const [userRelays, setUserRelaysState] = useState<RelayConfig[]>([]);
  const relays = useMemo(
    () => mergeRelays({ nip65: nip65Relays, user: userRelays }),
    [nip65Relays, userRelays],
  );
  const [signerType, setSignerType] = useState<SignerType | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  // Multi-account registry (#288). Mirrors the SecureStore `identities_v1`
  // blob so the drawer header and AccountSwitcherSheet can render without
  // each rendering its own SecureStore round-trip. The `pubkey` state above
  // is the single source of truth for "who is the active identity"; this
  // array is the side-table of all signed-in identities for the switcher.
  const [identities, setIdentities] = useState<StoredIdentity[]>([]);

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
  // read it without introducing a circular provider dependency. Same
  // mirror is needed for `walletStorageService` — its module-level
  // `walletListKey()` reads from this published value to pick the
  // correct per-account `wallet_list_${pk}` AsyncStorage key (#288).
  useEffect(() => {
    nostrService.setCurrentUserPubkey(pubkey);
    setActivePubkeyForWalletStorage(pubkey);
  }, [pubkey]);

  // Hydrate the user-added relay overrides once at mount. Persisted
  // separately from the NIP-65 cache so they survive logout/login and
  // are available before any relay round-trip completes.
  useEffect(() => {
    getUserRelays()
      .then((list) => {
        if (list.length > 0) setUserRelaysState(list);
      })
      .catch((e) => console.warn('[Nostr] failed to load user relays:', e));
  }, []);

  const addUserRelay = useCallback(
    async (config: RelayConfig): Promise<void> => {
      const next: RelayConfig[] = (() => {
        const existing = userRelays.findIndex((r) => r.url === config.url);
        if (existing >= 0) {
          const copy = [...userRelays];
          copy[existing] = config;
          return copy;
        }
        return [...userRelays, config];
      })();
      // Persist before updating React state so a failed write doesn't
      // leave the UI showing a row that will disappear on next reload.
      // The caller surfaces the thrown error to the user.
      await setUserRelays(next);
      setUserRelaysState(next);
    },
    [userRelays],
  );

  const removeUserRelay = useCallback(
    async (url: string): Promise<void> => {
      const next = userRelays.filter((r) => r.url !== url);
      // Persist before updating React state so a failed write doesn't
      // leave the UI looking like the row was removed when it'll be
      // back after a restart.
      await setUserRelays(next);
      setUserRelaysState(next);
    },
    [userRelays],
  );

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

  // DM inbox + conversation cluster (#703). State, refs, callbacks, and
  // the live-DM subscription effect for the NIP-04/NIP-17 inbox live in
  // `useDmInbox`. The provider threads in the identity + relay + follow
  // dependencies these paths close over, and re-exposes the returned
  // values through the context value below. `setDmInbox`,
  // `setAmberNip44Permission`, `hydrateDmInboxFromCache`, and
  // `knownWrapIdsRef` are consumed by the login / logout / switch-identity
  // flows that own those lifecycle transitions.
  const {
    dmInbox,
    dmInboxLoading,
    refreshDmInbox,
    fetchConversation,
    getCachedConversation,
    appendLocalDmMessage,
    armLiveDmSub,
    amberNip44Permission,
    hydrateDmInboxFromCache,
    setDmInbox,
    setAmberNip44Permission,
    knownWrapIdsRef,
  } = useDmInbox({ pubkey, isLoggedIn, signerType, followPubkeys, getReadRelays });

  // Group-messaging cluster (#707). The NIP-17 group send + kind-30200
  // group-state publish callbacks live in `useGroupMessaging`. The provider
  // threads in the identity + relay dependencies these close over and
  // re-exposes the returned callbacks through the context value below.
  const { sendGroupMessage, publishGroupState } = useGroupMessaging({
    pubkey,
    isLoggedIn,
    signerType,
    relays,
  });

  // Find-log notifications (#740) — live kind-1111 sub against the
  // viewer's cache coordinates. Sibling to `useDmInbox`'s live sub;
  // fires `fireCacheNotification` per fresh arrival.
  useCacheNotifications({ pubkey, getReadRelays });

  const loadProfile = useCallback(
    async (pk: string, relayUrls: string[], opts?: { force?: boolean }) => {
      const t0 = Date.now();
      // Cache-fresh fast path: hydrate UI from cache and skip the relay RTT.
      // `force` bypasses it for user-initiated refreshes.
      const { value: cached, ageMs } = await readCachedWithTtl<NostrProfile>(
        perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pk),
        perAccountKey(OWN_PROFILE_TIMESTAMP_KEY_BASE, pk),
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
          AsyncStorage.setItem(
            perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pk),
            JSON.stringify(fetchedProfile),
          ).catch(() => {});
          AsyncStorage.setItem(
            perAccountKey(OWN_PROFILE_TIMESTAMP_KEY_BASE, pk),
            Date.now().toString(),
          ).catch(() => {});
        });
      }
    },
    [],
  );

  // Batch-fetch kind-0 profiles for arbitrary pubkeys (e.g. non-followed DM
  // senders, which `loadContacts`/`fetchProfiles` never fetch). Reads from the
  // user's relays; nostrService.fetchProfiles unions PROFILE_RELAYS for
  // coverage. Returns a pubkey→profile map; the caller owns caching (#664).
  const fetchProfilesForPubkeys = useCallback(
    async (pubkeys: string[]): Promise<Map<string, NostrProfile>> => {
      if (pubkeys.length === 0) return new Map();
      return nostrService.fetchProfiles(pubkeys, getReadRelays());
    },
    [getReadRelays],
  );

  /** Eagerly hydrate own `profile` state from the per-account cache so
   * the drawer header + tab profile avatar paint on cold start without
   * waiting for the deferred `loadProfile` relay round-trip. Matches the
   * pattern of `loadContactsFromCache`. The cache-fresh setProfile-from-
   * cache was previously only happening inside the deferred `loadProfile`
   * fast path, which meant a fresh cold-start with grace-window deferral
   * left `profile` null for ~1.5 s. */
  const loadProfileFromCache = useCallback(async (pk: string) => {
    try {
      const raw = await AsyncStorage.getItem(perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pk));
      if (!raw) return false;
      const cached = JSON.parse(raw) as NostrProfile;
      setProfile(cached);
      return true;
    } catch (error) {
      console.warn('Failed to load profile cache:', error);
      return false;
    }
  }, []);

  /** Eagerly hydrate `relays` state from the per-account cache so
   * relay-dependent fan-out (kind-0 publish, NIP-17 send) uses the
   * user's actual relays from the very first action instead of
   * defaulting to `DEFAULT_RELAYS`. Same pattern as
   * `loadProfileFromCache`. */
  const loadRelaysFromCache = useCallback(async (pk: string) => {
    try {
      const raw = await AsyncStorage.getItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk));
      if (!raw) return false;
      const cached = JSON.parse(raw) as RelayConfig[];
      if (!Array.isArray(cached)) return false;
      // Cached relay-list is the NIP-65 slice; the user overrides are
      // hydrated separately by the `getUserRelays()` effect.
      setNip65Relays(cached);
      return true;
    } catch (error) {
      console.warn('Failed to load relays cache:', error);
      return false;
    }
  }, []);

  const loadContactsFromCache = useCallback(async (pk: string) => {
    try {
      const t0 = Date.now();
      perfLog('loadContactsFromCache: start');
      const contactsKey = perAccountKey(CONTACTS_CACHE_KEY_BASE, pk);
      const profilesKey = perAccountKey(PROFILES_CACHE_KEY_BASE, pk);
      const contactsTsKey = perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pk);
      const pairs = await AsyncStorage.multiGet([contactsKey, profilesKey, contactsTsKey]);
      perfLog('loadContactsFromCache: multiGet returned');
      let contactsJson: string | null = null;
      let profilesJson: string | null = null;
      let contactsTsStr: string | null = null;
      for (const [k, v] of pairs) {
        if (k === contactsKey) contactsJson = v;
        else if (k === profilesKey) profilesJson = v;
        else if (k === contactsTsKey) contactsTsStr = v;
      }
      perfLog(
        `loadContactsFromCache: blob sizes contacts=${contactsJson?.length ?? 0}B profiles=${profilesJson?.length ?? 0}B`,
      );
      // Previously: any contacts cache older than 24h short-circuited the
      // whole bootstrap, discarding the still-useful profile map and
      // painting an empty Friends tab while `loadContacts` ran the relay
      // fetch (#642). Even a stale follow list is a better first paint
      // than nothing — the relay refresh will overwrite it in seconds via
      // the stale-while-revalidate path in `loadContacts`. Profiles in
      // particular are identity data that change rarely; preserving them
      // means the per-row zap gate hydrates from cache instead of reading
      // `lightningAddress: null` for every contact during the kind-0
      // batch refetch.
      if (contactsTsStr && Date.now() - parseInt(contactsTsStr, 10) > CACHE_MAX_AGE_MS) {
        perfLog(
          'loadContactsFromCache: contacts cache stale, still hydrating from disk (relay refresh will reconcile)',
        );
      }
      if (contactsJson) {
        const tParse = Date.now();
        const cached: NostrContact[] = JSON.parse(contactsJson);
        perfLog(`loadContactsFromCache: JSON.parse(contacts) ${Date.now() - tParse}ms`);
        if (profilesJson) {
          const tProfilesParse = Date.now();
          const profileMap: Record<string, NostrProfile> = JSON.parse(profilesJson);
          perfLog(`loadContactsFromCache: JSON.parse(profiles) ${Date.now() - tProfilesParse}ms`);
          const tMerge = Date.now();
          const withProfiles = cached.map((c) => ({
            ...c,
            profile: profileMap[c.pubkey] ?? c.profile,
          }));
          perfLog(
            `loadContactsFromCache: merge ${withProfiles.length} contacts ${Date.now() - tMerge}ms`,
          );
          startTransition(() => setContacts(withProfiles));
          perfLog(`loadContactsFromCache: setContacts dispatched (total ${Date.now() - t0}ms)`);
        } else {
          startTransition(() => setContacts(cached));
          perfLog(
            `loadContactsFromCache: setContacts (no profiles) dispatched (total ${Date.now() - t0}ms)`,
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
        readCachedWithTtl<NostrContact[]>(
          perAccountKey(CONTACTS_CACHE_KEY_BASE, pk),
          perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pk),
        ),
        readCachedWithTtl<Record<string, NostrProfile>>(
          perAccountKey(PROFILES_CACHE_KEY_BASE, pk),
          perAccountKey(CACHE_TIMESTAMP_KEY_BASE, pk),
        ),
      ]);
      const cachedProfileMap = cachedProfileMapOrNull ?? {};
      const contactsCacheFresh = !opts?.force && contactsAgeMs < CACHE_MAX_AGE_MS;
      const cacheFresh = cacheAgeMs < CACHE_MAX_AGE_MS;

      // Persist relay-fetched contacts back to AsyncStorage. Hoisted so
      // both the stale-while-revalidate path and the no-cache path can
      // call it.
      const persistContacts = (contacts: NostrContact[]): void => {
        InteractionManager.runAfterInteractions(() => {
          AsyncStorage.setItem(
            perAccountKey(CONTACTS_CACHE_KEY_BASE, pk),
            JSON.stringify(contacts),
          ).catch(() => {});
          AsyncStorage.setItem(
            perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pk),
            Date.now().toString(),
          ).catch(() => {});
        });
      };

      let fetchedContacts: NostrContact[];
      if (contactsCacheFresh && cachedContacts) {
        // Cache fully fresh — skip the relay fetch entirely.
        fetchedContacts = cachedContacts;
        if (__DEV__)
          console.log(
            `[Nostr] fetchContactList: skipped (cache fresh @ ${Math.round(contactsAgeMs / 1000)}s old, ${fetchedContacts.length} contacts)`,
          );
      } else if (cachedContacts && !opts?.force) {
        // Stale-while-revalidate: paint immediately from the (stale)
        // cache so the follow-gate / Friends tab / contact-tab UIs
        // surface useful data within ms of app open instead of waiting
        // for the relay fetch (#372 — that wait was ~53s on cold start).
        // The relay fetch fires in the background and overwrites the
        // cache + state when it returns.
        fetchedContacts = cachedContacts;
        if (__DEV__)
          console.log(
            `[Nostr] fetchContactList: stale-while-revalidate (${Math.round(contactsAgeMs / 1000)}s old, ${fetchedContacts.length} contacts) — refreshing in background`,
          );
        nostrService
          .fetchContactList(pk, relayUrls)
          .then((fresh) => {
            // null = network couldn't produce a kind-3; keep the cached
            // value, don't touch the timestamp. An empty array is a
            // legitimate state (user follows nobody) and DOES persist
            // so the cache reflects truth and the timestamp bumps.
            if (fresh === null) return;
            if (__DEV__)
              console.log(
                `[Nostr] fetchContactList background refresh: ${Date.now() - t0}ms, ${fresh.length} contacts`,
              );
            persistContacts(fresh);
            startTransition(() =>
              setContacts(
                fresh.map((c) => ({
                  ...c,
                  profile: cachedProfileMap[c.pubkey] ?? c.profile,
                })),
              ),
            );
          })
          .catch(() => {
            /* silent — caller already painted from cache */
          });
      } else {
        // No cache (or forced refresh) — must block on the relay fetch.
        // fetchContactList itself is now race-to-first (resolves on the
        // first matching event from any relay), so this typically lands
        // in <2s instead of waiting for every relay's EOSE.
        const fetched = await nostrService.fetchContactList(pk, relayUrls, {
          onLatest: (newer) => {
            // A newer kind-3 arrived during the keep-open window after
            // first paint — re-render and overwrite the cache. Fires
            // once at sub close, after our await has resumed and our
            // own persistContacts has run, so we're safely "newer".
            persistContacts(newer);
            startTransition(() =>
              setContacts(
                newer.map((c) => ({
                  ...c,
                  profile: cachedProfileMap[c.pubkey] ?? c.profile,
                })),
              ),
            );
          },
        });
        if (fetched === null) {
          // Relay timeout with no cached fallback — paint empty for
          // now and do NOT persist (so we don't poison the cache with
          // a network blip).
          fetchedContacts = [];
          if (__DEV__)
            console.log(
              `[Nostr] fetchContactList: timed out, ${Date.now() - t0}ms, painting empty (cache untouched)`,
            );
        } else {
          fetchedContacts = fetched;
          if (__DEV__)
            console.log(
              `[Nostr] fetchContactList: ${Date.now() - t0}ms, ${fetchedContacts.length} contacts`,
            );
          persistContacts(fetchedContacts);
        }
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
        AsyncStorage.setItem(
          perAccountKey(PROFILES_CACHE_KEY_BASE, pk),
          JSON.stringify(merged),
        ).catch(() => {});
        AsyncStorage.setItem(
          perAccountKey(CACHE_TIMESTAMP_KEY_BASE, pk),
          Date.now().toString(),
        ).catch(() => {});
      });
    },
    [],
  );

  const loadRelays = useCallback(async (pk: string): Promise<string[]> => {
    const t0 = Date.now();
    // Cache-fresh fast path — NIP-65 relay lists rarely change, so serve
    // from cache when under the TTL and skip the ~3s relay round trip.
    const { value: cached, ageMs } = await readCachedWithTtl<RelayConfig[]>(
      perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk),
      perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
    );
    if (cached && ageMs < CACHE_MAX_AGE_MS) {
      setNip65Relays(cached);
      if (__DEV__) console.log(`[Nostr] fetchRelayList: skipped (cache fresh)`);
      const readRelays = cached.filter((r) => r.read).map((r) => r.url);
      return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
    }
    const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
    if (relayList === null) {
      // Network couldn't produce a kind-10002 — fall back to defaults
      // and DON'T persist (so we don't poison the cache with a blip).
      if (__DEV__) console.log(`[Nostr] fetchRelayList: timed out, using defaults`);
      return nostrService.DEFAULT_RELAYS;
    }
    if (__DEV__)
      console.log(`[Nostr] fetchRelayList: ${Date.now() - t0}ms, ${relayList.length} relays`);
    setNip65Relays(relayList);
    InteractionManager.runAfterInteractions(() => {
      AsyncStorage.setItem(
        perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk),
        JSON.stringify(relayList),
      ).catch(() => {});
      AsyncStorage.setItem(
        perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
        Date.now().toString(),
      ).catch(() => {});
    });
    const readRelays = relayList.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, []);

  // Single-fire perf log when isLoggedIn becomes true — the
  // "login restored from cache" moment. Anchor for the boot path.
  useEffect(() => {
    if (isLoggedIn && !__nostrProviderLoggedInLogged) {
      __nostrProviderLoggedInLogged = true;
      perfLog('NostrProvider isLoggedIn=true');
    }
  }, [isLoggedIn]);

  // Auto-login on startup: load cache immediately, refresh from relays in background
  useEffect(() => {
    perfLog('NostrProvider auto-login effect fires');
    (async () => {
      try {
        // Hydrate the multi-account registry first so the switcher has
        // something to render even before the active identity finishes
        // loading. Empty array on a fresh install — the auto-login below
        // populates it when the legacy single-account keys are migrated.
        const blob = await loadIdentities();
        setIdentities(blob.identities);

        const storedSignerType = await SecureStore.getItemAsync(SIGNER_TYPE_KEY);
        let pk: string | null = null;

        let pendingNsec: string | null = null;
        if (storedSignerType === 'nsec') {
          const storedNsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (storedNsec) {
            pk = nostrService.decodeNsec(storedNsec).pubkey;
            pendingNsec = storedNsec;
          }
        } else if (storedSignerType === 'amber') {
          const storedPubkey = await SecureStore.getItemAsync(PUBKEY_KEY);
          if (storedPubkey) {
            pk = storedPubkey;
          }
        }

        if (!pk) return;

        // One-time per-account storage migration (#288). MUST run before
        // `setPubkey(pk)` below because `setPubkey` triggers the effect
        // that calls `setActivePubkeyForWalletStorage(pubkey)` — which
        // unblocks `awaitActivePubkeyHydrated()` in WalletContext. If
        // the migration runs AFTER setPubkey, WalletContext can race
        // ahead and read `wallet_list_${pk}` before the migration has
        // copied legacy `wallet_list` → `wallet_list_${pk}` (#442
        // Copilot review). Self-contained in
        // `migrateToPerAccountStorage`: runs once, copies legacy global
        // values to `${base}_${pk}`, sets a flag, short-circuits
        // afterwards. Adds <50 ms to cold start.
        try {
          const result = await migrateToPerAccountStorage(pk);
          if (__DEV__ && !result.alreadyDone) {
            console.log(
              `[Nostr] per-account storage migration: copied ${result.ranSteps} keys`,
              result.copiedKeys,
            );
          }
        } catch (e) {
          console.warn('[Nostr] per-account storage migration failed:', e);
        }

        // Now safe to publish the pubkey + signer type — WalletContext's
        // gate will unblock and the per-account `wallet_list_${pk}` is
        // already populated (whether by migration just above or by an
        // earlier run that short-circuited).
        setPubkey(pk);
        if (storedSignerType === 'nsec') {
          setSignerType('nsec');
          setIsLoggedIn(true);
          if (!blob.identities.some((i) => i.pubkey === pk) && pendingNsec) {
            const next = await upsertIdentity({
              pubkey: pk,
              signerType: 'nsec',
              nsec: pendingNsec,
              lastUsedAt: Date.now(),
            });
            setIdentities(next.identities);
          }
        } else if (storedSignerType === 'amber') {
          setSignerType('amber');
          setIsLoggedIn(true);
          if (!blob.identities.some((i) => i.pubkey === pk)) {
            const next = await upsertIdentity({
              pubkey: pk,
              signerType: 'amber',
              lastUsedAt: Date.now(),
            });
            setIdentities(next.identities);
          }
        }

        // Eagerly hydrate cached state from disk in parallel — these
        // are all small per-account AsyncStorage reads (<100 ms each)
        // and they wire UI surfaces that would otherwise stay empty
        // until the deferred parallel refresh fires:
        //   - `profile` → drawer header + tab profile avatar
        //   - `relays`  → relay-dependent fan-out (kind-0 publish,
        //                 NIP-17 send, group membership republish)
        //   - `contacts` → friends list + DM partner resolution
        //   - `dmInbox`  → Messages tab paints on first frame
        // Previously only contacts + dmInbox were sync-hydrated; the
        // grace window before the deferred refresh left profile +
        // relays null for ~1.5 s after Home rendered, which made
        // drawer-header avatars and relay-aware code paths see empty
        // state on cold start. (Followup of perf review on PR #495.)
        await Promise.all([
          loadProfileFromCache(pk),
          loadRelaysFromCache(pk),
          loadContactsFromCache(pk),
          hydrateDmInboxFromCache(pk),
        ]);

        // Defer relay fetches until after animations/rendering complete,
        // PLUS a 1500 ms grace window so the user can tap Send / Receive
        // / Transfer in the first ~1.5 s of cold-start without the JS
        // thread being yanked away by parallel kind-3 + kind-0 +
        // kind-10002 fetches. `runAfterInteractions` alone fires on the
        // next tick when nothing is registered, so it doesn't actually
        // give us breathing room here. The setTimeout pulls the bulk
        // refresh out of the cold-start critical path entirely — the
        // "Send sheet feels frozen for the first few seconds" symptom
        // tracked in perf logcats lined up exactly with this batch
        // running back-to-back with the inbox drain on the JS thread.
        //
        // Seed the working relay set from the cached NIP-65 relay list so
        // `loadProfile` / `loadContacts` hit the relays the user actually
        // publishes to — not `DEFAULT_RELAYS`, which might miss their
        // kind-0/kind-3 entirely. Only falls back to DEFAULT_RELAYS on
        // the very first login (before any relay cache exists).
        const COLD_START_GRACE_MS = 1500;
        setTimeout(() => {
          InteractionManager.runAfterInteractions(async () => {
            let workingRelays: string[] = nostrService.DEFAULT_RELAYS;
            // Ignore the timestamp here — even a stale cached relay list is
            // better than DEFAULT_RELAYS for reaching user-only relays.
            const { value: cachedRelays } = await readCachedWithTtl<RelayConfig[]>(
              perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk!),
              perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk!),
            );
            if (cachedRelays) {
              const readRelays = cachedRelays.filter((r) => r.read).map((r) => r.url);
              if (readRelays.length > 0) workingRelays = readRelays;
            }

            const t0 = Date.now();
            // [PerfBlock] per-loader timing — `parallel refresh` shows
            // total wall-clock but masks which of the three loaders is
            // the bottleneck. These per-loader markers let us see
            // (a) which finishes last (slowest relay path) and (b)
            // which one's resolution kicks off the heavy setState
            // chain that follows. #554.
            const __tR = Date.now();
            const __tP = Date.now();
            const __tC = Date.now();
            Promise.all([
              loadRelays(pk!)
                .catch((e) => console.warn('[Nostr] relay refresh failed:', e))
                .finally(() => console.log(`[PerfBlock] loadRelays: ${Date.now() - __tR}ms`)),
              loadProfile(pk!, workingRelays)
                .catch((e) => console.warn('[Nostr] profile refresh failed:', e))
                .finally(() => console.log(`[PerfBlock] loadProfile: ${Date.now() - __tP}ms`)),
              loadContacts(pk!, workingRelays)
                .catch((e) => console.warn('[Nostr] contact refresh failed:', e))
                .finally(() => console.log(`[PerfBlock] loadContacts: ${Date.now() - __tC}ms`)),
            ]).then(() => {
              if (__DEV__) console.log(`[Nostr] parallel refresh complete in ${Date.now() - t0}ms`);
            });
          });
        }, COLD_START_GRACE_MS);
      } catch (error) {
        console.warn('Nostr auto-login failed:', error);
      }
    })();
  }, [
    loadRelays,
    loadProfile,
    loadContacts,
    loadProfileFromCache,
    loadRelaysFromCache,
    loadContactsFromCache,
    hydrateDmInboxFromCache,
  ]);

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

        // Store credentials in the legacy single-active-identity slots
        // (still the canonical location every other consumer reads from)
        // AND register the identity in the multi-account store so the
        // switcher knows it exists (#288).
        await SecureStore.setItemAsync(NSEC_KEY, trimmed);
        await SecureStore.setItemAsync(SIGNER_TYPE_KEY, 'nsec');
        const next = await upsertIdentity({
          pubkey: pk,
          signerType: 'nsec',
          nsec: trimmed,
          lastUsedAt: Date.now(),
        });
        setIdentities(next.identities);

        setSignerType('nsec');
        setIsLoggedIn(true);
        setIsLoggingIn(false);

        // First-launch migration for this identity — idempotent flag
        // means this is a no-op once the user has migrated on any
        // previous login.
        try {
          await migrateToPerAccountStorage(pk);
        } catch (e) {
          if (__DEV__) console.warn('[Nostr] per-account migration on login failed:', e);
        }

        // Load cached contacts immediately, fetch fresh data in background
        await loadContactsFromCache(pk);
        // Eagerly hydrate dmInbox from disk cache so Messages tab paints
        // on first focus instead of staying blank for the relay round-trip.
        await hydrateDmInboxFromCache(pk);
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
    [loadRelays, loadProfile, loadContacts, loadContactsFromCache, hydrateDmInboxFromCache],
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
      const next = await upsertIdentity({
        pubkey: pk,
        signerType: 'amber',
        lastUsedAt: Date.now(),
      });
      setIdentities(next.identities);

      setSignerType('amber');
      setIsLoggedIn(true);
      setIsLoggingIn(false);

      try {
        await migrateToPerAccountStorage(pk);
      } catch (e) {
        if (__DEV__) console.warn('[Nostr] per-account migration on login failed:', e);
      }

      // Load cached contacts immediately, fetch fresh data in background
      await loadContactsFromCache(pk);
      // Eagerly hydrate dmInbox from disk cache so Messages tab paints
      // on first focus instead of staying blank for the relay round-trip.
      await hydrateDmInboxFromCache(pk);
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
  }, [loadRelays, loadProfile, loadContacts, loadContactsFromCache, hydrateDmInboxFromCache]);

  // Wipe every per-account AsyncStorage entry for `loggedOutPubkey`.
  // Extracted so the multi-account sign-out path can call it without
  // coupling to the active-identity teardown logic (#288).
  const wipeAccountCaches = useCallback(async (loggedOutPubkey: string | null) => {
    if (!loggedOutPubkey) return;
    // Read the per-account wallet list FIRST so we can delete the
    // per-wallet secrets that live in SecureStore (NWC URLs, xpubs,
    // mnemonics) and the per-wallet AsyncStorage tx caches. Without
    // this, signing out of an identity leaves orphaned credentials
    // and tx caches under their walletIds — a real privacy concern
    // on shared devices and what Copilot flagged on #442.
    const walletListKey = `wallet_list_${loggedOutPubkey}`;
    let walletIds: string[] = [];
    try {
      const json = await AsyncStorage.getItem(walletListKey);
      if (json) {
        const list = JSON.parse(json) as Array<{ id: string }>;
        if (Array.isArray(list)) walletIds = list.map((w) => w.id).filter(Boolean);
      }
    } catch {
      // Corrupted wallet list — nothing we can clean per-wallet,
      // but the AsyncStorage.multiRemove below still kills the list
      // entry itself so a future load won't surface it.
    }
    // Per-wallet secret cleanup. Each delete is best-effort; an
    // already-absent key is a no-op in expo-secure-store, so we
    // can fan out concurrently without sequencing.
    await Promise.allSettled(
      walletIds.flatMap((id) => [deleteNwcUrl(id), deleteXpub(id), deleteMnemonic(id)]),
    );

    const toRemove: string[] = [
      // Per-account namespaced caches (#288 storage refactor)
      perAccountKey(CONTACTS_CACHE_KEY_BASE, loggedOutPubkey),
      perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, loggedOutPubkey),
      perAccountKey(PROFILES_CACHE_KEY_BASE, loggedOutPubkey),
      perAccountKey(CACHE_TIMESTAMP_KEY_BASE, loggedOutPubkey),
      perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, loggedOutPubkey),
      perAccountKey(OWN_PROFILE_TIMESTAMP_KEY_BASE, loggedOutPubkey),
      perAccountKey(RELAY_LIST_CACHE_KEY_BASE, loggedOutPubkey),
      perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, loggedOutPubkey),
      perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, loggedOutPubkey),
      perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, loggedOutPubkey),
      // Pre-existing per-pubkey caches (already namespaced before #288)
      inboxCacheKey(loggedOutPubkey),
      inboxLastSeenKey(loggedOutPubkey),
      `nostr_group_activity_${loggedOutPubkey}`,
      `nostr_groups_${loggedOutPubkey}`,
      `groups_following_only_${loggedOutPubkey}`,
      walletListKey,
      // Per-wallet tx caches (AsyncStorage). One key per wallet that
      // was bound to this identity.
      ...walletIds.map((id) => `txs_${id}`),
    ];
    const allKeys = await AsyncStorage.getAllKeys();
    const convPrefix = DM_CONV_CACHE_PREFIX + loggedOutPubkey + '_';
    const lastSeenPrefix = DM_CONV_LAST_SEEN_PREFIX + loggedOutPubkey + '_';
    for (const k of allKeys) {
      if (k.startsWith(convPrefix) || k.startsWith(lastSeenPrefix)) toRemove.push(k);
    }
    // group_messages_${groupId} is keyed by the random group id (not
    // pubkey), so we can't selectively remove "this identity's groups"
    // — they're shared across whichever identities are members. Leave
    // them in place; they're orphaned safely once no remaining identity
    // is a member, and re-attached if the same identity signs back in.
    await AsyncStorage.multiRemove(toRemove);
    // The NIP-17 wrap caches are file-backed now (#689), so the
    // multiRemove above doesn't touch them — delete the files explicitly.
    // Decrypted DM plaintext must not survive logout / account wipe
    // (#689 review / #690).
    if (loggedOutPubkey) {
      for (const base of [AMBER_NIP17_CACHE_KEY_BASE, NSEC_NIP17_CACHE_KEY_BASE]) {
        try {
          const f = new File(
            Paths.document,
            wrapCacheFileName(perAccountKey(base, loggedOutPubkey)),
          );
          if (f.exists) f.delete();
        } catch {
          // best-effort — non-fatal
        }
      }
    }
  }, []);

  const logout = useCallback(async () => {
    clearMemoisedSecretKey();
    setAmberNip44Permission('unknown');
    nip04PlaintextCache.clear();
    // Drop the in-memory NIP-17 wrap-id dedup Set — without this, a
    // sign-out then sign-back-in to the SAME pubkey would keep wrap
    // ids from the prior session alive in memory, and any wrap whose
    // on-disk cache entry got wiped by `wipeAccountCaches` below
    // would be permanently skipped by the live-sub early-return
    // (since the in-memory Set would still claim "seen"). Per Copilot
    // review on #508.
    knownWrapIdsRef.current = { pubkey: null, set: new Set() };
    const loggedOutPubkey = pubkey;
    await SecureStore.deleteItemAsync(NSEC_KEY);
    await SecureStore.deleteItemAsync(PUBKEY_KEY);
    await SecureStore.deleteItemAsync(SIGNER_TYPE_KEY);
    // Clear the dead-key-as-of-#404 amber NIP-17 toggle alongside
    // the per-account caches.
    await AsyncStorage.removeItem(AMBER_NIP17_ENABLED_KEY_LEGACY).catch(() => {});

    await wipeAccountCaches(loggedOutPubkey);

    // Remove this identity from the multi-account registry. If other
    // identities exist the switcher will pick a successor; otherwise
    // we drop into the logged-out state below.
    let nextIdentities: StoredIdentity[] = [];
    let nextActive: string | null = null;
    if (loggedOutPubkey) {
      const blob = await removeIdentityFromStore(loggedOutPubkey);
      nextIdentities = blob.identities;
      nextActive = blob.activePubkey;
    }
    setIdentities(nextIdentities);

    if (nextActive && nextIdentities.length > 0) {
      // Switch to the successor without dropping into the logged-out
      // screen — feels seamless to the user (they sign out of Big Piggy
      // and immediately see Middle Piggy's caches).
      const successor = nextIdentities.find((i) => i.pubkey === nextActive);
      if (successor) {
        await SecureStore.setItemAsync(SIGNER_TYPE_KEY, successor.signerType);
        if (successor.signerType === 'nsec' && successor.nsec) {
          await SecureStore.setItemAsync(NSEC_KEY, successor.nsec);
        } else if (successor.signerType === 'amber') {
          await SecureStore.setItemAsync(PUBKEY_KEY, successor.pubkey);
        }
        setPubkey(successor.pubkey);
        setSignerType(successor.signerType);
        setIsLoggedIn(true);
        // Eagerly hydrate the new identity's caches; the next focus tick
        // will refresh from relays.
        await loadContactsFromCache(successor.pubkey);
        await hydrateDmInboxFromCache(successor.pubkey);
        return;
      }
    }

    setPubkey(null);
    setProfile(null);
    setContacts([]);
    setNip65Relays([]);
    // NOTE: deliberately NOT clearing user-added relays on logout —
    // they're an in-app preference, not per-account secret material.
    // The next account login will see the same overrides. To wipe
    // them, users can remove each row from the Nostr settings screen.
    setSignerType(null);
    setIsLoggedIn(false);

    nostrService.cleanup();
  }, [
    pubkey,
    wipeAccountCaches,
    loadContactsFromCache,
    hydrateDmInboxFromCache,
    setAmberNip44Permission,
    knownWrapIdsRef,
  ]);

  // Flip the active identity to `nextPubkey`. Must already be a
  // registered identity (call `loginWithNsec` / `loginWithAmber`
  // first to add a brand-new one). The flip:
  //   1. Persists the new active in `identities_v1` + the legacy
  //      single-identity SecureStore keys (NSEC/PUBKEY/SIGNER_TYPE),
  //      so a hard restart resumes on the new identity.
  //   2. Tears down the old identity's in-memory state (nip04 cache,
  //      memoised secret, profile, contacts, relays). Persistent
  //      caches are NOT touched — they're keyed per-pubkey, so the
  //      old identity's data stays on disk for the next switch back.
  //   3. Eagerly hydrates the new identity from disk caches so
  //      Friends / Messages tabs paint instantly without waiting for
  //      the relay round-trip.
  //
  // No-op if `nextPubkey === pubkey` (already active) or if the
  // pubkey isn't in the registry.
  const switchIdentity = useCallback(
    async (nextPubkey: string): Promise<void> => {
      if (nextPubkey === pubkey) return;
      const blob = await loadIdentities();
      const target = blob.identities.find((i) => i.pubkey === nextPubkey);
      if (!target) {
        if (__DEV__) console.warn(`[Nostr] switchIdentity: ${nextPubkey} not in registry`);
        return;
      }
      // Tear down the previous identity's in-memory state. Persistent
      // caches (per-account namespaced) are kept on disk so a switch
      // back is instant.
      clearMemoisedSecretKey();
      nip04PlaintextCache.clear();
      setAmberNip44Permission('unknown');
      setProfile(null);
      setContacts([]);
      // Reset the NIP-65 slice only — user-added overrides are an
      // in-app preference and shared across identities (matches the
      // logout behaviour).
      setNip65Relays([]);
      setDmInbox([]);

      // Promote the target identity to "active" everywhere.
      await SecureStore.setItemAsync(SIGNER_TYPE_KEY, target.signerType);
      if (target.signerType === 'nsec' && target.nsec) {
        await SecureStore.setItemAsync(NSEC_KEY, target.nsec);
        // Clear the legacy amber pubkey slot — we're an nsec identity now.
        await SecureStore.deleteItemAsync(PUBKEY_KEY);
      } else if (target.signerType === 'amber') {
        await SecureStore.setItemAsync(PUBKEY_KEY, target.pubkey);
        await SecureStore.deleteItemAsync(NSEC_KEY);
      }
      const updated = await setActiveIdentity(target.pubkey);
      setIdentities(updated.identities);
      setPubkey(target.pubkey);
      setSignerType(target.signerType);
      setIsLoggedIn(true);

      // Eagerly hydrate from persisted per-account caches. The next
      // tab focus / pull-to-refresh will fan out to relays.
      await loadContactsFromCache(target.pubkey);
      await hydrateDmInboxFromCache(target.pubkey);
      // Defer the relay refresh — keeps the switch animation smooth.
      InteractionManager.runAfterInteractions(async () => {
        try {
          const readRelays = await loadRelays(target.pubkey);
          await loadProfile(target.pubkey, readRelays);
          loadContacts(target.pubkey, readRelays).catch((e) =>
            console.warn('[Nostr] post-switch contact refresh failed:', e),
          );
        } catch (e) {
          console.warn('[Nostr] post-switch refresh failed:', e);
        }
      });
    },
    [
      pubkey,
      loadContactsFromCache,
      hydrateDmInboxFromCache,
      loadRelays,
      loadProfile,
      loadContacts,
      setAmberNip44Permission,
      setDmInbox,
    ],
  );

  // Remove a single identity from the multi-account registry. If
  // `targetPubkey` is the active identity, behaves like `logout` (with
  // the post-removal switch to a successor if one exists). Otherwise
  // just wipes that identity's caches + registry entry; the active
  // identity stays put.
  const signOutIdentity = useCallback(
    async (targetPubkey: string): Promise<void> => {
      // Active-identity sign-out reuses the existing logout path so
      // the in-memory teardown stays in one place.
      if (targetPubkey === pubkey) {
        await logout();
        return;
      }
      await wipeAccountCaches(targetPubkey);
      const blob = await removeIdentityFromStore(targetPubkey);
      setIdentities(blob.identities);
    },
    [pubkey, logout, wipeAccountCaches],
  );

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
      zapEventId?: string,
    ): Promise<string | null> => {
      if (!pubkey || !isLoggedIn) return null;

      const readRelays = getReadRelays();
      const zapEvent = nostrService.createZapRequestEvent(
        pubkey,
        recipientPubkey,
        amountSats * 1000,
        readRelays,
        comment,
        zapEventId,
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
          AsyncStorage.setItem(
            perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pubkey),
            JSON.stringify(updatedProfile),
          ).catch(() => {});
          AsyncStorage.setItem(
            perAccountKey(OWN_PROFILE_TIMESTAMP_KEY_BASE, pubkey),
            Date.now().toString(),
          ).catch(() => {});
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
    [contacts, publishContactList, getReadRelays, pubkey],
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
    [contacts, publishContactList, pubkey],
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

  /**
   * Send a 1:1 direct message via NIP-17 (kind-14 rumor → kind-13 seal →
   * kind-1059 gift wrap). NIP-04 (kind 4) is no longer produced — see
   * issue #140 and `docs/PROTOCOLS.adoc`. Reads of legacy kind-4 history
   * are unchanged: `fetchConversation` and `refreshDmInbox` still query
   * and decrypt kind 4 alongside kind 1059 so old threads survive.
   *
   * Reuses the same `sendNip17ToManyWith{Nsec,Signer}` plumbing as
   * `sendGroupMessage`, with the recipient list being a single peer.
   * `wrapManyEvents` (nsec) and the sequential signer loop (Amber) both
   * also wrap for the sender, so the message lands in the user's own
   * inbox on other devices — the same multi-device behaviour group
   * messages have today.
   */
  // 1:1 sends — text + encrypted file (voice note, #235) — live in
  // useMessageSend (#703). Group send + group-state live in useGroupMessaging
  // (wired above). We take ONLY the 1:1 sends here so sendGroupMessage /
  // publishGroupState aren't declared twice.
  const { sendDirectMessage, sendFileMessage } = useMessageSend({
    pubkey,
    isLoggedIn,
    signerType,
    relays,
  });

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
      pubkey,
      profile,
      contacts,
      relays,
      userRelays,
      addUserRelay,
      removeUserRelay,
      signerType,
      identities,
      switchIdentity,
      signOutIdentity,
      loginWithNsec,
      loginWithAmber,
      logout,
      refreshProfile,
      refreshContacts,
      fetchProfilesForPubkeys,
      signZapRequest,
      publishProfile,
      followContact,
      unfollowContact,
      addContact,
      sendDirectMessage,
      sendFileMessage,
      sendGroupMessage,
      publishGroupState,
      fetchConversation,
      getCachedConversation,
      appendLocalDmMessage,
      dmInbox,
      dmInboxLoading,
      refreshDmInbox,
      armLiveDmSub,
      amberNip44Permission,
      signEvent,
    }),
    [
      isLoggedIn,
      isLoggingIn,
      pubkey,
      profile,
      contacts,
      relays,
      userRelays,
      addUserRelay,
      removeUserRelay,
      signerType,
      identities,
      switchIdentity,
      signOutIdentity,
      loginWithNsec,
      loginWithAmber,
      logout,
      refreshProfile,
      refreshContacts,
      fetchProfilesForPubkeys,
      signZapRequest,
      publishProfile,
      followContact,
      unfollowContact,
      addContact,
      sendDirectMessage,
      sendFileMessage,
      sendGroupMessage,
      publishGroupState,
      fetchConversation,
      getCachedConversation,
      appendLocalDmMessage,
      dmInbox,
      dmInboxLoading,
      refreshDmInbox,
      armLiveDmSub,
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
