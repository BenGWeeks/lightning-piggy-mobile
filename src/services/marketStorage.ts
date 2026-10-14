import AsyncStorage from '@react-native-async-storage/async-storage';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { perAccountKey } from './perAccountStorage';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketListingsResult } from './marketListingsService';
import { DEFAULT_MARKET_MODE, type MarketMode } from '../utils/marketMode';

export interface MarketPreferences {
  mode: MarketMode;
  merchant: string | null;
  country: string | null;
  currency: string | null;
}
export const DEFAULT_MARKET_PREFERENCES: MarketPreferences = {
  mode: DEFAULT_MARKET_MODE,
  merchant: null,
  country: null,
  currency: null,
};
const signedOut = new Set<string>();
const generations = new Map<string, number>();
const generation = (account: string) => generations.get(account) ?? 0;
const snapshotAccount = (key: string) => key.split('|')[0];
const preferencesKey = (account: string) => perAccountKey('market_filters_v1', account);
export async function readMarketPreferences(account: string): Promise<MarketPreferences> {
  // A new preferences hydration is the account becoming active again.
  signedOut.delete(account);
  const epoch = generation(account);
  try {
    await diskQueue;
    const value = JSON.parse((await AsyncStorage.getItem(preferencesKey(account))) ?? '{}');
    if (generation(account) !== epoch) return { ...DEFAULT_MARKET_PREFERENCES };
    return {
      mode: value?.mode === 'wotFriends' ? 'wotFriends' : DEFAULT_MARKET_MODE,
      merchant: typeof value?.merchant === 'string' ? value.merchant : null,
      country: typeof value?.country === 'string' ? value.country : null,
      currency: typeof value?.currency === 'string' ? value.currency : null,
    };
  } catch {
    return { ...DEFAULT_MARKET_PREFERENCES };
  }
}
export async function writeMarketPreferences(account: string, value: MarketPreferences) {
  if (signedOut.has(account)) return;
  const epoch = generation(account);
  diskQueue = diskQueue.then(async () => {
    if (generation(account) !== epoch) return;
    try {
      await AsyncStorage.setItem(preferencesKey(account), JSON.stringify(value));
    } catch {
      // Storage is best-effort; filters still work in this session.
    }
  });
  await diskQueue;
}

// Cache derived, already-verified products, never raw events that need another
// signature pass on mount. One versioned disk envelope bounds ALL accounts and
// scopes together. Scope includes account, follows and relay configuration.
export const MARKET_CACHE_KEY = 'market_snapshots_v1';
export const MARKET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MARKET_CACHE_MAX_CHARS = 1_000_000; // At most 2 MB of UTF-16.
const MAX_SCOPES = 8;
export interface MarketSnapshot {
  key: string;
  at: number;
  result: MarketListingsResult;
}
const memory = new Map<string, MarketSnapshot>();
let diskQueue: Promise<void> = Promise.resolve();
const valid = (snapshot: MarketSnapshot) =>
  snapshot &&
  typeof snapshot.key === 'string' &&
  Number.isFinite(snapshot.at) &&
  snapshot.at <= Date.now() &&
  Date.now() - snapshot.at < MARKET_CACHE_MAX_AGE_MS &&
  typeof snapshot.result?.incomplete === 'boolean' &&
  Array.isArray(snapshot.result.products) &&
  snapshot.result.products.length <= 250 &&
  snapshot.result.products.every(
    (product) =>
      product &&
      typeof product.id === 'string' &&
      typeof product.sellerName === 'string' &&
      (!product.listing ||
        (typeof product.listing.event?.pubkey === 'string' && product.listing.vendor)),
  );
// Serialize bounded individual products once, yielding between them. Never
// stringify an unbounded event or the whole envelope on the calling stack.
const serialized = new WeakMap<MarketSnapshot, string>();
function payloadBound(value: unknown, remaining: number): number {
  if (remaining < 0) return Infinity;
  if (typeof value === 'string') return 2 + value.length * 6; // Worst-case escaping.
  if (value === null || typeof value !== 'object') return 32;
  let size = 2;
  for (const [key, child] of Object.entries(value)) {
    size += 3 + key.length * 6 + payloadBound(child, remaining - size);
    if (size > remaining) return Infinity;
  }
  return size;
}
async function prepare(snapshot: MarketSnapshot): Promise<string | undefined> {
  if (!valid(snapshot) || snapshot.key.length > 131072) return;
  const scheduler = createYieldScheduler({ safetyEvery: 32, coldStart: true });
  const products: string[] = [];
  let size = 0;
  try {
    for (const product of snapshot.result.products) {
      // Cap each unit before serialization, including retained signed content.
      if (payloadBound(product, 262144) > 262144) return;
      const raw = JSON.stringify(product);
      size += raw.length + 1;
      if (size > MARKET_CACHE_MAX_CHARS) return;
      products.push(raw);
      await scheduler.maybeYield();
    }
    const raw = `{"key":${JSON.stringify(snapshot.key)},"at":${snapshot.at},"result":{"incomplete":${snapshot.result.incomplete},"budgetLimited":${!!snapshot.result.budgetLimited},"transportFailed":${!!snapshot.result.transportFailed},"products":[${products.join(',')}]}}`;
    if (raw.length + 2 > MARKET_CACHE_MAX_CHARS) return;
    serialized.set(snapshot, raw);
    return raw;
  } finally {
    scheduler.dispose();
  }
}
function bounded(entries: MarketSnapshot[]): MarketSnapshot[] {
  let size = 2;
  return entries
    .filter(valid)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SCOPES)
    .filter((entry) => {
      const raw = serialized.get(entry);
      if (!raw || size + raw.length + 1 > MARKET_CACHE_MAX_CHARS) return false;
      size += raw.length + 1;
      return true;
    });
}
/** Apply signed listing expiry to every cache reuse, including hook-local results. */
export function unexpiredMarketProducts(products: MarketProduct[]): MarketProduct[] {
  const now = Date.now() / 1000;
  return products.filter((product) => {
    const expiry = product.listing?.event.tags?.find((tag) => tag[0] === 'expiration')?.[1];
    return !expiry || (Number.isFinite(Number(expiry)) && Number(expiry) > now);
  });
}
function activeSnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  return {
    ...snapshot,
    result: { ...snapshot.result, products: unexpiredMarketProducts(snapshot.result.products) },
  };
}
export function getMarketSnapshot(key: string): MarketSnapshot | undefined {
  if (signedOut.has(snapshotAccount(key))) return undefined;
  const snapshot = memory.get(key);
  if (snapshot && valid(snapshot)) return activeSnapshot(snapshot);
  memory.delete(key);
  return undefined;
}
/**
 * Every snapshot already held in memory for the given accounts — no disk or
 * relay I/O. Product pages use it to recommend from the Market catalogue the
 * user has already loaded (#1542).
 */
export function loadedMarketSnapshots(
  accounts: readonly string[],
): { account: string; products: MarketProduct[] }[] {
  const wanted = new Set(accounts);
  const snapshots: { account: string; products: MarketProduct[] }[] = [];
  for (const key of [...memory.keys()]) {
    const account = snapshotAccount(key);
    if (!wanted.has(account)) continue;
    const snapshot = getMarketSnapshot(key);
    if (snapshot) snapshots.push({ account, products: snapshot.result.products });
  }
  return snapshots;
}
export function clearMarketSnapshotMemory() {
  memory.clear();
}
async function diskEntries(): Promise<MarketSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(MARKET_CACHE_KEY);
    if (!raw || raw.length > MARKET_CACHE_MAX_CHARS) return [];
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    for (const entry of entries) if (valid(entry)) await prepare(entry);
    return bounded(entries);
  } catch {
    return [];
  }
}
export async function readMarketSnapshot(key: string): Promise<MarketSnapshot | undefined> {
  if (signedOut.has(snapshotAccount(key))) return undefined;
  const account = snapshotAccount(key);
  const epoch = generation(account);
  const cached = getMarketSnapshot(key);
  if (cached) return cached;
  await diskQueue;
  const snapshot = (await diskEntries()).find((entry) => entry.key === key);
  if (generation(account) !== epoch) return undefined;
  // A background refresh may have won while disk was being read.
  const latest = getMarketSnapshot(key);
  if (latest) return latest;
  if (snapshot) {
    const entries = bounded([snapshot, ...memory.values()]);
    memory.clear();
    for (const entry of entries) memory.set(entry.key, entry);
  }
  return snapshot ? activeSnapshot(snapshot) : undefined;
}
export function writeMarketSnapshot(key: string, result: MarketListingsResult): Promise<void> {
  if (signedOut.has(snapshotAccount(key))) return Promise.resolve();
  const account = snapshotAccount(key);
  const epoch = generation(account);
  const snapshot = { key, at: Date.now(), result };
  diskQueue = diskQueue.then(async () => {
    if (generation(account) !== epoch) return;
    await prepare(snapshot);
    if (generation(account) !== epoch) return;
    const entries = bounded([
      snapshot,
      ...[...memory.values()].filter((entry) => entry.key !== key),
    ]);
    memory.clear();
    for (const entry of entries) memory.set(entry.key, entry);
    const disk = await diskEntries();
    if (generation(account) !== epoch) return;
    const kept = bounded([snapshot, ...disk.filter((entry) => entry.key !== key)]);
    try {
      await AsyncStorage.setItem(
        MARKET_CACHE_KEY,
        `[${kept.map((entry) => serialized.get(entry)).join(',')}]`,
      );
    } catch {
      // A failed disk write must not prevent the next refresh or cache write.
    }
  });
  return diskQueue;
}

/** Invalidate pending reads immediately; drain writes before deleting disk data. */
export function wipeMarketAccount(account: string): Promise<void> {
  signedOut.add(account);
  generations.set(account, generation(account) + 1);
  for (const key of memory.keys()) if (snapshotAccount(key) === account) memory.delete(key);
  const wipe = diskQueue.then(async () => {
    await AsyncStorage.removeItem(preferencesKey(account));
    const kept = (await diskEntries()).filter((entry) => snapshotAccount(entry.key) !== account);
    if (kept.length) {
      await AsyncStorage.setItem(
        MARKET_CACHE_KEY,
        `[${kept.map((entry) => serialized.get(entry)).join(',')}]`,
      );
    } else {
      await AsyncStorage.removeItem(MARKET_CACHE_KEY);
    }
  });
  diskQueue = wipe.catch(() => {}); // Keep later accounts usable if storage fails.
  return wipe;
}
