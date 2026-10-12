import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
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
const preferencesKey = (account: string) => perAccountKey('market_filters_v1', account);
export async function readMarketPreferences(account: string): Promise<MarketPreferences> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(preferencesKey(account))) ?? '{}');
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
  try {
    await AsyncStorage.setItem(preferencesKey(account), JSON.stringify(value));
  } catch {
    // Storage is best-effort; filters still work in this session.
  }
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
function bounded(entries: MarketSnapshot[]): MarketSnapshot[] {
  const kept = entries
    .filter(valid)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SCOPES);
  while (kept.length && JSON.stringify(kept).length > MARKET_CACHE_MAX_CHARS) kept.pop();
  return kept;
}
export function getMarketSnapshot(key: string): MarketSnapshot | undefined {
  const snapshot = memory.get(key);
  if (snapshot && valid(snapshot)) return snapshot;
  memory.delete(key);
  return undefined;
}
export function clearMarketSnapshotMemory() {
  memory.clear();
}
async function diskEntries(): Promise<MarketSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(MARKET_CACHE_KEY);
    if (!raw || raw.length > MARKET_CACHE_MAX_CHARS) return [];
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? bounded(entries) : [];
  } catch {
    return [];
  }
}
export async function readMarketSnapshot(key: string): Promise<MarketSnapshot | undefined> {
  const cached = getMarketSnapshot(key);
  if (cached) return cached;
  await diskQueue;
  const snapshot = (await diskEntries()).find((entry) => entry.key === key);
  // A background refresh may have won while disk was being read.
  const latest = getMarketSnapshot(key);
  if (latest) return latest;
  if (snapshot) {
    const entries = bounded([snapshot, ...memory.values()]);
    memory.clear();
    for (const entry of entries) memory.set(entry.key, entry);
  }
  return snapshot;
}
export function writeMarketSnapshot(key: string, result: MarketListingsResult): Promise<void> {
  const snapshot = { key, at: Date.now(), result };
  const entries = bounded([snapshot, ...[...memory.values()].filter((entry) => entry.key !== key)]);
  memory.clear();
  for (const entry of entries) memory.set(entry.key, entry);
  diskQueue = diskQueue.then(async () => {
    const disk = await diskEntries();
    const kept = bounded([snapshot, ...disk.filter((entry) => entry.key !== key)]);
    try {
      await AsyncStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(kept));
    } catch {
      // A failed disk write must not prevent the next refresh or cache write.
    }
  });
  return diskQueue;
}
