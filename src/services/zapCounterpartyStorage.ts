/**
 * AsyncStorage-backed cache of resolved Nostr counterparties for
 * payments, keyed by payment hash.
 *
 * Two writers populate this store:
 *
 *  - `SendSheet` / outgoing zaps — the sender is *us*; the recipient's
 *    pubkey + profile is whatever contact / search-hit triggered the
 *    Send. Rather than round-trip through relays we record it directly
 *    here so the resolver can attribute the outgoing tx without
 *    re-querying.
 *
 *  - `NostrContext` DM scanner (#126) — when a friend DMs us a bolt11
 *    invoice we map `payment_hash → senderPubkey` so the eventual
 *    outgoing payment is attributed back to that friend; conversely,
 *    when we DM an invoice to a friend we map `payment_hash →
 *    recipientPubkey` so the eventual incoming payment is attributed.
 *
 * The store itself doesn't care which writer created an entry — it's a
 * direction-agnostic `paymentHash → ZapCounterpartyInfo` map.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ZapCounterpartyInfo } from '../types/wallet';

const STORAGE_KEY = 'zap_counterparties_v1';
// Entries per device. Outgoing zaps are infrequent enough that a few
// hundred is plenty; the LRU cap just keeps the single JSON blob from
// growing unbounded over the lifetime of the install.
const MAX_ENTRIES = 500;
// How long a *negative* attribution (info === null) is trusted before
// the resolver retries. Positive attributions never expire — once we've
// resolved a zap's counterparty it doesn't change. Negative attributions
// expire because a later-published receipt should still be discoverable
// rather than blacklisted forever (issue #127).
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = {
  /**
   * Resolved counterparty for the payment, OR `null` for a negative
   * attribution ("we checked relays, no zap receipt exists"). The null
   * variant is honoured up to NEGATIVE_TTL_MS old; past that the entry
   * is treated as absent so the resolver tries again.
   */
  info: ZapCounterpartyInfo | null;
  /** Epoch ms when the entry was written — used for LRU + negative TTL. */
  savedAt: number;
};

type CacheShape = Record<string, Entry>;

let memoryCache: CacheShape | null = null;
// Bumps on every write so the resolver can short-circuit when neither the
// pending tx set nor the storage state has changed.
let writeVersion = 0;

export function getWriteVersion(): number {
  return writeVersion;
}

async function load(): Promise<CacheShape> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as CacheShape) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function persist(cache: CacheShape): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage failure is non-fatal — we'll just miss the attribution
    // on next app launch. Don't bubble and break the send flow.
  }
}

/**
 * Record counterparty info for a payment, keyed by payment hash. Used
 * by both directions: outgoing (we paid X), and the inbound-DM-bolt11
 * scanner (X DM'd us an invoice). Evicts the oldest entries if we cross
 * `MAX_ENTRIES`. Idempotent — repeated writes with equivalent info are
 * a no-op (no `writeVersion` bump, no AsyncStorage write), so the
 * inbox-scan effect can safely re-run on every dmInbox / contacts
 * re-render without churning the cache.
 */
export async function recordCounterparty(
  paymentHash: string,
  info: ZapCounterpartyInfo,
): Promise<void> {
  await record(paymentHash, info);
}

/**
 * Record a *negative* attribution — we ran the relay scan and found no
 * matching zap receipt. Honoured for `NEGATIVE_TTL_MS`, after which the
 * resolver retries (in case the receipt was published late). Lets cold
 * starts skip the expensive #P-tag relay query for txs where we already
 * know there's nothing to find (issue #127).
 */
export async function recordOutgoingMiss(paymentHash: string): Promise<void> {
  await record(paymentHash, null);
}

async function record(paymentHash: string, info: ZapCounterpartyInfo | null): Promise<void> {
  if (!paymentHash) return;
  const cache = await load();
  const existing = cache[paymentHash];
  if (existing) {
    if (existing.info === null && info === null) return;
    if (existing.info !== null && info !== null && counterpartyInfoEqual(existing.info, info)) {
      return;
    }
  }
  // Prune stale negatives opportunistically — they're filtered out of every read path, so keeping them around just eats slots toward MAX_ENTRIES and risks evicting still-useful positive attributions when the cache fills.
  const now = Date.now();
  for (const k of Object.keys(cache)) {
    const e = cache[k];
    if (e.info === null && now - e.savedAt > NEGATIVE_TTL_MS) {
      delete cache[k];
    }
  }
  cache[paymentHash] = { info, savedAt: now };

  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.map((k) => [k, cache[k].savedAt] as const).sort((a, b) => a[1] - b[1]);
    const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const [k] of drop) delete cache[k];
  }

  writeVersion++;
  await persist(cache);
}

/** Backwards-compatible alias for SendSheet / outgoing-zap callers that already use `recordOutgoing`. New callers should prefer the direction-agnostic `recordCounterparty`. */
export const recordOutgoing = recordCounterparty;

function counterpartyInfoEqual(a: ZapCounterpartyInfo, b: ZapCounterpartyInfo): boolean {
  if (a.pubkey !== b.pubkey) return false;
  if (a.comment !== b.comment) return false;
  if (a.anonymous !== b.anonymous) return false;
  // Profile shape: identity by npub is sufficient — fields like name/picture flux without changing who the counterparty is.
  if ((a.profile?.npub ?? null) !== (b.profile?.npub ?? null)) return false;
  return true;
}

export async function getByPaymentHash(paymentHash: string): Promise<ZapCounterpartyInfo | null> {
  if (!paymentHash) return null;
  const cache = await load();
  const entry = cache[paymentHash];
  if (!entry) return null;
  if (entry.info === null && isNegativeStale(entry)) return null;
  return entry.info;
}

/**
 * Bulk lookup — the resolver uses this to attribute a batch of txs.
 *
 * Hits include both positive attributions (`ZapCounterpartyInfo`) and
 * fresh negative attributions (`null`). A `null` value means "we have
 * a recent on-disk record that no receipt exists, skip the relay
 * scan". Stale negatives are filtered out so the resolver retries.
 */
export async function getMany(
  paymentHashes: string[],
): Promise<Map<string, ZapCounterpartyInfo | null>> {
  const out = new Map<string, ZapCounterpartyInfo | null>();
  if (paymentHashes.length === 0) return out;
  const cache = await load();
  for (const h of paymentHashes) {
    const entry = cache[h];
    if (!entry) continue;
    if (entry.info === null && isNegativeStale(entry)) continue;
    out.set(h, entry.info);
  }
  return out;
}

function isNegativeStale(entry: Entry): boolean {
  return Date.now() - entry.savedAt > NEGATIVE_TTL_MS;
}

/** Test-only: wipe the in-memory cache so reloads re-read from storage. */
export function __resetForTests(): void {
  memoryCache = null;
  writeVersion = 0;
}
