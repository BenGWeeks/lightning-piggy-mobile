/**
 * AsyncStorage-backed record of the last *successful* zap-resolver run
 * per wallet — a `{ pendingHash, storageVersion }` fingerprint (see
 * `utils/zapResolverGuard`).
 *
 * Why persist it: `resolveZapSendersForWallet` already had an in-memory
 * fingerprint that skipped a redundant pass within a session — but it
 * reset on every cold start, so the first (automatic) resolver pass
 * after each launch always did the full walk even when nothing had
 * changed since last time. Persisting the fingerprint lets an unchanged
 * cold start skip the pass entirely (#526).
 *
 * No TTL: the fingerprint is a pure "did anything change" marker, not
 * cached data — a stale entry just costs one extra full pass, never a
 * wrong result. Mirrors the in-memory-mirror + single-JSON-blob pattern
 * of `zapCounterpartyStorage` / `zapSenderProfileStorage`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ResolverFingerprint } from '../utils/zapResolverGuard';

const STORAGE_KEY = 'zap_resolver_fingerprints_v1';

type CacheShape = Record<string, ResolverFingerprint>;

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
    // Non-fatal — the in-memory mirror still serves this session, and
    // the worst case is one redundant resolver pass on next launch.
  }
}

/**
 * The fingerprint of the last successful resolver run for `walletId`,
 * or null if the resolver has never completed for it (fresh install,
 * new wallet, or storage cleared).
 */
export async function get(walletId: string): Promise<ResolverFingerprint | null> {
  if (!walletId) return null;
  const cache = await load();
  return cache[walletId] ?? null;
}

/**
 * Record the fingerprint after a resolver pass completes. Called only
 * on a *successful* run so a crashed / aborted pass doesn't poison the
 * skip check for the next launch.
 */
export async function set(walletId: string, fingerprint: ResolverFingerprint): Promise<void> {
  if (!walletId) return;
  const cache = await load();
  cache[walletId] = fingerprint;
  await persist(cache);
}

/** Test-only: wipe the in-memory mirror so reloads re-read from storage. */
export function __resetForTests(): void {
  memoryCache = null;
}
