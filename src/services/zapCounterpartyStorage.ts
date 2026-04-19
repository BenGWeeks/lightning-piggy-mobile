/**
 * AsyncStorage-backed cache of resolved Nostr counterparties for outgoing
 * zaps, keyed by payment hash.
 *
 * For incoming zaps, sender attribution is derived from public NIP-57
 * receipts on relays. For outgoing zaps the sender is *us* — what the
 * user actually wants to see is who they paid, and we know that at the
 * moment the zap request is signed (the recipient's pubkey + profile is
 * whatever contact / search-hit triggered the Send). Rather than round
 * trip through relays we record it directly here and the resolver looks
 * it up during transaction refresh.
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
 * Record counterparty info for a payment we just made. Evicts the
 * oldest entries if we cross `MAX_ENTRIES`.
 */
export async function recordOutgoing(
  paymentHash: string,
  info: ZapCounterpartyInfo,
): Promise<void> {
  if (!paymentHash) return;
  const cache = await load();
  cache[paymentHash] = { info, savedAt: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.map((k) => [k, cache[k].savedAt] as const).sort((a, b) => a[1] - b[1]);
    const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
    for (const [k] of drop) delete cache[k];
  }

  await persist(cache);
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
}
