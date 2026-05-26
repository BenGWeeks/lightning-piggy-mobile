import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { evictNip17CacheBytes, evictNip17CacheOverflow } from '../utils/nip17Cache';
import { utf8ByteSize } from '../utils/byteSize';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import type { ConversationMessage } from './nostrContextTypes';

// AsyncStorage keys for the NIP-17 gift-wrap caches. Both signer paths
// use the same cache shape (wrap-id → decrypted rumor entry); they're
// kept under separate keys so cross-signer login on the same device
// doesn't leak plaintext between identities. As of #288 the keys are
// also per-account namespaced — each base is suffixed with `_${pubkey}`
// via `perAccountKey()` at every read/write site.
export const AMBER_NIP17_CACHE_KEY_BASE = 'amber_nip17_cache_v1';
export const NSEC_NIP17_CACHE_KEY_BASE = 'nsec_nip17_cache_v1';
// Count cap for the wrap plaintext cache. High because the cache is now
// file-backed (no ~2 MB SQLite row limit), so the byte cap below is the
// real binding limit — the count cap is just a sanity ceiling (#687).
export const NIP17_CACHE_CAP = 50_000;
// The wrap cache (wrap-id -> decrypted plaintext) is persisted to a FILE,
// not an AsyncStorage row. AsyncStorage rows hit Android's ~2 MB SQLite
// CursorWindow limit on READ; once the cache passed that it failed to
// hydrate (and under the old 1.5 MB write cap a large inbox was mostly
// evicted), so the dedup signal was lost and EVERY cold start re-decrypted
// the whole inbox — a ~64-88 s JS-thread freeze (#687). Files have no
// per-row read cap, so the cache holds the whole inbox and dedup hits.
export const WRAP_CACHE_MAX_BYTES = 12_000_000;
export const isWrapCacheKey = (key: string): boolean =>
  key.startsWith(AMBER_NIP17_CACHE_KEY_BASE) || key.startsWith(NSEC_NIP17_CACHE_KEY_BASE);
// The key is already filesystem-safe (base + '_' + hex pubkey).
export const wrapCacheFileName = (key: string): string => `${key}.json`;
// Legacy AsyncStorage key from the now-removed "Enable NIP-17 on Amber" toggle (#404). Cleared on logout so old installs don't leave dead bytes around.
export const AMBER_NIP17_ENABLED_KEY_LEGACY = 'amber_nip17_enabled';

/** Persistent wrap-id → DmInboxEntry cache. Only ever contains rumors
 * from followed senders — see refreshDmInbox's filter gate. */
export type Nip17CacheEntry = DmInboxEntry & { wrapId: string };

/** Parse an AsyncStorage JSON blob into an object-keyed record, falling
 * back to `{}` if the value is missing, not valid JSON, or not an
 * object. A corrupted cache should be treated as a cold cache rather
 * than an exception that aborts the caller. */
export function safeParseRecord<T>(raw: string | null): Record<string, T> {
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

/** Persist a wrap-id cache back to its per-account file (expo-file-system,
 * #689 — no longer AsyncStorage; the old row blew the ~2 MB CursorWindow read
 * cap), enforcing the size cap in insertion order (oldest-inserted evicts
 * first). Combined with
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
export async function writeNip17Cache(
  storageKey: string,
  cache: Record<string, Nip17CacheEntry>,
): Promise<number> {
  const evicted = evictNip17CacheOverflow(cache, NIP17_CACHE_CAP);
  // Byte cap — generous now the cache is file-backed (no ~2 MB SQLite
  // CursorWindow read limit). The old 1.5 MB AsyncStorage cap evicted most
  // of a large inbox, losing the dedup signal and re-decrypting it on every
  // cold start (#687).
  const evictedBytes = evictNip17CacheBytes(cache, WRAP_CACHE_MAX_BYTES);
  try {
    const f = new File(Paths.document, wrapCacheFileName(storageKey));
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(cache));
    // Retire any legacy AsyncStorage row so the old (possibly unreadable /
    // oversized) copy stops shadowing the file + eating the 2 MB budget.
    AsyncStorage.removeItem(storageKey).catch(() => {});
  } catch (err) {
    console.warn(`[Nostr] NIP-17 cache file write failed (${storageKey}):`, err);
  }
  return evicted + evictedBytes;
}

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
export const DM_INBOX_REFRESH_TTL_MS = 30_000;

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
export const DM_INBOX_CACHE_PREFIX = 'nostr_dm_inbox_v1_';
export const DM_INBOX_LAST_SEEN_PREFIX = 'nostr_dm_inbox_last_seen_v1_';
export const DM_CONV_CACHE_PREFIX = 'nostr_dm_conv_v1_';
export const DM_CONV_LAST_SEEN_PREFIX = 'nostr_dm_conv_last_seen_v1_';
export const DM_INBOX_CAP = 1000;
export const DM_CONV_CAP = 500;
// Hard byte ceiling for a single DM cache row. Android's SQLite
// CursorWindow caps a row at ~2 MB — past it the *read* throws
// SQLiteBlobTooBigException, the cache silently fails to hydrate, and
// every cold start falls back to a full relay restream + NIP-17
// re-decrypt (a ~70s JS-thread stall). The count caps above aren't
// enough when messages are long, so the merge fns trim by size too.
export const DM_CACHE_MAX_BYTES = 1_500_000;

export function inboxCacheKey(user: string) {
  return DM_INBOX_CACHE_PREFIX + user;
}
export function inboxLastSeenKey(user: string) {
  return DM_INBOX_LAST_SEEN_PREFIX + user;
}
export function convCacheKey(user: string, peer: string) {
  return DM_CONV_CACHE_PREFIX + user + '_' + peer;
}
export function convLastSeenKey(user: string, peer: string) {
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
export async function safeGetDmCacheItem(key: string): Promise<string | null> {
  // Wrap plaintext caches are file-backed — files have no ~2 MB SQLite
  // CursorWindow row read cap, so a large inbox hydrates instead of
  // failing and re-decrypting every cold start (#687).
  if (isWrapCacheKey(key)) {
    try {
      const f = new File(Paths.document, wrapCacheFileName(key));
      if (f.exists) return await f.text();
      // One-time migration: seed the file from the legacy AsyncStorage row
      // (if it's still readable) so existing installs keep their cache;
      // then retire the row. An unreadable legacy row just yields null and
      // the next refresh repopulates the file.
      const legacy = await AsyncStorage.getItem(key).catch(() => null);
      if (legacy) {
        try {
          f.create();
          f.write(legacy);
          // Retire the legacy row only AFTER the file write succeeds — a
          // failed migration must not discard a usable cache (#689 review).
          AsyncStorage.removeItem(key).catch(() => {});
        } catch {
          // Migration failed — leave the AsyncStorage row intact; the next
          // write/refresh retries.
        }
      }
      return legacy;
    } catch (err) {
      console.warn(`[Nostr] NIP-17 cache file read failed — treating as empty (${key}):`, err);
      return null;
    }
  }
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
export async function loadDmInboxFromCache(pubkey: string): Promise<DmInboxEntry[]> {
  try {
    const raw = await safeGetDmCacheItem(inboxCacheKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadLastSeen(key: string): Promise<number | undefined> {
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
export function mergeInboxEntries(
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
export const LOCAL_DM_ECHO_WINDOW_SECS = 30;

export function mergeConversationMessages(
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
