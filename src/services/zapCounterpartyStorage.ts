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

type Entry = {
  info: ZapCounterpartyInfo;
  /** Epoch ms when the entry was written — used for LRU-style eviction. */
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
  if (!paymentHash) return;
  const cache = await load();
  const existing = cache[paymentHash];
  if (existing && counterpartyInfoEqual(existing.info, info)) {
    return;
  }
  cache[paymentHash] = { info, savedAt: Date.now() };

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
  return cache[paymentHash]?.info ?? null;
}

/** Bulk lookup — the resolver uses this to attribute a batch of txs. */
export async function getMany(paymentHashes: string[]): Promise<Map<string, ZapCounterpartyInfo>> {
  const out = new Map<string, ZapCounterpartyInfo>();
  if (paymentHashes.length === 0) return out;
  const cache = await load();
  for (const h of paymentHashes) {
    const entry = cache[h];
    if (entry) out.set(h, entry.info);
  }
  return out;
}

/** Test-only: wipe the in-memory cache so reloads re-read from storage. */
export function __resetForTests(): void {
  memoryCache = null;
  writeVersion = 0;
}
