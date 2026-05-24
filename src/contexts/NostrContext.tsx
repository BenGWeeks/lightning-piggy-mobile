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
import {
  evictNip17CacheBytes,
  evictNip17CacheOverflow,
  touchNip17CacheEntry,
} from '../utils/nip17Cache';
import { utf8ByteSize } from '../utils/byteSize';
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
import {
  appendGroupMessage,
  listPersistedGroupWrapIds,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
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

// Per-(viewer,partner) serialization chain for the optimistic local-
// message disk-cache writes. Without this, two rapid sends (e.g.
// double-tap retry, or two sequential tap-share-from-attach) could
// each read-modify-write the conversation blob concurrently — last
// write wins, losing the prior optimistic row. Per Copilot review #509.
const appendLocalDmChains = new Map<string, Promise<void>>();
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
// doesn't leak plaintext between identities. As of #288 the keys are
// also per-account namespaced — each base is suffixed with `_${pubkey}`
// via `perAccountKey()` at every read/write site.
const AMBER_NIP17_CACHE_KEY_BASE = 'amber_nip17_cache_v1';
const NSEC_NIP17_CACHE_KEY_BASE = 'nsec_nip17_cache_v1';
const NIP17_CACHE_CAP = 5000;
// Legacy AsyncStorage key from the now-removed "Enable NIP-17 on Amber" toggle (#404). Cleared on logout so old installs don't leave dead bytes around.
const AMBER_NIP17_ENABLED_KEY_LEGACY = 'amber_nip17_enabled';

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

// Sibling pub/sub for inbound 1:1 DM rumors (#349). Fires after a live
// kind-1059 wrap is decrypted to a single-recipient kind-14 rumor and
// committed to the inbox cache. The open ConversationScreen subscribes
// to its peer's pubkey so it can re-fetch and append the new message
// without waiting for the user to pull-to-refresh. `partnerPubkey` is
// the other party (lowercase hex); listeners filter on it.
type DmMessageListener = (partnerPubkey: string) => void;
const dmMessageListeners = new Set<DmMessageListener>();
export function notifyDmMessage(partnerPubkey: string): void {
  for (const l of dmMessageListeners) {
    try {
      l(partnerPubkey);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] dm message listener threw:', e);
    }
  }
}
export function subscribeDmMessages(listener: DmMessageListener): () => void {
  dmMessageListeners.add(listener);
  return () => {
    dmMessageListeners.delete(listener);
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
 * cap in insertion order (oldest-inserted evicts first). Combined with
 * the `touchNip17CacheEntry` helper called on every cache hit during
 * `refreshDmInbox`, this gives true LRU semantics: a re-touched entry
 * is delete+reinserted to the tail, so it survives the next eviction
 * sweep even if 5000 newer wraps arrive after it. Without the touch
 * this is FIFO-by-first-write — see #193 for why FIFO regresses to
 * pre-#176 behaviour for users with very active inboxes.
 *
 * Object keys in JS preserve insertion order for non-integer string
 * keys, and wrap ids are hex, so iteration order is stable across
 * `JSON.parse` / `JSON.stringify` round-trips — the on-disk LRU order
 * survives app restarts without any new persistence machinery.
 *
 * Returns the number of entries evicted so callers can include it in
 * a perf log line. Write failures are surfaced as a warn — a corrupted
 * storage subsystem would otherwise silently re-decrypt on every
 * refresh with no breadcrumb. */
async function writeNip17Cache(
  storageKey: string,
  cache: Record<string, Nip17CacheEntry>,
): Promise<number> {
  const evicted = evictNip17CacheOverflow(cache, NIP17_CACHE_CAP);
  // Byte cap on top of the count cap — a row past Android's ~2 MB
  // SQLite CursorWindow throws on *read*, silently breaking this
  // fast-path cache and forcing a full cold-start restream.
  const evictedBytes = evictNip17CacheBytes(cache, DM_CACHE_MAX_BYTES);
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(cache));
  } catch (err) {
    console.warn(`[Nostr] NIP-17 cache write failed (${storageKey}):`, err);
  }
  return evicted + evictedBytes;
}

/** Yield to the JS event loop so UI interactions can tick between
 * chunks of a synchronous decrypt loop (#177). `await`ing an already-
 * resolved promise only drains the microtask queue, which still
 * starves UI events — setTimeout(0) returns to the task scheduler. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Half of a 60 fps frame (~8.3 ms). The NIP-17 inbox loops aim to
 * stay under this many ms of unbroken JS work per yield. With the
 * old count-based yield (every 4 wraps) a slow path could still
 * blow past 50–200 ms in a single burst — enough to drop several
 * frames on tab-switch. See #532. */
const DECRYPT_FRAME_BUDGET_MS = 4;

/** Cooperative-yield scheduler for the NIP-17 inbox loops (#532).
 *
 * Two improvements over the old `if (i % N === 0) await yieldToEventLoop()`
 * pattern:
 *
 * 1. **Time-budget yields.** We only pay for a `setTimeout(0)` round-
 *    trip when wall-clock since the last yield exceeds
 *    `DECRYPT_FRAME_BUDGET_MS`. A run of cheap cache hits no longer
 *    forces a yield every Nth iteration even though there's been no
 *    blocking work. The count-based modulo still acts as a safety
 *    cap (set by the caller) so a pathological iteration that
 *    somehow underestimates its own runtime can't starve the thread.
 *
 * 2. **Hard-cancel on abort.** When the caller's `AbortSignal` fires
 *    mid-loop, an `abort` listener clears the currently-pending
 *    `setTimeout` and resolves the awaiter immediately. Without this,
 *    the loop would still drain one more `setTimeout(0)` round-trip
 *    (plus whatever sync work follows it) before the next abort
 *    check — visible as a slug of pinned-thread time after a
 *    tab-switch blurs MessagesScreen.
 *
 * Returned object:
 * - `maybeYield()` — call once per loop iteration. No-op unless the
 *   frame budget is exceeded OR the safety-cap counter ticks.
 * - `yieldCount` — number of actual yields performed (perfLog).
 * - `dispose()` — detach the abort listener after the loop exits.
 */
type YieldScheduler = {
  maybeYield: () => Promise<void>;
  readonly yieldCount: number;
  dispose: () => void;
};

function createYieldScheduler(opts: {
  signal?: AbortSignal;
  /** Safety cap — always yield when iteration % safetyEvery === 0,
   * even if the frame budget hasn't been blown. */
  safetyEvery: number;
  /** ms of unbroken JS work before we force a yield. */
  budgetMs?: number;
}): YieldScheduler {
  const { signal, safetyEvery, budgetMs = DECRYPT_FRAME_BUDGET_MS } = opts;
  let iteration = 0;
  let yields = 0;
  let lastYieldAt = performance.now();
  let pendingHandle: ReturnType<typeof setTimeout> | null = null;
  let pendingReject: ((reason?: unknown) => void) | null = null;

  // On abort: clear the in-flight setTimeout so the awaiter unwinds
  // immediately instead of waiting for the next scheduler tick.
  const onAbort = () => {
    if (pendingHandle !== null) {
      clearTimeout(pendingHandle);
      pendingHandle = null;
    }
    if (pendingReject) {
      const reject = pendingReject;
      pendingReject = null;
      reject(new Error('aborted'));
    }
  };
  if (signal) {
    if (signal.aborted) {
      // Already aborted before the loop started — caller is expected
      // to check signal.aborted itself, but make maybeYield a no-op
      // resolver so we don't queue work.
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }

  const maybeYield = async () => {
    iteration++;
    if (signal?.aborted) return;
    const now = performance.now();
    const overBudget = now - lastYieldAt >= budgetMs;
    const safetyHit = iteration % safetyEvery === 0;
    if (!overBudget && !safetyHit) return;
    yields++;
    await new Promise<void>((resolve, reject) => {
      pendingReject = reject;
      pendingHandle = setTimeout(() => {
        pendingHandle = null;
        pendingReject = null;
        resolve();
      }, 0);
    }).catch(() => {
      // Aborted — swallow; caller checks signal.aborted after maybeYield.
    });
    lastYieldAt = performance.now();
  };

  const dispose = () => {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (pendingHandle !== null) {
      clearTimeout(pendingHandle);
      pendingHandle = null;
    }
  };

  return {
    maybeYield,
    get yieldCount() {
      return yields;
    },
    dispose,
  };
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
 * starves UI events (back-tap appears frozen — #286). Lowered from 8
 * to 4 in 2026-05 — perf testing on a real Pixel showed the
 * post-cold-start "Send sheet feels frozen" window was dominated by
 * back-to-back NIP-17 inbox processing without enough JS-thread
 * breathing room for gorhom-bottom-sheet's open animation to schedule
 * frames. Halving this doubles yield frequency, drops the per-burst
 * blocking from ~8 ms to ~4 ms, and lets bottom-sheet opens stay
 * smooth during inbox drain.
 *
 * Lowered again 2026-05-16 from 4 → 2: tonight's instrumented Pixel
 * logs (issue #560) showed refreshDmInbox running for 8.6 s wall-clock
 * with 3 s heartbeat gaps stacking during the decrypt loop. Yielding
 * every 2 wraps cuts each per-burst block back to ~2 ms; the
 * setImmediate cost is amortised across the still-significant
 * per-wrap decrypt work so the overhead is < 5%. */
const NIP17_LOOP_YIELD_EVERY = 2;

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
// Hard byte ceiling for a single DM cache row. Android's SQLite
// CursorWindow caps a row at ~2 MB — past it the *read* throws
// SQLiteBlobTooBigException, the cache silently fails to hydrate, and
// every cold start falls back to a full relay restream + NIP-17
// re-decrypt (a ~70s JS-thread stall). The count caps above aren't
// enough when messages are long, so the merge fns trim by size too.
const DM_CACHE_MAX_BYTES = 1_500_000;

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

/**
 * Read a DM-cache row, treating an unreadable row as empty. Android's
 * SQLite CursorWindow caps a row at ~2 MB; a row past that throws
 * `SQLiteBlobTooBigException` on read. Without this guard the throw
 * aborts the whole refresh/fetch before the write-side byte cap can
 * rewrite a smaller row — so an already-oversized row would never
 * self-heal. Catching it (and dropping the poisoned key) lets the next
 * relay restream repopulate a byte-capped row.
 */
async function safeGetDmCacheItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (err) {
    console.warn(`[Nostr] DM cache row unreadable — dropping ${key}:`, err);
    AsyncStorage.removeItem(key).catch(() => {});
    return null;
  }
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
    const raw = await safeGetDmCacheItem(inboxCacheKey(pubkey));
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
  let result = all.slice(0, cap);
  // Byte guard (see DM_CACHE_MAX_BYTES) — sorted newest-first, so drop
  // from the tail (oldest). `> 0` not `> 1` so a single over-budget
  // entry still goes rather than persisting an unreadable row;
  // `Math.max(1, …)` guarantees forward progress (a 0.1 factor rounds
  // to 0 for tiny arrays, which would spin forever).
  while (result.length > 0 && utf8ByteSize(JSON.stringify(result)) > DM_CACHE_MAX_BYTES) {
    const drop = Math.max(1, Math.floor(result.length * 0.1));
    result = result.slice(0, result.length - drop);
  }
  return result;
}

// Window in seconds to match a fresh real-id message against a pending
// optimistic local- echo (same fromMe + same text). Mirrors
// appendGroupMessage's LOCAL_ECHO_MATCH_WINDOW_SECS so the same UX
// invariant — one bubble per send, not two — holds across 1:1 + group.
const LOCAL_DM_ECHO_WINDOW_SECS = 30;

function mergeConversationMessages(
  cached: ConversationMessage[],
  fresh: ConversationMessage[],
  cap: number,
): ConversationMessage[] {
  const map = new Map<string, ConversationMessage>();
  for (const m of cached) map.set(m.id, m);
  for (const m of fresh) {
    // When a real (non-local-) entry arrives, drop any pending local-
    // echo with matching fromMe + text within the echo window. Without
    // this the user would see two bubbles for the same GIF/text: the
    // optimistic local- row persisted by ConversationScreen on send,
    // plus the NIP-17 self-wrap echo from the relay.
    if (!m.id.startsWith('local-')) {
      let bestKey: string | null = null;
      let bestDelta = Infinity;
      for (const [k, prev] of map) {
        if (!k.startsWith('local-')) continue;
        if (prev.fromMe !== m.fromMe) continue;
        if (prev.text !== m.text) continue;
        const delta = Math.abs(prev.createdAt - m.createdAt);
        if (delta > LOCAL_DM_ECHO_WINDOW_SECS) continue;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestKey = k;
        }
      }
      if (bestKey !== null) map.delete(bestKey);
    }
    map.set(m.id, m);
  }
  const all = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  // Keep the newest DM_CONV_CAP messages; drop oldest.
  let result = all.length <= cap ? all : all.slice(all.length - cap);
  // Byte guard (see DM_CACHE_MAX_BYTES) — sorted oldest-first, so drop
  // from the head (oldest). `> 0` not `> 1` so a single over-budget
  // message still goes; `Math.max(1, …)` guarantees forward progress.
  while (result.length > 0 && utf8ByteSize(JSON.stringify(result)) > DM_CACHE_MAX_BYTES) {
    const drop = Math.max(1, Math.floor(result.length * 0.1));
    result = result.slice(drop);
  }
  return result;
}

const NSEC_KEY = 'nostr_nsec';
const PUBKEY_KEY = 'nostr_pubkey';
const SIGNER_TYPE_KEY = 'nostr_signer_type';
// Cache key bases — each is suffixed with `_${pubkey}` via perAccountKey()
// at every call site (#288). The legacy un-suffixed keys are migrated on
// first launch by `migrateToPerAccountStorage`.
const CONTACTS_CACHE_KEY_BASE = 'nostr_contacts_cache';
const PROFILES_CACHE_KEY_BASE = 'nostr_profiles_cache';
const CACHE_TIMESTAMP_KEY_BASE = 'nostr_cache_timestamp';
const CONTACTS_TIMESTAMP_KEY_BASE = 'nostr_contacts_timestamp';
// Exported so AccountDrawerContent + AccountSwitcherSheet can seed
// their per-identity profile caches synchronously from AsyncStorage
// before fanning out to relays — otherwise they always wait on a
// network round-trip per non-active identity, making the switcher
// slow to populate names + avatars.
export const OWN_PROFILE_CACHE_KEY_BASE = 'nostr_own_profile_cache';
const OWN_PROFILE_TIMESTAMP_KEY_BASE = 'nostr_own_profile_timestamp';
const RELAY_LIST_CACHE_KEY_BASE = 'nostr_relay_list_cache';
const RELAY_LIST_TIMESTAMP_KEY_BASE = 'nostr_relay_list_timestamp';
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
 * JS thread after the user has navigated away (#286).
 *
 * `includeNonFollows` bypasses the parental-control follow gate at the
 * data layer so unfollowed senders' wraps land in `dmInbox`. Only the
 * dev-mode "Following only" toggle should pass `true` here; production
 * callers leave it undefined (default = enforce). The cache hydrate
 * step also honours this — without it, a previous follows-on refresh's
 * filtered cache would mask new unfollowed entries fetched this round. */
export interface RefreshDmInboxOptions {
  force?: boolean;
  signal?: AbortSignal;
  includeNonFollows?: boolean;
}

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
  addContact: (npubOrHex: string) => Promise<{ success: boolean; error?: string }>;
  sendDirectMessage: (
    recipientPubkey: string,
    plaintext: string,
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
  const [dmInbox, setDmInbox] = useState<DmInboxEntry[]>([]);
  const [dmInboxLoading, setDmInboxLoading] = useState(false);
  // Gates the live NIP-17 DM sub useEffect below. False on cold boot
  // so we don't burn JS-thread cycles unwrapping wraps the user can't
  // see yet (they're on Home, the Messages tab isn't mounted). Flipped
  // to true the first time Messages / Conversation / any DM-receiving
  // surface focuses via `armLiveDmSub()`. Once armed it stays armed for
  // the rest of the session. Cold-start Home stays responsive because
  // the per-wrap unwrap/route work moves to after the user has
  // explicitly chosen to look at messages.
  const [liveSubArmed, setLiveSubArmed] = useState(false);
  const [amberNip44Permission, setAmberNip44Permission] = useState<
    'unknown' | 'granted' | 'denied'
  >('unknown');
  // Multi-account registry (#288). Mirrors the SecureStore `identities_v1`
  // blob so the drawer header and AccountSwitcherSheet can render without
  // each rendering its own SecureStore round-trip. The `pubkey` state above
  // is the single source of truth for "who is the active identity"; this
  // array is the side-table of all signed-in identities for the switcher.
  const [identities, setIdentities] = useState<StoredIdentity[]>([]);

  // Single-flight guard: coalesce overlapping refreshDmInbox calls (e.g.
  // useFocusEffect firing while a pull-to-refresh is still in-flight) so
  // they don't race on the AsyncStorage wrap-id cache.
  const dmInboxInFlight = useRef<{
    promise: Promise<void>;
    includeNonFollows: boolean;
  } | null>(null);
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
  }, [pubkey, wipeAccountCaches, loadContactsFromCache, hydrateDmInboxFromCache]);

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
    [pubkey, loadContactsFromCache, hydrateDmInboxFromCache, loadRelays, loadProfile, loadContacts],
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
  const sendDirectMessage = useCallback(
    async (
      recipientPubkey: string,
      plaintext: string,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalizedRecipientPubkey = recipientPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalizedRecipientPubkey)) {
        return { success: false, error: 'Invalid public key format' };
      }
      // Union the user's published write relays with DEFAULT_RELAYS. Publish
      // uses Promise.any, so one responsive relay is enough — but a user
      // whose NIP-65 list has a single entry (and no in-app UI to edit it)
      // hits a single-point failure the moment that relay is slow.
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const rumor = nostrService.createDirectMessageRumor({
          senderPubkey: pubkey,
          recipientPubkey: normalizedRecipientPubkey,
          content: plaintext,
        });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          // Partial send — at least one wrap (recipient delivery and/or sender's own inbox copy) failed to publish. Surface as non-fatal failure so the composer keeps its draft and the user can retry, mirroring sendGroupMessage's pattern.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true };
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              // Keep pubkey on the seal — Amber misroutes kind=13 sign_event Intents without it (#356) and lands on its main Apps screen instead of the Sign Event sheet. Same rule as the group-send Amber path further down.
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
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
          // Same partial-send handling as the nsec path. Amber's per-recipient sequential signing means a cancelled prompt or a failed seal mid-loop leaves earlier wraps published but later ones unsent — surface that to the user instead of silent success.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
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
              // Keep pubkey on the seal — Amber misroutes kind=13 sign_event Intents without it (#356).
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
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
        const raw = await safeGetDmCacheItem(convCacheKey(pubkey, normalized));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    [pubkey],
  );

  const appendLocalDmMessage = useCallback(
    async (otherPubkey: string, msg: ConversationMessage): Promise<void> => {
      if (!pubkey) return;
      const normalized = otherPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return;
      // Serialize concurrent appends to the same conversation. Without
      // this, two rapid sends could both read the same `existing` array,
      // each merge their msg, both write back — last write wins, the
      // earlier optimistic row is silently lost. Per Copilot review #509.
      const chainKey = `${pubkey}:${normalized}`;
      const prev = appendLocalDmChains.get(chainKey) ?? Promise.resolve();
      const next = prev.then(async () => {
        try {
          const key = convCacheKey(pubkey, normalized);
          const raw = await AsyncStorage.getItem(key);
          const existing: ConversationMessage[] = raw
            ? (() => {
                try {
                  const parsed = JSON.parse(raw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          // Dedup on id (same key would arise from a double-tap retry).
          const map = new Map<string, ConversationMessage>();
          for (const m of existing) map.set(m.id, m);
          map.set(msg.id, msg);
          const merged = Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
          const capped =
            merged.length <= DM_CONV_CAP ? merged : merged.slice(merged.length - DM_CONV_CAP);
          await AsyncStorage.setItem(key, JSON.stringify(capped));
        } catch {
          // Swallow — the in-memory setMessages above already painted
          // the bubble. The remount-after-back regression is precisely
          // what this method exists to fix, so a write failure is
          // unfortunate but not destructive (next relay echo will
          // repopulate the cache).
        }
      });
      // `.catch` on the chain entry so a single failure doesn't poison
      // every subsequent append on this conversation.
      appendLocalDmChains.set(
        chainKey,
        next.catch(() => {}),
      );
      await next;
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
        safeGetDmCacheItem(convCacheKey(pubkey, normalized)),
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
          ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, pubkey)
          : signerType === 'amber'
            ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, pubkey)
            : null;
      const wrapCacheRaw = signerWrapCacheKey ? await safeGetDmCacheItem(signerWrapCacheKey) : null;
      const wrapCache = safeParseRecord<Nip17CacheEntry>(wrapCacheRaw);
      const cachedWrapEntries = Object.values(wrapCache);
      let skippedInboxFetch = false;
      let fastPathTouched = 0;
      if (cachedWrapEntries.length > 0) {
        // Cache populated — serve peer-matching wraps directly, skip relay fetch.
        for (const entry of cachedWrapEntries) {
          nip17CacheHits++;
          if (entry.partnerPubkey !== normalized) continue;
          // LRU touch (#193) — opening this thread is a "use" of these entries; without the touch they age out FIFO and a thread the user re-opens regularly can be evicted just because newer wraps arrived first.
          touchNip17CacheEntry(wrapCache, entry.wrapId);
          fastPathTouched++;
          decrypted.push({
            id: entry.wrapId,
            fromMe: entry.fromMe,
            text: entry.text,
            createdAt: entry.createdAt,
          });
        }
        skippedInboxFetch = true;
      }
      // Persist the touched-cache so LRU order survives restarts.
      if (fastPathTouched > 0 && signerWrapCacheKey) {
        await writeNip17Cache(signerWrapCacheKey, wrapCache);
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
            const nsecCacheKey = perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, pubkey);
            const raw = await safeGetDmCacheItem(nsecCacheKey);
            const cache = safeParseRecord<Nip17CacheEntry>(raw);
            const newlyCached: Nip17CacheEntry[] = [];
            let nip17Decrypted = 0;
            let threadTouched = 0;
            for (const wrap of kind1059) {
              const cached = cache[wrap.id];
              if (cached) {
                nip17CacheHits++;
                if (cached.partnerPubkey !== normalized) continue;
                // LRU touch (#193) — see fast-path above for rationale.
                touchNip17CacheEntry(cache, wrap.id);
                threadTouched++;
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
            if (newlyCached.length > 0 || threadTouched > 0) {
              await writeNip17Cache(nsecCacheKey, cache);
            }
          }
        } else if (signerType === 'amber') {
          const amberCacheKey = perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, pubkey);
          const raw = await safeGetDmCacheItem(amberCacheKey);
          const cache = safeParseRecord<Nip17CacheEntry>(raw);
          let threadTouched = 0;
          for (const wrap of kind1059) {
            const cached = cache[wrap.id];
            if (cached) {
              nip17CacheHits++;
              if (cached.partnerPubkey !== normalized) continue;
              touchNip17CacheEntry(cache, wrap.id);
              threadTouched++;
              decrypted.push({
                id: wrap.id,
                fromMe: cached.fromMe,
                text: cached.text,
                createdAt: cached.createdAt,
              });
              continue;
            }
            nip17FreshDecrypts++;
            // Thread view falls back to the Intent dialog if the silent path rejects — the user has actively opened this thread, one approval prompt per wrap is fine. Inbox refresh uses the silent-only path to avoid the flood; cached entries cover the hot path.
            try {
              const rumor = await unwrapWrapViaNip44(
                wrap,
                (ct, cp) => amberService.requestNip44Decrypt(ct, cp, pubkey),
                onSkip,
              );
              if (!rumor) continue;
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
          if (threadTouched > 0) {
            await writeNip17Cache(amberCacheKey, cache);
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
      // [PerfBlock] timing bracket — surfaces the wall-clock cost of
      // a full inbox refresh including NIP-17 decrypt loops. Look for
      // matched `refreshDmInbox: …ms` pairs in logcat to isolate
      // multi-second freezes that coincide with this call. #554.
      const __perfBlockStart = performance.now();
      const signal = opts?.signal;
      // Dev-only "Following only=off" bypass — read once at the top so
      // the closure captures a stable value across the async work below.
      // When true, all six follow-gate `continue`s in the decrypt loops
      // become no-ops AND the cache hydrate skips its filter so the
      // already-cached unfollowed entries don't get masked.
      const includeNonFollows = opts?.includeNonFollows === true;
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
      // Single-flight: piggy-back on in-flight task ONLY when its includeNonFollows matches; otherwise wait then re-run with the wider option.
      if (dmInboxInFlight.current) {
        if (dmInboxInFlight.current.includeNonFollows === includeNonFollows) {
          return dmInboxInFlight.current.promise;
        }
        await dmInboxInFlight.current.promise;
      }

      // Capture local references once so the closure isn't affected by
      // mid-flight signer / identity changes. If we detect pubkey/signerType
      // has changed by the time we're about to commit, we bail without
      // mutating state to avoid leaking entries into the wrong session.
      const refreshForPubkey = pubkey;
      // Local helper: encapsulates the follow gate so all seven sites in
      // the cache hydrate + NIP-04 + NIP-17 decrypt loops + final merge
      // reuse the same predicate. When includeNonFollows is true the
      // gate is a no-op (every pubkey passes), so callers can opt out
      // of the parental-control filter from a single switch.
      const refreshForSigner = signerType;
      const refreshFollows = followPubkeys;
      const passesFollowGate = (pk: string): boolean => includeNonFollows || refreshFollows.has(pk);

      const task = (async () => {
        setDmInboxLoading(true);
        try {
          const readRelays = getReadRelays();
          const refreshStart = performance.now();
          let nip04CacheHits = 0;
          let nip04FreshDecrypts = 0;
          // NIP-17 perf counters — emitted in the `[Perf] refreshDmInbox`
          // line so #193 can be tracked post-merge. `nip17Hits` /
          // `nip17Misses` capture the cache-hit ratio per refresh;
          // `nip17Evictions` shows whether the 5000-cap is actually
          // squeezing entries out (was previously invisible — the FIFO
          // sort-and-slice path ran silently).
          let nip17Hits = 0;
          let nip17Misses = 0;
          let nip17Evictions = 0;
          let nip17CacheSize = 0;
          // Number of actual `setTimeout(0)` yields the NIP-17 loop
          // performed this refresh — emitted in the [Perf] nip17-cache
          // line so we can track how often the new frame-budget
          // scheduler trips (#532). Higher = more breathing room
          // given back to the UI thread.
          let nip17YieldCount = 0;

          // PR B: load persisted inbox + last-seen so we can (a) paint
          // cached entries before the relay round-trip finishes and
          // (b) only fetch events newer than the last one we saw.
          const [cachedInboxRaw, lastSeen] = await Promise.all([
            safeGetDmCacheItem(inboxCacheKey(refreshForPubkey)),
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
            const filteredCache = cachedInbox.filter((e) => passesFollowGate(e.partnerPubkey));
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
            if (!passesFollowGate(partnerPubkey)) continue;
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
              // filter gate below. This is the fix for #176. Per-account
              // namespaced (#288).
              const nsecCacheKey = perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, refreshForPubkey);
              const raw = await safeGetDmCacheItem(nsecCacheKey);
              const cache = safeParseRecord<Nip17CacheEntry>(raw);
              const newlyCached: Nip17CacheEntry[] = [];
              let unfollowedPurged = 0;
              let touched = 0;
              // Frame-budget scheduler (#532): yield whenever we've held
              // the JS thread for >= DECRYPT_FRAME_BUDGET_MS, with the
              // count-based modulo kept as a safety cap. On abort, the
              // scheduler hard-cancels any pending setTimeout so the
              // loop unwinds in the next microtask instead of waiting
              // out one more scheduler round-trip.
              const nsecYield = createYieldScheduler({
                signal,
                safetyEvery: NIP17_LOOP_YIELD_EVERY,
              });
              try {
                for (const wrap of kind1059) {
                  // Time-budget yield + abort check (#286, #532). Covers
                  // the cache-hit path too — without it, a long run of
                  // cache hits walks the whole kind1059 list synchronously
                  // and any back-tap during refresh appears frozen.
                  await nsecYield.maybeYield();
                  if (signal?.aborted) return;
                  const cached = cache[wrap.id];
                  if (cached) {
                    nip17Hits++;
                    // Cache entry exists → it was from a followed sender
                    // when first stored. Re-check against the *current*
                    // follow set so unfollowed partners don't keep
                    // surfacing from cache. Purge the stale entry so we
                    // don't keep dragging it through every refresh until
                    // the 5000-cap LRU finally evicts it.
                    if (!passesFollowGate(cached.partnerPubkey)) {
                      delete cache[wrap.id];
                      unfollowedPurged++;
                      continue;
                    }
                    // LRU touch (#193): re-insert at the tail so this hot
                    // entry survives the next overflow eviction. Without
                    // this the cache is FIFO-by-first-write — a thread
                    // the user re-opens regularly can be evicted just
                    // because 5000 newer wraps happened to arrive first.
                    touchNip17CacheEntry(cache, wrap.id);
                    touched++;
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
                  nip17Misses++;
                  const rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
                  // No per-decrypt yield here: the frame-budget scheduler
                  // at the top of the loop already yields whenever the
                  // accumulated work exceeds DECRYPT_FRAME_BUDGET_MS,
                  // which captures the cost of unwrapWrapNsec naturally.
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
                  if (!passesFollowGate(partnership.partnerPubkey)) continue;
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
              } finally {
                nsecYield.dispose();
              }
              nip17YieldCount += nsecYield.yieldCount;

              // Persist if we mutated the cache for any reason: new
              // entries, follow-set purges, or LRU touches (#193) — the
              // touch reorders insertion order, and we need that order
              // on disk for it to survive app restart.
              if (newlyCached.length > 0 || unfollowedPurged > 0 || touched > 0) {
                nip17Evictions += await writeNip17Cache(nsecCacheKey, cache);
              }
              nip17CacheSize = Object.keys(cache).length;
            }
          } else if (refreshForSigner === 'amber' && kind1059.length > 0) {
            // Always run the unwrap loop — Amber's silent content-resolver path returns PERMISSION_NOT_GRANTED on the first wrap if the user hasn't granted nip44_decrypt yet, which we surface via setAmberNip44Permission('denied') so NostrScreen can show the one-shot "Grant permission in Amber" button. Closes #404.
            // Persistent cache keyed by wrap id. Only ever contains rumors from *followed* senders — see the filter gate below. Per-account namespaced (#288).
            const amberCacheKey = perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, refreshForPubkey);
            const raw = await safeGetDmCacheItem(amberCacheKey);
            const cache = safeParseRecord<Nip17CacheEntry>(raw);
            const newlyCached: Nip17CacheEntry[] = [];
            let permissionDenied = false;
            let touched = 0;
            let unfollowedPurged = 0;
            // Frame-budget scheduler (#532) — see nsec branch above.
            const amberYield = createYieldScheduler({
              signal,
              safetyEvery: NIP17_LOOP_YIELD_EVERY,
            });
            try {
              for (const wrap of kind1059) {
                // Time-budget yield + abort check (#286, #532) — see nsec branch above for rationale.
                await amberYield.maybeYield();
                if (signal?.aborted) return;
                const cached = cache[wrap.id];
                if (cached) {
                  nip17Hits++;
                  // Re-check against current follow set; purge if no longer followed so we don't drag stale entries through every refresh.
                  if (!passesFollowGate(cached.partnerPubkey)) {
                    delete cache[wrap.id];
                    unfollowedPurged++;
                    continue;
                  }
                  touchNip17CacheEntry(cache, wrap.id);
                  touched++;
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
                nip17Misses++;
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
                  if (!passesFollowGate(partnership.partnerPubkey)) continue;
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
            } finally {
              amberYield.dispose();
            }
            nip17YieldCount += amberYield.yieldCount;

            setAmberNip44Permission(permissionDenied ? 'denied' : 'granted');

            // Persist on new entries, LRU touches (#193 — touches reorder insertion order which we need on disk), or unfollowed-partner purges (so the purge survives the next launch).
            if (newlyCached.length > 0 || touched > 0 || unfollowedPurged > 0) {
              nip17Evictions += await writeNip17Cache(amberCacheKey, cache);
            }
            nip17CacheSize = Object.keys(cache).length;
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
          const filteredFinal = merged.filter((e) => passesFollowGate(e.partnerPubkey));

          // Perf summary: one line per refresh, grep with `\[Perf\] refreshDmInbox`.
          // The `nip17-cache` segment (#193) lets us see at a glance
          // whether the LRU swap is keeping hot entries warm: a healthy
          // long-running inbox should converge to hits >> misses with
          // size pinned at the 5000 cap and a non-zero evictions counter
          // each refresh once the cap is reached.
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
          console.log(
            `[Perf] nip17-cache: ` +
              `hits=${nip17Hits}, ` +
              `misses=${nip17Misses}, ` +
              `evictions=${nip17Evictions}, ` +
              `size=${nip17CacheSize}, ` +
              `yields=${nip17YieldCount} (budget=${DECRYPT_FRAME_BUDGET_MS}ms, cap=${NIP17_LOOP_YIELD_EVERY})`,
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

      dmInboxInFlight.current = { promise: task, includeNonFollows };
      try {
        await task;
        dmInboxLastRefreshAt.current = performance.now();
      } finally {
        dmInboxInFlight.current = null;
        const __perfBlockMs = Math.round(performance.now() - __perfBlockStart);
        // Only surface costly refreshes — sub-200 ms ones aren't
        // contributors to the multi-second freezes we're hunting.
        if (__perfBlockMs > 200) {
          console.log(`[PerfBlock] refreshDmInbox: ${__perfBlockMs}ms`);
        }
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

  // Live mirror of `followPubkeys` for the long-lived kind-1059
  // subscription below. The sub captures `followPubkeys` at the time
  // the effect ran; without this ref, a follow added after sub
  // creation would be invisible to the gate until the sub
  // reconnected. Reading via ref keeps the gate fresh per event
  // without thrashing the subscription on every contacts update.
  const followPubkeysRef = useRef(followPubkeys);
  useEffect(() => {
    followPubkeysRef.current = followPubkeys;
  }, [followPubkeys]);

  // Idempotent — any DM-surface (Messages tab, ConversationScreen)
  // calls this on focus. The first call flips `liveSubArmed`, the
  // gated useEffect below re-runs and opens the live NIP-17 sub.
  // Subsequent calls are no-ops (React bails on identical setState).
  const armLiveDmSub = useCallback(() => {
    setLiveSubArmed(true);
  }, []);

  // In-memory dedup Set that survives live-DM-sub re-opens. The sub
  // useEffect below re-runs when getReadRelays changes — e.g. when the
  // relay-list refresh adds a new relay 9 s into cold start. Without
  // this ref, the new effect instance creates a fresh Set and re-seeds
  // it from AsyncStorage's wrap cache. That snapshot is stale by the
  // deferred-write window, so all wraps the prior sub already
  // decrypted re-stream from the relays (same `since` cursor) and get
  // re-routed/re-decrypted. Carrying the Set forward keeps the
  // early-return in handleInboxEvent honest across the re-open.
  // Reset only when the viewer changes (sign out / account switch).
  const knownWrapIdsRef = useRef<{ pubkey: string | null; set: Set<string> }>({
    pubkey: null,
    set: new Set(),
  });

  // Long-lived kind-1059 (NIP-17 gift wrap) subscription for the
  // current viewer (#349). Without this, new incoming wraps only
  // surface via pull-to-refresh or the 30 s-TTL useFocusEffect on
  // MessagesScreen — which means the user sits on the Messages tab
  // for up to half a minute after a friend sends a DM with nothing
  // happening on screen.
  //
  // Per-event handler:
  //  1. Dedupe against (a) a session-scoped `seen` set so the same
  //     wrap delivered by multiple relays is processed once, and
  //     (b) the persisted Nip17CacheEntry cache so wraps previously
  //     decrypted by `refreshDmInbox` short-circuit.
  //  2. Decrypt with the active signer's NIP-17 helper — same code
  //     path used by `refreshDmInbox` (`unwrapWrapNsec` for nsec,
  //     `unwrapWrapViaNip44` + Amber silent-decrypt for Amber).
  //  3. Try `tryRouteGroupRumor` first. Multi-recipient kind-14
  //     rumors land in group storage and fire the existing
  //     `notifyGroupMessage` listener — open GroupConversationScreen
  //     re-loads automatically.
  //  4. 1:1 rumors that pass the follow gate are written to the
  //     persistent NIP-17 wrap cache (so the next inbox / thread open
  //     can short-circuit), appended to `dmInbox` state, and
  //     broadcast to `dmMessageListeners` so an open
  //     ConversationScreen for that peer re-fetches.
  //
  // Follow gate: matches `refreshDmInbox`'s default — non-followed
  // sender wraps are decrypted (so we can group-route them) but NOT
  // cached or surfaced to dmInbox state. The dev-mode "All (dev)"
  // toggle still relies on the next pull-to-refresh to surface
  // unfollowed live wraps; live delivery for that view is a
  // follow-up. Rationale: caching unfollowed plaintext on disk
  // violates the "B1 — never cache rumors from non-followed senders"
  // invariant in `refreshDmInbox`.
  //
  // Writes to the wrap + inbox caches go through a serial queue to
  // avoid racing with `refreshDmInbox` (both read-modify-write the
  // same AsyncStorage blobs). The queue is per-effect-instance; the
  // single-flight guard in `refreshDmInbox` serialises on its side.
  useEffect(() => {
    if (!isLoggedIn || !pubkey || !signerType) return;
    // Wait until a DM-surface (Messages tab, ConversationScreen) has
    // focused at least once before opening the live sub. On cold boot
    // the user is on Home, so we skip ~5 s of per-wrap unwrap/route/
    // dedup JS-thread work. First Messages focus flips `liveSubArmed`,
    // this effect re-runs, sub opens, drain happens then — when the
    // user is explicitly looking at messages and a brief loading
    // state is expected.
    if (!liveSubArmed) return;
    const viewerPubkey = pubkey;
    const activeSigner = signerType;
    const readRelays = getReadRelays();
    const seen = new Set<string>();
    const SEEN_CAP = 4096;
    // In-memory mirror of the persisted NIP-17 wrap-id cache. Backed
    // by `knownWrapIdsRef` so the Set survives this effect's re-runs
    // (relay-list change → fresh effect instance). Seeded by union
    // below from AsyncStorage's wrap cache, but does NOT replace any
    // entries the prior sub instance added in-memory but the deferred
    // writeChain hasn't persisted yet. Per issue #505 — the relay
    // re-streams the backlog since the last `since` cursor, and on a
    // busy account that's 100+ wraps in ~12 s, almost all of which are
    // already known; pre-#505 the dedup-cache hit check was
    // lazy-populated and downstream of several per-event operations.
    if (knownWrapIdsRef.current.pubkey !== viewerPubkey) {
      knownWrapIdsRef.current = { pubkey: viewerPubkey, set: new Set() };
    }
    const knownWrapIds: Set<string> = knownWrapIdsRef.current.set;
    let cancelled = false;
    let writeChain: Promise<void> = Promise.resolve();

    // Coalesce per-event inbox merges into one setDmInbox call per ~150 ms or per 25 events. Without this, a relay-restream burst (e.g. cold start with 200+ kind-4 events queued) causes one React re-render per event = 30+ rerenders/sec on the JS thread, which is what locks the UI for 30 seconds. Batching collapses that into ~6 rerenders/sec at most. Notifications still fire per-event so unread counts/sounds aren't dropped.
    let pendingInboxEntries: DmInboxEntry[] = [];
    let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const PENDING_FLUSH_MS = 150;
    const PENDING_FLUSH_THRESHOLD = 25;
    const flushPendingInbox = (): void => {
      if (pendingFlushTimer) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = null;
      }
      if (pendingInboxEntries.length === 0) return;
      const batch = pendingInboxEntries;
      pendingInboxEntries = [];
      setDmInbox((prev) => mergeInboxEntries(prev, batch, DM_INBOX_CAP));
    };
    const queueInboxEntry = (entry: DmInboxEntry): void => {
      pendingInboxEntries.push(entry);
      if (pendingInboxEntries.length >= PENDING_FLUSH_THRESHOLD) {
        flushPendingInbox();
        return;
      }
      if (pendingFlushTimer === null) {
        pendingFlushTimer = setTimeout(flushPendingInbox, PENDING_FLUSH_MS);
      }
    };

    const handleInboxEvent = async (ev: nostrService.RawInboxDmEvent): Promise<void> => {
      // Earliest-possible short-circuit for NIP-17 wraps we already
      // decrypted on a previous launch. Cost saved per backlog wrap:
      // console.log + seen.has + seen.add + kind dispatch + cacheKey
      // build + the async AsyncStorage.getItem race. On a busy
      // fixture with 100+ wraps in the backlog this compressed the
      // cold-start JS-thread occupation window from ~12 s to <1 s.
      // Per issue #505.
      if (ev.kind === 1059 && knownWrapIds.has(ev.id)) return;
      // Eagerly claim this wrap.id in the in-memory dedup Set before
      // doing any async work. The deferred writeChain at the bottom of
      // this handler also does this, but only after AsyncStorage I/O
      // completes — leaving a window where a re-opened sub (relay-list
      // change mid cold start) re-streams the same wrap and gets past
      // the early-return because the Set hasn't been updated yet.
      // Set.add is idempotent so the trailing writeChain add becomes
      // a no-op. kind 4 has its own `seen` Set below.
      if (ev.kind === 1059) knownWrapIds.add(ev.id);
      if (__DEV__) console.log(`[Nostr] live evt kind=${ev.kind} recv ${ev.id.slice(0, 8)}`);
      if (cancelled) return;
      if (seen.has(ev.id)) {
        if (__DEV__) console.log(`[Nostr] live evt ${ev.id.slice(0, 8)} dedup-seen`);
        return;
      }
      seen.add(ev.id);
      // Drop oldest ~25% so a long-lived sub under spam doesn't grow the Set unboundedly.
      if (seen.size > SEEN_CAP) {
        const drop = Math.floor(SEEN_CAP / 4);
        const it = seen.values();
        for (let i = 0; i < drop; i++) seen.delete(it.next().value!);
      }

      // NIP-04 (kind-4) — partner is in the envelope; decrypt directly with the active signer.
      if (ev.kind === 4) {
        const fromMe = ev.pubkey === viewerPubkey;
        const recipientTag = ev.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
        const partnerPubkey = fromMe ? recipientTag : ev.pubkey.toLowerCase();
        if (!partnerPubkey || !/^[0-9a-f]{64}$/.test(partnerPubkey)) {
          if (__DEV__) console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} no-partner`);
          return;
        }
        let plaintext = nip04PlaintextCache.get(ev.id);
        if (plaintext === undefined) {
          try {
            if (activeSigner === 'nsec') {
              const secretKey = await getMemoisedSecretKey(viewerPubkey);
              if (!secretKey) return;
              plaintext = await nostrService.decryptNip04WithSecret(
                secretKey,
                partnerPubkey,
                ev.content,
              );
            } else if (activeSigner === 'amber') {
              plaintext = await amberService.requestNip04Decrypt(
                ev.content,
                partnerPubkey,
                viewerPubkey,
              );
            } else {
              return;
            }
          } catch (error) {
            if (__DEV__)
              console.warn(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} decrypt failed:`, error);
            return;
          }
          if (!plaintext) {
            if (__DEV__) console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} empty-plaintext`);
            return;
          }
          nip04PlaintextCache.set(ev.id, plaintext);
        } else if (__DEV__) {
          console.log(`[Nostr] live kind-4 ${ev.id.slice(0, 8)} dedup-cache`);
        }
        if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

        // Follow gate (mirrors refreshDmInbox B1) — incoming kind-4 from a non-followed sender is dropped from inbox state. Outgoing (fromMe) bypasses since we sent it.
        if (!fromMe && !followPubkeysRef.current.has(partnerPubkey)) {
          if (__DEV__)
            console.log(
              `[Nostr] live kind-4 ${ev.id.slice(0, 8)} dropped by follow-gate (partner=${partnerPubkey.slice(0, 8)})`,
            );
          return;
        }

        const k4InboxEntry: DmInboxEntry = {
          id: ev.id,
          partnerPubkey,
          fromMe,
          createdAt: ev.created_at,
          text: plaintext,
          wireKind: 4,
        };
        // No wrap-id cache for kind-4 (plaintext lives in RAM-only LRU); only persist the inbox preview blob. Same writeChain as kind-1059 to serialize concurrent inbox writes. Also bump inboxLastSeenKey so refreshDmInbox's kind-4 `since` filter advances and doesn't re-fetch already-seen events on the next refresh.
        writeChain = writeChain
          .then(async () => {
            if (cancelled) return;
            const inboxRaw = await safeGetDmCacheItem(inboxCacheKey(viewerPubkey));
            const cachedInbox: DmInboxEntry[] = inboxRaw
              ? (() => {
                  try {
                    const parsed = JSON.parse(inboxRaw);
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })()
              : [];
            const merged = mergeInboxEntries(cachedInbox, [k4InboxEntry], DM_INBOX_CAP);
            // Re-check after the await: logout may have multiRemove'd these keys while we were reading. Without this, a freshly-decrypted DM would re-populate disk after the user signed out.
            if (cancelled) return;
            await AsyncStorage.setItem(inboxCacheKey(viewerPubkey), JSON.stringify(merged)).catch(
              () => {},
            );
            const lastSeenRaw = await AsyncStorage.getItem(inboxLastSeenKey(viewerPubkey));
            const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
            if (ev.created_at > lastSeen) {
              if (cancelled) return;
              await AsyncStorage.setItem(
                inboxLastSeenKey(viewerPubkey),
                String(ev.created_at),
              ).catch(() => {});
            }
          })
          .catch((e) => {
            if (__DEV__) console.warn('[Nostr] live kind-4 persist failed:', e);
          });
        await writeChain;
        if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

        queueInboxEntry(k4InboxEntry);
        notifyDmMessage(partnerPubkey);
        if (__DEV__)
          console.log(
            `[Nostr] live kind-4 ${ev.id.slice(0, 8)} surfaced (partner=${partnerPubkey.slice(0, 8)}, fromMe=${fromMe})`,
          );
        return;
      }

      // NIP-17 (kind-1059) — existing gift-wrap unwrap path. Local alias preserves original variable name without renaming through the body below.
      const wrap = ev;

      // Cache short-circuit: if refreshDmInbox already decrypted this
      // wrap and persisted it, the live sub has nothing to do — the
      // event was either delivered before the sub opened or arrived
      // via two paths (live + a near-simultaneous force-refresh).
      const cacheKey =
        activeSigner === 'nsec'
          ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, viewerPubkey)
          : activeSigner === 'amber'
            ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, viewerPubkey)
            : null;
      if (!cacheKey) return;
      // knownWrapIds is seeded eagerly up-front below (before the
      // subscription opens) — the in-flow lazy-load was removed in
      // #505 because it (a) raced when many wraps arrived together
      // and each tried to seed the Set concurrently, and (b) made
      // dedup hits pay through a long per-event prologue before the
      // check fired. The check for cached IDs now lives at the very
      // top of this function for kind-1059 events. This line is only
      // reached for genuinely new (not-yet-cached) wraps, OR — in
      // the rare case the seed failed (see the catch in the sub-open
      // block) — for wraps that should have been pre-known. In that
      // case the wrap re-decrypts; the persistent `wrapCache` write
      // below still guards against the on-disk cache filling
      // unboundedly, but the `dmMessageListeners` may fire a second
      // time for messages already shown in a previous session.
      // Acceptable trade-off because the seed only fails on
      // AsyncStorage I/O error which is extremely rare on Android.

      const onSkip = (reason: string, wrapId: string) => {
        if (__DEV__) console.warn(`[Nostr] live NIP-17 unwrap skip (${wrapId}): ${reason}`);
      };

      // Yield to the event loop before each per-wrap decryption. The
      // live sub fans out wraps from the relay one at a time, but
      // when the sub catches up a backlog after cold start, multiple
      // wraps land in the same JS task — each sync `unwrapWrapNsec`
      // is ~1-3 ms and they pile up to tens-of-ms of unbroken
      // blocking, dropping bottom-sheet animation frames. A single
      // setTimeout(0) per wrap costs ~0 ms but lets RN re-flush
      // pending UI events between decryptions. See issue #496.
      await yieldToEventLoop();

      let rumor: DecodedRumor | null = null;
      if (activeSigner === 'nsec') {
        const secretKey = await getMemoisedSecretKey(viewerPubkey);
        if (!secretKey) return;
        rumor = unwrapWrapNsec(wrap, secretKey, onSkip);
      } else if (activeSigner === 'amber') {
        try {
          rumor = await unwrapWrapViaNip44(
            wrap,
            (ct, cp) => amberService.requestNip44DecryptSilent(ct, cp, viewerPubkey),
            onSkip,
          );
        } catch (error) {
          const code = (error as { code?: string })?.code;
          const message = (error as Error)?.message ?? '';
          if (code === 'PERMISSION_NOT_GRANTED' || /PERMISSION_NOT_GRANTED/.test(message)) {
            // Same flag refreshDmInbox sets — Account screen surfaces
            // a one-tap grant button; without it, the live sub would
            // silently fail every wrap until the user re-enabled
            // Amber's blanket nip44_decrypt.
            setAmberNip44Permission('denied');
            return;
          }
          if (__DEV__) console.warn('[Nostr] live Amber NIP-17 unwrap failed:', error);
          return;
        }
      }
      if (!rumor) {
        if (__DEV__) console.log(`[Nostr] live wrap ${wrap.id.slice(0, 8)} no-rumor`);
        return;
      }
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      // Group-route first — multi-recipient rumors are owned by the
      // group surface, not the 1:1 inbox. tryRouteGroupRumor handles
      // appendGroupMessage + notifyGroupMessage internally so an open
      // GroupConversationScreen auto-refreshes.
      const routeResult = await tryRouteGroupRumor(rumor, viewerPubkey, wrap.id);
      if (routeResult.kind !== 'not-group') {
        if (__DEV__)
          console.log(
            `[Nostr] live wrap ${wrap.id.slice(0, 8)} group-routed (${routeResult.kind})`,
          );
        return;
      }

      const partnership = partnerFromRumor(rumor, viewerPubkey);
      if (!partnership) {
        if (__DEV__) console.log(`[Nostr] live wrap ${wrap.id.slice(0, 8)} no-partnership`);
        return;
      }

      // Follow gate (mirrors refreshDmInbox B1) — keeps non-followed
      // sender plaintext off AsyncStorage. Group rumors above don't
      // hit this gate because group membership is its own auth signal.
      if (!followPubkeysRef.current.has(partnership.partnerPubkey)) {
        if (__DEV__)
          console.log(
            `[Nostr] live wrap ${wrap.id.slice(0, 8)} dropped by follow-gate (partner=${partnership.partnerPubkey.slice(0, 8)})`,
          );
        return;
      }

      const entry: Nip17CacheEntry = {
        id: wrap.id,
        wrapId: wrap.id,
        partnerPubkey: partnership.partnerPubkey,
        fromMe: partnership.fromMe,
        createdAt: rumor.created_at,
        text: rumor.content,
        wireKind: rumor.kind,
      };
      const inboxEntry: DmInboxEntry = {
        id: entry.id,
        partnerPubkey: entry.partnerPubkey,
        fromMe: entry.fromMe,
        createdAt: entry.createdAt,
        text: entry.text,
        wireKind: entry.wireKind,
      };

      // Serialise read→merge→write of wrap+inbox blobs so concurrent live wraps don't race each other.
      // The trailing `.catch` is load-bearing: without it a single throw leaves `writeChain` rejected and every later `.then(...)` skips its onFulfilled.
      writeChain = writeChain
        .then(async () => {
          if (cancelled) return;
          const wrapRaw = await AsyncStorage.getItem(cacheKey);
          const wrapCache = safeParseRecord<Nip17CacheEntry>(wrapRaw);
          if (wrapCache[wrap.id]) {
            knownWrapIds?.add(wrap.id);
            return;
          }
          wrapCache[wrap.id] = entry;
          // Re-check after each await: logout may have multiRemove'd these keys while we were reading. Without these guards a freshly-decrypted wrap would re-populate disk after the user signed out.
          if (cancelled) return;
          await writeNip17Cache(cacheKey, wrapCache);
          knownWrapIds?.add(wrap.id);

          const inboxRaw = await safeGetDmCacheItem(inboxCacheKey(viewerPubkey));
          const cachedInbox: DmInboxEntry[] = inboxRaw
            ? (() => {
                try {
                  const parsed = JSON.parse(inboxRaw);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];
          const merged = mergeInboxEntries(cachedInbox, [inboxEntry], DM_INBOX_CAP);
          if (cancelled) return;
          await AsyncStorage.setItem(inboxCacheKey(viewerPubkey), JSON.stringify(merged)).catch(
            () => {},
          );
        })
        .catch((e) => {
          if (__DEV__) console.warn('[Nostr] live wrap persist failed:', e);
        });
      await writeChain;
      if (cancelled || viewerPubkey !== pubkey || activeSigner !== signerType) return;

      queueInboxEntry(inboxEntry);
      notifyDmMessage(partnership.partnerPubkey);
      if (__DEV__)
        console.log(
          `[Nostr] live wrap ${wrap.id.slice(0, 8)} surfaced (partner=${partnership.partnerPubkey.slice(0, 8)})`,
        );
    };

    // Load the persisted kind-4 lastSeen cursor before opening the sub so the relay only re-streams events the user hasn't seen yet — without this, a heavy DM history floods the JS thread with hundreds of `live evt kind=4` deliveries on every cold start (each one a NIP-04 decrypt round-trip + setDmInbox re-render).
    let unsubscribe: (() => void) | null = null;
    (async () => {
      // Reuse loadLastSeen so parsing/validation matches refreshDmInbox's existing reads of the same key (#409 review). loadLastSeen returns undefined for missing/invalid values, which subscribeInboxDmsForViewer then falls back to its 7-day floor for.
      const sinceK4 = await loadLastSeen(inboxLastSeenKey(viewerPubkey)).catch(() => undefined);
      if (cancelled) return;
      // Pre-seed `knownWrapIds` from the persisted NIP-17 wrap-id
      // cache. One JSON.parse here saves N inline AsyncStorage reads
      // + parses inside `handleInboxEvent` when the relay re-streams
      // the backlog. The early-return in `handleInboxEvent` (top)
      // checks this Set as the very first thing and skips all
      // downstream per-event work for cache hits. Per issue #505.
      const wrapCacheKey =
        activeSigner === 'nsec'
          ? perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, viewerPubkey)
          : activeSigner === 'amber'
            ? perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, viewerPubkey)
            : null;
      if (wrapCacheKey) {
        try {
          const seedRaw = await AsyncStorage.getItem(wrapCacheKey);
          const seedCache = safeParseRecord<Nip17CacheEntry>(seedRaw);
          for (const id of Object.keys(seedCache)) knownWrapIds.add(id);
          // Also seed from persisted group messages — group-routed wraps
          // never land in the 1:1 wrapCache (the tryRouteGroupRumor
          // branch returns before the cache write). Without this union
          // every cold start re-decrypts + re-routes the same group
          // wraps the relay re-streams since the last `since` cursor.
          const dmCount = knownWrapIds.size;
          const groupWrapIds = await listPersistedGroupWrapIds();
          for (const id of groupWrapIds) knownWrapIds.add(id);
          if (__DEV__) {
            console.log(
              `[Nostr] live DM sub: seeded knownWrapIds with ${dmCount} dm + ${knownWrapIds.size - dmCount} group wraps`,
            );
          }
        } catch (e) {
          // Seed-from-disk failed — leave knownWrapIds as the empty
          // Set we initialised at outer-scope. Cached wraps re-stream
          // through the full handler (decrypt, route, write-cache,
          // queueInboxEntry, notifyDmMessage). Two observable side
          // effects vs the pre-#505 in-flow dedup check:
          //   1. `dmMessageListeners` registered for an open
          //      conversation will re-fire for messages already
          //      surfaced in a prior session.
          //   2. The `unwrapWrapNsec` / `unwrapWrapViaNip44` call
          //      runs unnecessarily for each cached wrap (1–3 ms each).
          // The persistent on-disk wrapCache write is idempotent —
          // it doesn't grow unboundedly. We accept this regression on
          // the failure path because (a) AsyncStorage.getItem I/O
          // errors are extremely rare on Android, and (b) the
          // alternative (resurrecting the lazy-load inside the
          // handler) would re-introduce the race + per-event prologue
          // cost that motivated #505 in the first place.
          if (__DEV__)
            console.warn('[Nostr] live DM sub: knownWrapIds seed failed, dedup degraded:', e);
        }
      }
      if (cancelled) return;
      unsubscribe = nostrService.subscribeInboxDmsForViewer({
        viewerPubkey,
        relays: readRelays,
        sinceK4,
        onEvent: (ev) => {
          // Fire-and-forget: handleInboxEvent awaits its own state, and any throw is caught + logged here so the sub keeps running.
          handleInboxEvent(ev).catch((e) => {
            if (__DEV__) console.warn('[Nostr] live DM handler failed:', e);
          });
        },
      });
      if (__DEV__) {
        console.log(
          `[Nostr] live DM sub (kinds 4 + 1059) opened for ${viewerPubkey.slice(0, 8)} on ${readRelays.length} relays, sinceK4=${sinceK4 ?? 'default-90d'}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      flushPendingInbox();
      if (unsubscribe) unsubscribe();
    };
  }, [isLoggedIn, pubkey, signerType, getReadRelays, liveSubArmed]);

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
