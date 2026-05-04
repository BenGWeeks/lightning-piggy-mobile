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
import { LRUCache } from '../utils/lru';
import * as nip19 from 'nostr-tools/nip19';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import type { NostrProfile, NostrContact, RelayConfig, SignerType } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import {
  classifyRumor,
  partnerFromRumor,
  subjectFromRumor,
  unwrapWrapNsec,
  unwrapWrapViaNip44,
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import {
  findGroupForParticipants,
  reconcileSyntheticGroup,
} from '../services/groupRoutingRegistry';
import { isSyntheticGroupId, syntheticGroupIdForParticipants } from '../utils/syntheticGroupId';
import { appendGroupMessage, type GroupMessage } from '../services/groupMessagesStorageService';

/**
 * Module-level LRU cache for NIP-04 plaintext keyed by event id. Keeps
 * the app-session-latest 1000 decrypted messages in RAM so re-opening
 * the same thread (or navigating away and back) doesn't re-decrypt from
 * scratch. Event id → plaintext mapping is immutable once decrypted
 * (the NIP-04 payload never changes for a given id), so no TTL needed.
 *
 * Cribbed from Arcade's arclib/src/private.ts:9 (`LRUCache<string, …>`).
 * Stays in RAM only — no AsyncStorage persistence — to keep the write
 * path free and avoid serialising full-bundle JSON on every decrypt.
 */
const nip04PlaintextCache = new LRUCache<string, string>({ max: 1000 });
export function __clearNip04PlaintextCacheForTests() {
  nip04PlaintextCache.clear();
}

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

// AsyncStorage keys for the NIP-17 gift-wrap caches. Both signer paths
// use the same cache shape (wrap-id → decrypted rumor entry); they're
// kept under separate keys so cross-signer login on the same device
// doesn't leak plaintext between identities.
const AMBER_NIP17_CACHE_KEY = 'amber_nip17_cache_v1';
const NSEC_NIP17_CACHE_KEY = 'nsec_nip17_cache_v1';
const NIP17_CACHE_CAP = 5000;
const AMBER_NIP17_ENABLED_KEY = 'amber_nip17_enabled';

/** Persistent wrap-id → DmInboxEntry cache. Only ever contains rumors
 * from followed senders — see refreshDmInbox's filter gate. */
type Nip17CacheEntry = DmInboxEntry & { wrapId: string };

/**
 * Tiny pub/sub for inbound group messages. NostrContext fires
 * `notifyGroupMessage` after persisting a decrypted group rumor so
 * GroupConversationScreen can re-load its in-memory list without
 * polling. Listeners are scoped to (groupId) so an open thread doesn't
 * re-render on unrelated traffic.
 */
type GroupMessageListener = (groupId: string, message: GroupMessage) => void;
const groupMessageListeners = new Set<GroupMessageListener>();
export function notifyGroupMessage(groupId: string, message: GroupMessage): void {
  for (const l of groupMessageListeners) {
    try {
      l(groupId, message);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] group message listener threw:', e);
    }
  }
}
export function subscribeGroupMessages(listener: GroupMessageListener): () => void {
  groupMessageListeners.add(listener);
  return () => {
    groupMessageListeners.delete(listener);
  };
}

/**
 * Outcome of attempting to route a kind-14 rumor as a group message.
 *
 * The 1:1 fallthrough path uses `partnerFromRumor`, which for a
 * multi-recipient rumor would arbitrarily pick the FIRST p tag and
 * mis-catalogue the rumor as a 1:1 DM with that pubkey. Callers must
 * therefore distinguish "not a group" (safe to fall through to DM)
 * from "group-shaped, no local match" (must NOT fall through).
 */
type GroupRouteResult =
  | { kind: 'routed' } // appended to a known group
  | { kind: 'group-no-match' } // group-shaped but no matching local group
  | { kind: 'not-group' }; // 1:1 DM (or malformed) — safe to use the DM path

/**
 * Try to route a decoded kind-14 rumor as a group message.
 *
 * Side-effects on `routed`:
 *  - Appends to groupMessagesStorageService keyed by group.id
 *  - Fires the in-process group-message listener so an open thread
 *    refreshes immediately
 */
async function tryRouteGroupRumor(
  rumor: DecodedRumor,
  viewerPubkey: string,
  wrapId: string,
): Promise<GroupRouteResult> {
  const cls = classifyRumor(rumor, viewerPubkey);
  if (!cls || cls.type !== 'group') return { kind: 'not-group' };
  let group = findGroupForParticipants(cls.otherParticipants);
  // Always run the synthetic-reconcile path when the matched group is
  // synthetic (no kind-30200 backing it) — that's the only way later
  // `subject`-tag renames from foreign clients propagate to the local
  // group name. Per NIP-17 latest-wins, every kind-14 with a `subject`
  // for an existing room can update its name; without this branch the
  // first sender's subject would stick forever.
  const isSynthetic = group ? isSyntheticGroupId(group.id) : false;
  if (!group || isSynthetic) {
    // No matching kind-30200-backed local group, OR matched a synthetic
    // group that may need a name refresh. Try the NIP-17 spec-aligned
    // fallback: foreign clients (Amethyst / Quartz, 0xchat) don't
    // publish kind-30200; they advertise the group name via the
    // kind-14 `subject` tag, and the room identity is the participant
    // set. Materialise / update a synthetic group keyed off a
    // deterministic SHA-256 of the sorted pubkey-set so subsequent
    // messages from the same room land in the same local thread, and
    // so the same id is computed across all peers / sessions.
    //
    // We require a `subject` to take this fallback — kind-14s without
    // one are either (a) LP-native groups whose kind-30200 hasn't
    // landed yet (existing drop-then-refresh behaviour is correct), or
    // (b) malformed / spam (no semantic name to attach to anyway).
    const subject = subjectFromRumor(rumor);
    if (subject) {
      // NIP-17 room key = pubkey + p tags = sender + every p-tag
      // (viewer included). `participantsFromRumor` returns exactly
      // that set; it's what `classifyRumor` derived `otherParticipants`
      // from minus the viewer, so re-include the viewer here.
      const fullRoom = new Set<string>(cls.otherParticipants);
      fullRoom.add(viewerPubkey.toLowerCase());
      const synthId = syntheticGroupIdForParticipants(fullRoom);
      // memberPubkeys excludes the viewer by LP convention (see Group
      // type docstring + reconcileFromGroupStateEvent).
      const synthetic = await reconcileSyntheticGroup({
        groupId: synthId,
        name: subject,
        memberPubkeys: Array.from(cls.otherParticipants),
        createdAtSec: rumor.created_at,
      });
      if (synthetic) {
        group = synthetic;
      }
    }
  }
  if (!group) {
    // Still no match (no subject, or GroupsContext hasn't registered
    // its reconciler yet — typically only during cold boot / logout).
    // Drop on the floor: these wraps are NOT written into the
    // persistent NIP-17 wrap cache (the caller's `continue` happens
    // before the cache write), so retry only happens via a relay
    // re-fetch on the next force-refresh. Caveat: NIP-59 wraps use
    // randomised `created_at` so non-force refreshes (which apply a
    // `since:` filter) may miss them. Buffering pending-group-wraps
    // for replay after a 30200 lands is tracked as a follow-up.
    if (__DEV__) {
      const all = Array.from(cls.otherParticipants);
      const fp = all
        .slice(0, 3)
        .map((p) => p.slice(0, 8))
        .join(',');
      console.log(
        `[Nostr] dropped group-shaped rumor (no matching group): participants=[${fp}${all.length > 3 ? ',...' : ''}] sender=${rumor.pubkey.slice(0, 8)}`,
      );
    }
    return { kind: 'group-no-match' };
  }
  const message: GroupMessage = {
    id: wrapId,
    senderPubkey: rumor.pubkey.toLowerCase(),
    text: rumor.content,
    createdAt: rumor.created_at,
  };
  try {
    await appendGroupMessage(group.id, message);
    notifyGroupMessage(group.id, message);
  } catch (e) {
    if (__DEV__) console.warn('[Nostr] appendGroupMessage failed:', e);
    // Storage write failed — don't fall through to the DM path either,
    // it's still a group rumor. Same caveat as the no-match branch
    // above: this wrap is not in the persistent NIP-17 cache, so retry
    // requires a relay re-fetch. A force-refresh from the next focus
    // tick is the practical recovery path; no automatic replay today.
    return { kind: 'group-no-match' };
  }
  return { kind: 'routed' };
}

/** Parse an AsyncStorage JSON blob into an object-keyed record, falling
 * back to `{}` if the value is missing, not valid JSON, or not an
 * object. A corrupted cache should be treated as a cold cache rather
 * than an exception that aborts the caller. */
function safeParseRecord<T>(raw: string | null): Record<string, T> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, T>;
    }
  } catch {
    // fall through — treat corrupted blob as empty
  }
  return {};
}

/** Persist a wrap-id cache back to AsyncStorage, enforcing the size
 * cap in insertion order (oldest-inserted evicts first — LRU-ish, and
 * O(overflow) instead of the O(n log n) sort-by-createdAt this
 * replaced). Object keys in JS preserve insertion order for non-
 * integer string keys, and wrap ids are hex, so iteration order is
 * stable across parse/stringify round-trips. Write failures are
 * surfaced as a warn — a corrupted storage subsystem would otherwise
 * silently re-decrypt on every refresh with no breadcrumb. */
async function writeNip17Cache(
  storageKey: string,
  cache: Record<string, Nip17CacheEntry>,
): Promise<void> {
  const keys = Object.keys(cache);
  const overflow = keys.length - NIP17_CACHE_CAP;
  if (overflow > 0) {
    for (let i = 0; i < overflow; i++) delete cache[keys[i]];
  }
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(cache));
  } catch (err) {
    console.warn(`[Nostr] NIP-17 cache write failed (${storageKey}):`, err);
  }
}

/** Yield to the JS event loop so UI interactions can tick between
 * chunks of a synchronous decrypt loop (#177). `await`ing an already-
 * resolved promise only drains the microtask queue, which still
 * starves UI events — setTimeout(0) returns to the task scheduler. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Chunk size for yielding between decrypt attempts. Sized for the
 * nsec path: `nip04.decrypt` / `unwrapWrapNsec` are ~1 ms each on
 * mid-range mobile CPUs, so 15 iterations ≈ 15 ms of blocking work
 * per batch — just under a 60 fps frame budget. The Amber path uses
 * the same constant, but its decrypt is IPC-bound and already
 * yields per call, so the extra `setTimeout(0)` there is effectively
 * free. If you retune this, profile the nsec path with `Profiler`
 * in FriendsScreen as the canary. */
const DECRYPT_YIELD_EVERY = 15;

/** Yield cadence for the kind-1059 (NIP-17 wrap) loops in
 * `refreshDmInbox`. Smaller than `DECRYPT_YIELD_EVERY` because this
 * counter ticks on EVERY wrap — cache hit, miss, follow-filter drop,
 * group-route, the lot — so even an inbox of pure cache hits still
 * yields the JS thread regularly. The cache-hit path itself is cheap
 * (~ms), but on a >1000-wrap inbox the bulk processing piles up to
 * tens of seconds of unbroken JS work without a periodic yield, which
 * starves UI events (back-tap appears frozen — #286). 8 keeps each
 * yield-bounded burst well under a 60 fps frame budget. */
const NIP17_LOOP_YIELD_EVERY = 8;

/**
 * Minimum gap between `refreshDmInbox` calls fired by
 * `useFocusEffect` on the Messages tab. Without a TTL, every tab return
 * triggered a fresh 3-query relay round-trip + full NIP-04 decrypt
 * sweep — locking the app up for seconds on the 2nd/3rd/Nth visit.
 * 30 s is long enough that quick tab-bouncing stays responsive, short
 * enough that a user who genuinely wants fresh state (open app after
 * a break) still pays normal refresh cost. Pull-to-refresh bypasses
 * the TTL via `{ force: true }`.
 */
const DM_INBOX_REFRESH_TTL_MS = 30_000;

/**
 * Persisted inbox + per-peer message caches (PR B).
 *
 * Key shape: `<prefix>_<userPubkeyHex>` — per-user so multiple nsec
 * identities on the same device don't share or overwrite each other.
 * On logout the three blobs are removed via `AsyncStorage.multiRemove`
 * alongside the NIP-17 wrap caches.
 *
 * Storage cap: `DM_INBOX_CAP` keeps the serialised JSON under ~400 KB
 * even with verbose messages (≈1000 entries × ~400 bytes each).
 */
const DM_INBOX_CACHE_PREFIX = 'nostr_dm_inbox_v1_';
const DM_INBOX_LAST_SEEN_PREFIX = 'nostr_dm_inbox_last_seen_v1_';
const DM_CONV_CACHE_PREFIX = 'nostr_dm_conv_v1_';
const DM_CONV_LAST_SEEN_PREFIX = 'nostr_dm_conv_last_seen_v1_';
const DM_INBOX_CAP = 1000;
const DM_CONV_CAP = 500;

function inboxCacheKey(user: string) {
  return DM_INBOX_CACHE_PREFIX + user;
}
function inboxLastSeenKey(user: string) {
  return DM_INBOX_LAST_SEEN_PREFIX + user;
}
function convCacheKey(user: string, peer: string) {
  return DM_CONV_CACHE_PREFIX + user + '_' + peer;
}
function convLastSeenKey(user: string, peer: string) {
  return DM_CONV_LAST_SEEN_PREFIX + user + '_' + peer;
}

/** Read the persisted DM inbox for a user. Used during session restore /
 * post-login so the Messages tab paints from cache on cold start instead
 * of waiting for the relay round-trip + NIP-17 decrypt loop (3-5 s). The
 * shape mirrors what `refreshDmInbox` already writes at the end of every
 * successful refresh — so this is purely a read-side hoist of work that
 * was already happening, just earlier in the lifecycle.
 *
 * No follow-list filter is applied here. The next `refreshDmInbox` call
 * (fires via Messages-tab focus) re-applies the filter against current
 * follows, so a since-last-session unfollow never persists to the UI for
 * more than the brief render window before that re-filter happens. */
async function loadDmInboxFromCache(pubkey: string): Promise<DmInboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(inboxCacheKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadLastSeen(key: string): Promise<number | undefined> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Merge cached list with freshly-decrypted entries. Cached entries we
 * already have take precedence (they might have had properties we'd
 * need to re-decrypt to recover). Dedup key is `id` (kind-4 event id
 * or kind-1059 wrap id). A fallback composite key covers persisted
 * entries written before `id` was added to the type so loading an
 * old cache doesn't silently drop everything to the same slot.
 */
function mergeInboxEntries(
  cached: DmInboxEntry[],
  fresh: DmInboxEntry[],
  cap: number,
): DmInboxEntry[] {
  const map = new Map<string, DmInboxEntry>();
  const dedupKey = (e: DmInboxEntry): string =>
    e.id ?? `${e.partnerPubkey}|${e.createdAt}|${e.wireKind}`;
  for (const e of cached) map.set(dedupKey(e), e);
  for (const e of fresh) map.set(dedupKey(e), e);
  const all = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  return all.slice(0, cap);
}

function mergeConversationMessages(
  cached: ConversationMessage[],
  fresh: ConversationMessage[],
  cap: number,
): ConversationMessage[] {
  const map = new Map<string, ConversationMessage>();
  for (const m of cached) map.set(m.id, m);
  for (const m of fresh) map.set(m.id, m);
  const all = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  if (all.length <= cap) return all;
  // Keep the newest DM_CONV_CAP messages; drop oldest.
  return all.slice(all.length - cap);
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

/** Options accepted by `refreshDmInbox`. All fields optional so existing
 * callers continue to work without changes. `signal` lets a screen
 * cancel the refresh on unmount so the decrypt loop stops chewing the
 * JS thread after the user has navigated away (#286). */
export interface RefreshDmInboxOptions {
  force?: boolean;
  signal?: AbortSignal;
}

interface NostrContextType {
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  /** Logged-in user's hex pubkey, or null when logged out. */
  pubkey: string | null;
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
    text: string;
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
  /** `performance.now()` of last successful `refreshDmInbox` completion.
   * Gate for the `DM_INBOX_REFRESH_TTL_MS` throttle so that Messages-tab
   * focus doesn't re-fire full relay queries on every tab bounce. */
  const dmInboxLastRefreshAt = useRef<number>(0);

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

  /** Eagerly hydrate `dmInbox` from the persisted NIP-17 inbox cache so
   * the Messages tab paints conversations on cold start instead of
   * staying blank for the relay-fetch + decrypt loop (~3-5 s). Called
   * from session-restore + post-login flows; refreshDmInbox handles
   * its own cache read separately for the delta-fetch path. */
  const hydrateDmInboxFromCache = useCallback(async (pk: string) => {
    const cached = await loadDmInboxFromCache(pk);
    if (cached.length > 0) setDmInbox(cached);
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

        // Eagerly hydrate dmInbox from disk cache so the Messages tab
        // paints conversations on cold start. The relay refresh below
        // doesn't touch dmInbox; the eventual refreshDmInbox call
        // (driven by Messages-tab focus) does its own cache read for
        // the delta-fetch path and replaces this hydrated state with
        // the merged disk+relay result.
        await hydrateDmInboxFromCache(pk);

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
  }, [loadRelays, loadProfile, loadContacts, loadContactsFromCache, hydrateDmInboxFromCache]);

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

      setSignerType('amber');
      setIsLoggedIn(true);
      setIsLoggingIn(false);

      // Load cached contacts immediately, fetch fresh data in background
      await loadContactsFromCache();
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

  const logout = useCallback(async () => {
    clearMemoisedSecretKey();
    setAmberNip44Permission('unknown');
    nip04PlaintextCache.clear();
    const loggedOutPubkey = pubkey;
    await SecureStore.deleteItemAsync(NSEC_KEY);
    await SecureStore.deleteItemAsync(PUBKEY_KEY);
    await SecureStore.deleteItemAsync(SIGNER_TYPE_KEY);
    const toRemove: string[] = [
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
      AMBER_NIP17_CACHE_KEY,
      AMBER_NIP17_ENABLED_KEY,
      NSEC_NIP17_CACHE_KEY,
    ];
    // PR B caches are per-user-keyed — only clear the ones for the
    // user we're logging out of. Per-peer conversation caches share
    // the same prefix; we grep AsyncStorage keys for them.
    if (loggedOutPubkey) {
      toRemove.push(inboxCacheKey(loggedOutPubkey));
      toRemove.push(inboxLastSeenKey(loggedOutPubkey));
      const allKeys = await AsyncStorage.getAllKeys();
      const convPrefix = DM_CONV_CACHE_PREFIX + loggedOutPubkey + '_';
      const lastSeenPrefix = DM_CONV_LAST_SEEN_PREFIX + loggedOutPubkey + '_';
      for (const k of allKeys) {
        if (k.startsWith(convPrefix) || k.startsWith(lastSeenPrefix)) toRemove.push(k);
      }
      // Group state + per-group message logs are NOT yet account-scoped
      // (single-account today; per-account namespacing is a follow-up).
      // Clear them on logout so the next signed-in identity can't see
      // the previous identity's groups or thread history.
      const allKeysForGroups = allKeys; // already fetched above
      toRemove.push('nostr_groups');
      for (const k of allKeysForGroups) {
        if (k.startsWith('group_messages_')) toRemove.push(k);
      }
      // Per-pubkey group activity cache (added in #257). Contains
      // decrypted last-message previews (`GroupActivity.lastText`),
      // so we MUST clear it on logout — leaving it on disk would
      // expose private content to whoever logs in next.
      toRemove.push(`nostr_group_activity_${loggedOutPubkey}`);
    }
    await AsyncStorage.multiRemove(toRemove);

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
   * NIP-17 multi-recipient send. Supports both nsec (signs locally) and
   * Amber (per-recipient signEvent + nip44Encrypt round-trips) signers.
   *
   * Amber path is sequential by design — the native module rejects
   * concurrent intents with `BUSY` (see modules/amber-signer/.../
   * AmberSignerModule.kt → launchIntent). With N recipients (+1 for the
   * sender's own inbox copy), this fires up to 2N Amber prompts unless
   * the user has pre-granted blanket permission for `sign_event` and
   * `nip44_encrypt`, in which case Amber's ContentResolver fast-path
   * resolves silently. See issue #247.
   */
  const sendGroupMessage = useCallback(
    async (input: {
      groupId: string;
      subject: string;
      memberPubkeys: string[];
      text: string;
    }): Promise<{ success: boolean; wrapsPublished?: number; error?: string }> => {
      if (!pubkey || !isLoggedIn) return { success: false, error: 'Not logged in' };
      const text = input.text.trim();
      if (!text) return { success: false, error: 'Empty message' };
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const rumor = nostrService.createGroupChatRumor({
          senderPubkey: pubkey,
          subject: input.subject,
          memberPubkeys: input.memberPubkeys,
          content: text,
        });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: input.memberPubkeys,
            relays: targetRelays,
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          // Partial send — some recipients got the message, others didn't
          // (typically the user cancelled an Amber prompt mid-loop, or
          // a relay rejected one wrap). Surface this as a non-fatal
          // failure rather than silent success so the composer doesn't
          // clear and the user sees how many members actually received it.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              wrapsPublished: result.wrapsPublished,
              error: `Sent to ${result.wrapsPublished} of ${intended} members. ${result.errors[0]}`,
            };
          }
          return { success: true, wrapsPublished: result.wrapsPublished };
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: input.memberPubkeys,
            relays: targetRelays,
            signerNip44Encrypt: (plaintext, recipientPubkey) =>
              amberService.requestNip44Encrypt(plaintext, recipientPubkey, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              // Match the kind-4 DM Amber path — strip `pubkey` from
              // the JSON we send out. Amber derives the field from
              // `current_user`. Keeps both Amber sign paths shaped
              // identically and avoids any version of Amber that
              // rejects an event whose declared pubkey doesn't match
              // its signing identity.
              const { pubkey: _omit, ...sealForAmber } = unsignedSeal;
              void _omit;
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(sealForAmber),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('Amber returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          // Partial send — some recipients got the message, others didn't
          // (typically the user cancelled an Amber prompt mid-loop, or
          // a relay rejected one wrap). Surface this as a non-fatal
          // failure rather than silent success so the composer doesn't
          // clear and the user sees how many members actually received it.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              wrapsPublished: result.wrapsPublished,
              error: `Sent to ${result.wrapsPublished} of ${intended} members. ${result.errors[0]}`,
            };
          }
          return { success: true, wrapsPublished: result.wrapsPublished };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send group message';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  /**
   * Publish a kind-30200 group-state event. Single signEvent call —
   * trivially safe for Amber (no per-recipient fan-out, no concurrency).
   */
  const publishGroupState = useCallback(
    async (input: {
      groupId: string;
      name: string;
      memberPubkeys: string[];
    }): Promise<{ success: boolean; error?: string }> => {
      if (!pubkey || !isLoggedIn) return { success: false, error: 'Not logged in' };
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const event = nostrService.createGroupStateEvent({
          groupId: input.groupId,
          name: input.name,
          memberPubkeys: input.memberPubkeys,
        });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          await nostrService.signAndPublishEvent(event, secretKey, targetRelays);
          return { success: true };
        }

        if (signerType === 'amber') {
          // Mirror the kind-4 DM Amber path — pass the unsigned event
          // without `pubkey`; Amber sets it from `current_user`.
          const { event: signedEventJson } = await amberService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedEventJson) {
            return { success: false, error: 'Amber returned empty event' };
          }
          const signed = JSON.parse(signedEventJson);
          await nostrService.publishSignedEvent(signed, targetRelays);
          return { success: true };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to publish group state';
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

  const getCachedConversation = useCallback(
    async (otherPubkey: string): Promise<ConversationMessage[]> => {
      if (!pubkey) return [];
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return [];
      try {
        const raw = await AsyncStorage.getItem(convCacheKey(pubkey, normalized));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    [pubkey],
  );

  const fetchConversation = useCallback(
    async (otherPubkey: string): Promise<ConversationMessage[]> => {
      if (!pubkey || !isLoggedIn) return [];
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return [];

      // Perf instrumentation — unconditional (not __DEV__ gated) so we
      // can grep the same line out of logcat on a production APK to
      // compare cold-cache vs warm-cache thread opens. Numbers are
      // counts-only — no plaintext / pubkey logged beyond a short id.
      const perfStart = performance.now();
      let nip17CacheHits = 0;
      let nip17FreshDecrypts = 0;
      let nip04CacheHits = 0;
      let nip04FreshDecrypts = 0;

      const readRelays = getReadRelays();
      const decrypted: ConversationMessage[] = [];

      // PR B: load persisted per-peer conversation + per-peer last-seen.
      // Merge cached-and-fresh at the end; keep the cache for the next
      // open so we only ever re-decrypt the (typically 0-few) events
      // that arrived since last open.
      const [convRaw, convLastSeen] = await Promise.all([
        AsyncStorage.getItem(convCacheKey(pubkey, normalized)),
        loadLastSeen(convLastSeenKey(pubkey, normalized)),
      ]);
      const cachedConv: ConversationMessage[] = convRaw
        ? (() => {
            try {
              const parsed = JSON.parse(convRaw);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [];

      // NIP-04 — peer-scoped fetch, two directions, filtered by since.
      const kind4Events = await nostrService.fetchDirectMessageEvents(
        pubkey,
        normalized,
        readRelays,
        { since: convLastSeen },
      );
      // Two-pass decrypt with module-level LRU cache:
      //  1. Pull plaintext synchronously for events already in the
      //     cache — no decrypt round-trip, no Amber IPC, no CPU.
      //  2. Decrypt the misses in parallel (`Promise.all`). For nsec
      //     this drains the JS queue faster than a serial for-await
      //     loop; for Amber the IPC round-trips pipeline. Chunk the
      //     Promise.all in slices of DECRYPT_YIELD_EVERY to yield to
      //     the UI thread between batches on very long threads.
      const freshDecryptTargets: {
        idx: number;
        counterparty: string;
        ev: (typeof kind4Events)[0];
      }[] = [];
      const cachedPlaintexts: {
        idx: number;
        fromMe: boolean;
        text: string;
        ev: (typeof kind4Events)[0];
      }[] = [];
      for (let i = 0; i < kind4Events.length; i++) {
        const ev = kind4Events[i];
        const fromMe = ev.pubkey === pubkey;
        const counterparty = fromMe ? normalized : ev.pubkey.toLowerCase();
        const hit = nip04PlaintextCache.get(ev.id);
        if (hit !== undefined) {
          nip04CacheHits++;
          cachedPlaintexts.push({ idx: i, fromMe, text: hit, ev });
        } else {
          freshDecryptTargets.push({ idx: i, counterparty, ev });
        }
      }
      // Parallel decrypt of misses, in yield-able chunks.
      const freshResults: ({
        idx: number;
        fromMe: boolean;
        text: string;
        ev: (typeof kind4Events)[0];
      } | null)[] = [];
      for (let i = 0; i < freshDecryptTargets.length; i += DECRYPT_YIELD_EVERY) {
        const batch = freshDecryptTargets.slice(i, i + DECRYPT_YIELD_EVERY);
        const batchResults = await Promise.all(
          batch.map(async (t) => {
            nip04FreshDecrypts++;
            const plaintext = await decryptNip04ViaSigner(t.counterparty, t.ev.content);
            if (plaintext === null) return null;
            // Cache the successful decrypt. Event ids are immutable so
            // we can store unconditionally — no staleness possible.
            nip04PlaintextCache.set(t.ev.id, plaintext);
            const fromMe = t.ev.pubkey === pubkey;
            return { idx: t.idx, fromMe, text: plaintext, ev: t.ev };
          }),
        );
        freshResults.push(...batchResults);
        if (i + DECRYPT_YIELD_EVERY < freshDecryptTargets.length) await yieldToEventLoop();
      }
      // Merge cached + fresh preserving original event order.
      const orderedByIndex = new Array<ConversationMessage | null>(kind4Events.length).fill(null);
      for (const c of cachedPlaintexts) {
        orderedByIndex[c.idx] = {
          id: c.ev.id,
          fromMe: c.fromMe,
          text: c.text,
          createdAt: c.ev.created_at,
        };
      }
      for (const r of freshResults) {
        if (!r) continue;
        orderedByIndex[r.idx] = {
          id: r.ev.id,
          fromMe: r.fromMe,
          text: r.text,
          createdAt: r.ev.created_at,
        };
      }
      for (const m of orderedByIndex) if (m !== null) decrypted.push(m);

      // NIP-17 — partner pubkey is hidden inside the encrypted rumor,
      // so we can't peer-scope at the relay. `refreshDmInbox` (which
      // the Messages tab fires on focus with a 30s TTL) already
      // decrypts every wrap addressed to us and writes the plaintext
      // keyed by wrap id to the persistent cache. Serve the NIP-17
      // portion of THIS thread from that cache first — if the cache
      // has ANY entries, we skip the expensive inbox-wide relay
      // fetch entirely (#190).
      //
      // Cold-cache fallback: if the cache has no entries at all (first
      // app run post-login, or just-logged-out-logged-back-in) we
      // still hit the relay so the thread renders even before any
      // refreshDmInbox has fired. Subsequent opens short-circuit.
      //
      // Staleness tradeoff: a wrap that arrived in the last <30s and
      // hasn't been pulled by refreshDmInbox yet won't show until the
      // next tab focus. For a chat UX that's a non-issue.
      const signerWrapCacheKey =
        signerType === 'nsec'
          ? NSEC_NIP17_CACHE_KEY
          : signerType === 'amber'
            ? AMBER_NIP17_CACHE_KEY
            : null;
      const wrapCacheRaw = signerWrapCacheKey
        ? await AsyncStorage.getItem(signerWrapCacheKey)
        : null;
      const wrapCache = safeParseRecord<Nip17CacheEntry>(wrapCacheRaw);
      const cachedWrapEntries = Object.values(wrapCache);
      let skippedInboxFetch = false;
      if (cachedWrapEntries.length > 0) {
        // Cache populated — serve peer-matching wraps directly, skip relay fetch.
        for (const entry of cachedWrapEntries) {
          nip17CacheHits++;
          if (entry.partnerPubkey !== normalized) continue;
          decrypted.push({
            id: entry.wrapId,
            fromMe: entry.fromMe,
            text: entry.text,
            createdAt: entry.createdAt,
          });
        }
        skippedInboxFetch = true;
      }
      const inboxLastSeenForWraps = skippedInboxFetch
        ? undefined
        : await loadLastSeen(inboxLastSeenKey(pubkey));
      const { kind1059 } = skippedInboxFetch
        ? {
            kind1059: [] as Awaited<ReturnType<typeof nostrService.fetchInboxDmEvents>>['kind1059'],
          }
        : await nostrService.fetchInboxDmEvents(pubkey, readRelays, {
            since: inboxLastSeenForWraps,
          });
      if (kind1059.length > 0) {
        const onSkip = (reason: string, wrapId: string) => {
          if (__DEV__) console.warn(`[Nostr] NIP-17 thread unwrap skip (${wrapId}): ${reason}`);
        };
        if (signerType === 'nsec') {
          const secretKey = await getMemoisedSecretKey(pubkey);
          if (secretKey) {
            // Reuse the persistent wrap-id cache populated by
            // refreshDmInbox (#176). For wraps that aren't cached yet
            // (typically arrived between the last inbox refresh and
            // this thread open), we decrypt AND write them back so the
            // next thread open across ANY conversation can short-circuit
            // without waiting for the next inbox refresh.
            const raw = await AsyncStorage.getItem(NSEC_NIP17_CACHE_KEY);
            const cache = safeParseRecord<Nip17CacheEntry>(raw);
            const newlyCached: Nip17CacheEntry[] = [];
            let nip17Decrypted = 0;
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                nip17CacheHits++;
                if (cached.partnerPubkey !== normalized) continue;
                decrypted.push({
                  id: wrap.id,
                  fromMe: cached.fromMe,
                  text: cached.text,
                  createdAt: cached.createdAt,
                });
                continue;
              }
              nip17FreshDecrypts++;
              const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
              if (++nip17Decrypted % DECRYPT_YIELD_EVERY === 0) await yieldToEventLoop();
              if (!rumor) continue;
              // If this is a multi-recipient group rumor, route it to
              // the group store and skip 1:1 caching. Opening a DM
              // thread shouldn't backfill group rumors into the 1:1
              // cache — they belong to GroupConversationScreen.
              const routeResult = await tryRouteGroupRumor(rumor, pubkey, wrap.id);
              if (routeResult.kind !== 'not-group') continue;
              const partnership = partnerFromRumor(rumor, pubkey);
              if (!partnership) continue;
              // Cache every successfully decrypted wrap, even if it
              // belongs to a different thread — cache is keyed by wrap
              // id, not by thread, so later opens of OTHER threads
              // benefit too. Filter to this thread's partner only for
              // the render-side `decrypted` array.
              const entry: Nip17CacheEntry = {
                id: wrap.id,
                wrapId: wrap.id,
                partnerPubkey: partnership.partnerPubkey,
                fromMe: partnership.fromMe,
                createdAt: rumor.created_at,
                text: rumor.content,
                wireKind: rumor.kind,
              };
              cache[wrap.id] = entry;
              newlyCached.push(entry);
              if (partnership.partnerPubkey !== normalized) continue;
              decrypted.push({
                id: wrap.id,
                fromMe: partnership.fromMe,
                text: rumor.content,
                createdAt: rumor.created_at,
              });
            }
            if (newlyCached.length > 0) {
              await writeNip17Cache(NSEC_NIP17_CACHE_KEY, cache);
            }
          }
        } else if (signerType === 'amber') {
          const amberEnabled = (await AsyncStorage.getItem(AMBER_NIP17_ENABLED_KEY)) === 'true';
          if (amberEnabled) {
            const raw = await AsyncStorage.getItem(AMBER_NIP17_CACHE_KEY);
            const cache = safeParseRecord<Nip17CacheEntry>(raw);
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                nip17CacheHits++;
                if (cached.partnerPubkey !== normalized) continue;
                decrypted.push({
                  id: wrap.id,
                  fromMe: cached.fromMe,
                  text: cached.text,
                  createdAt: cached.createdAt,
                });
                continue;
              }
              nip17FreshDecrypts++;
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
                // Multi-recipient (group) rumors: route to group storage
                // and skip the 1:1 thread.
                const routeResult = await tryRouteGroupRumor(rumor, pubkey, wrap.id);
                if (routeResult.kind !== 'not-group') continue;
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

      // PR B: merge fresh decrypt results with what we had cached
      // from previous opens. Fresh takes precedence via `mergeConversationMessages`
      // Map semantics so re-ordered or edited events (rare) land right.
      const merged = mergeConversationMessages(cachedConv, decrypted, DM_CONV_CAP);

      // Single-line perf summary — grep `[Perf] fetchConversation` out
      // of logcat to compare cold-cache vs warm-cache thread opens.
      // Cold cache shows `hits=0, fresh=N` — whole inbox decrypted.
      // Warm cache shows `hits≈N, fresh=0` — all cache short-circuits.
      console.log(
        `[Perf] fetchConversation(${normalized.slice(0, 8)}): ` +
          `${(performance.now() - perfStart).toFixed(0)}ms, ` +
          `k4=${kind4Events.length} (hits=${nip04CacheHits}, fresh=${nip04FreshDecrypts}), ` +
          `k1059=${nip17CacheHits + nip17FreshDecrypts} (hits=${nip17CacheHits}, fresh=${nip17FreshDecrypts}, skippedFetch=${skippedInboxFetch}), ` +
          `since=${convLastSeen ?? 0}, ` +
          `cached=${cachedConv.length}, ` +
          `merged=${merged.length}`,
      );

      // Persist merged list + new per-peer last-seen so next open of
      // THIS thread sees only the delta. Fire-and-forget; the caller
      // gets its data immediately via `merged`. kind-1059 deliberately
      // excluded — wrap timestamps are randomized per NIP-59 and would
      // poison the kind-4 since cursor (same reasoning as the inbox
      // path; see fetchInboxDmEvents + refreshDmInbox).
      const newConvLastSeen = Math.max(convLastSeen ?? 0, ...kind4Events.map((e) => e.created_at));
      Promise.all([
        AsyncStorage.setItem(convCacheKey(pubkey, normalized), JSON.stringify(merged)).catch(
          () => {},
        ),
        newConvLastSeen > (convLastSeen ?? 0)
          ? AsyncStorage.setItem(
              convLastSeenKey(pubkey, normalized),
              String(newConvLastSeen),
            ).catch(() => {})
          : Promise.resolve(),
      ]).catch(() => {});

      return merged;
    },
    [pubkey, isLoggedIn, signerType, getReadRelays, decryptNip04ViaSigner],
  );

  const refreshDmInbox = useCallback(
    async (opts?: RefreshDmInboxOptions): Promise<void> => {
      if (!pubkey || !isLoggedIn) {
        setDmInbox([]);
        return;
      }
      const signal = opts?.signal;
      // Freshness TTL: skip the refresh entirely if the previous one
      // finished within DM_INBOX_REFRESH_TTL_MS, unless the caller
      // explicitly opts into a forced refresh (pull-to-refresh). The
      // Messages tab's `useFocusEffect` uses the default TTL path so
      // tab-bouncing doesn't retrigger expensive relay+decrypt work.
      if (!opts?.force) {
        const age = performance.now() - dmInboxLastRefreshAt.current;
        if (dmInboxLastRefreshAt.current > 0 && age < DM_INBOX_REFRESH_TTL_MS) {
          return;
        }
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
          const refreshStart = performance.now();
          let nip04CacheHits = 0;
          let nip04FreshDecrypts = 0;

          // PR B: load persisted inbox + last-seen so we can (a) paint
          // cached entries before the relay round-trip finishes and
          // (b) only fetch events newer than the last one we saw.
          const [cachedInboxRaw, lastSeen] = await Promise.all([
            AsyncStorage.getItem(inboxCacheKey(refreshForPubkey)),
            loadLastSeen(inboxLastSeenKey(refreshForPubkey)),
          ]);
          const cachedInbox: DmInboxEntry[] = cachedInboxRaw
            ? (() => {
                try {
                  const parsed = JSON.parse(cachedInboxRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          // Render the cached entries immediately so the Messages tab
          // isn't blank while the relay fetches the delta. The followers
          // set may have changed since the cache was written; re-apply
          // the filter here so unfollowed senders don't resurrect.
          if (cachedInbox.length > 0) {
            const filteredCache = cachedInbox.filter((e) => refreshFollows.has(e.partnerPubkey));
            setDmInbox(filteredCache);
          }

          // For pull-to-refresh / force refresh, skip the `since` filter
          // entirely. NIP-59 wraps have a randomised `created_at` (up to
          // 2 days back), so a `since` cutoff is unreliable for catching
          // freshly-published wraps — the relay will drop wraps whose
          // randomised stamp falls behind the cutoff. The wrap-id cache
          // dedupes the re-fetched bytes, so the cost of dropping the
          // floor is just the relay round-trip, not re-decrypt. Group
          // messages especially benefit since GroupsScreen / GroupConv
          // open with `force: true` to chase newly-arrived rumors.
          const { kind4, kind1059 } = await nostrService.fetchInboxDmEvents(
            refreshForPubkey,
            readRelays,
            opts?.force ? {} : { since: lastSeen },
          );
          if (signal?.aborted) return;
          const entries: DmInboxEntry[] = [];

          // NIP-04 — partner pubkey is in the envelope, so we can apply
          // the follow filter BEFORE decrypting. A non-followed sender
          // never gets a round-trip through Amber, let alone land in
          // state. Same cache/parallel pattern as fetchConversation:
          // pull cached plaintext synchronously, decrypt misses in
          // DECRYPT_YIELD_EVERY-sized parallel batches.
          const k4Targets: {
            ev: (typeof kind4)[0];
            fromMe: boolean;
            partnerPubkey: string;
          }[] = [];
          for (const ev of kind4) {
            const fromMe = ev.pubkey.toLowerCase() === refreshForPubkey;
            const partnerPubkey = (
              fromMe ? (ev.tags.find((t) => t[0] === 'p')?.[1] ?? '') : ev.pubkey
            ).toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(partnerPubkey)) continue;
            if (!refreshFollows.has(partnerPubkey)) continue;
            k4Targets.push({ ev, fromMe, partnerPubkey });
          }
          // Fast pass — cache lookup only.
          const k4Misses: typeof k4Targets = [];
          for (const t of k4Targets) {
            const hit = nip04PlaintextCache.get(t.ev.id);
            if (hit !== undefined) {
              nip04CacheHits++;
              entries.push({
                id: t.ev.id,
                partnerPubkey: t.partnerPubkey,
                fromMe: t.fromMe,
                createdAt: t.ev.created_at,
                text: hit,
                wireKind: 4,
              });
            } else {
              k4Misses.push(t);
            }
          }
          // Slow pass — parallel decrypt of misses in yield-able chunks.
          for (let i = 0; i < k4Misses.length; i += DECRYPT_YIELD_EVERY) {
            if (signal?.aborted) return;
            const batch = k4Misses.slice(i, i + DECRYPT_YIELD_EVERY);
            const batchResults = await Promise.all(
              batch.map(async (t) => {
                nip04FreshDecrypts++;
                const plaintext = await decryptNip04ViaSigner(t.partnerPubkey, t.ev.content);
                if (plaintext === null) return null;
                nip04PlaintextCache.set(t.ev.id, plaintext);
                return { t, plaintext };
              }),
            );
            for (const r of batchResults) {
              if (!r) continue;
              entries.push({
                id: r.t.ev.id,
                partnerPubkey: r.t.partnerPubkey,
                fromMe: r.t.fromMe,
                createdAt: r.t.ev.created_at,
                text: r.plaintext,
                wireKind: 4,
              });
            }
            if (i + DECRYPT_YIELD_EVERY < k4Misses.length) await yieldToEventLoop();
          }
          if (signal?.aborted) return;

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
              const cache = safeParseRecord<Nip17CacheEntry>(raw);
              const newlyCached: Nip17CacheEntry[] = [];
              let unfollowedPurged = 0;
              let nip17Decrypted = 0;
              let nip17Iterated = 0;
              for (const wrap of kind1059) {
                // Periodic yield + abort check covers the cache-hit path
                // too (#286). Without this, a long run of cache hits
                // (or skipped/unfollowed entries) walks the whole
                // kind1059 list synchronously between the per-decrypt
                // yields below — bad on a >1000-wrap inbox where any
                // back-tap during refresh appears frozen.
                if (++nip17Iterated % NIP17_LOOP_YIELD_EVERY === 0) {
                  if (signal?.aborted) return;
                  await yieldToEventLoop();
                }
                const cached = cache[wrap.id];
                if (cached) {
                  // Cache entry exists → it was from a followed sender
                  // when first stored. Re-check against the *current*
                  // follow set so unfollowed partners don't keep
                  // surfacing from cache. Purge the stale entry so we
                  // don't keep dragging it through every refresh until
                  // the 5000-cap LRU finally evicts it.
                  if (!refreshFollows.has(cached.partnerPubkey)) {
                    delete cache[wrap.id];
                    unfollowedPurged++;
                    continue;
                  }
                  entries.push({
                    id: cached.wrapId,
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
                // Multi-recipient (group) rumors: route to group storage
                // and short-circuit the DM-inbox path. The 1:1 inbox
                // never sees group messages — they belong to a different
                // surface (GroupConversationScreen).
                const routeResult = await tryRouteGroupRumor(rumor, refreshForPubkey, wrap.id);
                if (routeResult.kind !== 'not-group') continue;
                const partnership = partnerFromRumor(rumor, refreshForPubkey);
                if (!partnership) continue;
                // B1 — drop non-follows at the data layer. No caching, no
                // state. The filter is load-bearing ("parental control"),
                // so it runs here not in the view.
                if (!refreshFollows.has(partnership.partnerPubkey)) continue;
                const entry: Nip17CacheEntry = {
                  id: wrap.id,
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
                  id: entry.id,
                  partnerPubkey: entry.partnerPubkey,
                  fromMe: entry.fromMe,
                  createdAt: entry.createdAt,
                  text: entry.text,
                  wireKind: entry.wireKind,
                });
              }

              if (newlyCached.length > 0 || unfollowedPurged > 0) {
                await writeNip17Cache(NSEC_NIP17_CACHE_KEY, cache);
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
              const cache = safeParseRecord<Nip17CacheEntry>(raw);
              const newlyCached: Nip17CacheEntry[] = [];
              let permissionDenied = false;
              let nip17Iterated = 0;

              for (const wrap of kind1059) {
                // Periodic yield + abort check (#286) — see the nsec
                // branch above for rationale.
                if (++nip17Iterated % NIP17_LOOP_YIELD_EVERY === 0) {
                  if (signal?.aborted) return;
                  await yieldToEventLoop();
                }
                const cached = cache[wrap.id];
                if (cached) {
                  // Cache entry exists → it was from a followed sender when
                  // first stored. Re-check against the *current* follow set
                  // so unfollowed partners don't keep surfacing from cache.
                  if (!refreshFollows.has(cached.partnerPubkey)) continue;
                  entries.push({
                    id: cached.wrapId,
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
                  // Multi-recipient (group) rumors: route to group storage
                  // and short-circuit the DM-inbox path.
                  const routeResult = await tryRouteGroupRumor(rumor, refreshForPubkey, wrap.id);
                  if (routeResult.kind !== 'not-group') continue;
                  const partnership = partnerFromRumor(rumor, refreshForPubkey);
                  if (!partnership) continue;
                  // B1 — never cache rumors from non-followed senders. The
                  // cost is re-decrypting them on the next refresh, but the
                  // silent path is ~1 ms per call and keeps plaintext off
                  // AsyncStorage.
                  if (!refreshFollows.has(partnership.partnerPubkey)) continue;
                  const entry: Nip17CacheEntry = {
                    id: wrap.id,
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
                    id: entry.id,
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
                await writeNip17Cache(AMBER_NIP17_CACHE_KEY, cache);
              }
            }
          }

          // Identity-change guard: if the user logged out or switched signer
          // while we were mid-flight, don't leak these entries into a
          // different session's state. Abort signal is treated the same way:
          // if the navigating-away screen has signalled cancel, skip the
          // commit so we don't pay the merge / persist cost.
          if (refreshForPubkey !== pubkey || refreshForSigner !== signerType) return;
          if (signal?.aborted) return;

          // PR B: merge cached-with-fresh, keep at most DM_INBOX_CAP
          // entries (newest-first), then persist + update last-seen.
          const merged = mergeInboxEntries(cachedInbox, entries, DM_INBOX_CAP);
          const filteredFinal = merged.filter((e) => refreshFollows.has(e.partnerPubkey));

          // Perf summary: one line per refresh, grep with `\[Perf\] refreshDmInbox`.
          console.log(
            `[Perf] refreshDmInbox: ` +
              `${(performance.now() - refreshStart).toFixed(0)}ms, ` +
              `k4=${kind4.length} (hits=${nip04CacheHits}, fresh=${nip04FreshDecrypts}), ` +
              `k1059=${kind1059.length}, ` +
              `since=${lastSeen ?? 0}, ` +
              `fresh=${entries.length}, ` +
              `merged=${merged.length}, ` +
              `rendered=${filteredFinal.length}`,
          );

          setDmInbox(filteredFinal);

          // Persist merged list + new last-seen. Only kind-4 contributes
          // here — NIP-59 wraps have randomized timestamps (~2 days in
          // either direction of the real publish time) for plausible
          // deniability, so wrap.created_at can't be used as a
          // monotonic publish-time cursor. Including them here would
          // ratchet lastSeen into the future on the first wrap with a
          // forward-dated ts, then cause subsequent kind-4 since-filters
          // to drop legitimate recent NIP-04 messages. fetchInboxDmEvents
          // already drops the `since` filter for kind-1059 entirely (see
          // the matching comment there); the cache dedupes wraps by id.
          const newLastSeen = Math.max(lastSeen ?? 0, ...kind4.map((e) => e.created_at));
          await Promise.all([
            AsyncStorage.setItem(inboxCacheKey(refreshForPubkey), JSON.stringify(merged)).catch(
              () => {},
            ),
            newLastSeen > (lastSeen ?? 0)
              ? AsyncStorage.setItem(inboxLastSeenKey(refreshForPubkey), String(newLastSeen)).catch(
                  () => {},
                )
              : Promise.resolve(),
          ]);
        } catch (error) {
          if (__DEV__) console.warn('[Nostr] refreshDmInbox failed:', error);
        } finally {
          setDmInboxLoading(false);
        }
      })();

      dmInboxInFlight.current = task;
      try {
        await task;
        dmInboxLastRefreshAt.current = performance.now();
      } finally {
        dmInboxInFlight.current = null;
      }
    },
    [
      pubkey,
      isLoggedIn,
      signerType,
      getReadRelays,
      followPubkeys,
      decryptNip04ViaSigner,
      amberNip44DecryptSilent,
    ],
  );

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
      pubkey,
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
      sendGroupMessage,
      publishGroupState,
      fetchConversation,
      getCachedConversation,
      dmInbox,
      dmInboxLoading,
      refreshDmInbox,
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
      sendGroupMessage,
      publishGroupState,
      fetchConversation,
      getCachedConversation,
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
