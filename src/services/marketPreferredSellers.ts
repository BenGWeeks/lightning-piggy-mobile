import AsyncStorage from '@react-native-async-storage/async-storage';
import { nip19 } from 'nostr-tools';
import { LIGHTNING_PIGGY_TEAM_NPUB } from '../constants/npubs';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { acquireMarketListingsPool } from './marketListingsPool';
import { collectRelaySnapshot } from './relaySnapshot';
import { verifyEventCached } from './nostrVerifyCache';
import { marketSnapshotRelays } from '../utils/marketListingsQuery';

export const PREFERRED_SELLERS_ACCOUNT = nip19.decode(LIGHTNING_PIGGY_TEAM_NPUB).data as string;
export const PREFERRED_FOLLOWS_CACHE_KEY = 'market_preferred_follows_v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const FRESH_MS = 2 * 60 * 1000;
interface Follows {
  authors: string[];
  at: number;
}
let memory: Follows | undefined;
const valid = (value: Follows) =>
  value &&
  Number.isFinite(value.at) &&
  value.at <= Date.now() &&
  Date.now() - value.at < MAX_AGE &&
  Array.isArray(value.authors) &&
  value.authors.length <= 1024 &&
  value.authors.every((author) => /^[a-f0-9]{64}$/.test(author));
export function getPreferredSellers() {
  return memory && valid(memory) ? memory : undefined;
}
export function clearPreferredSellersMemory() {
  memory = undefined;
}

/** Cached kind-3 scope; a valid empty follow list is authoritative. */
export async function fetchPreferredSellers(
  relays: readonly string[],
  signal: AbortSignal,
  onCache?: (authors: string[]) => void,
  force = false,
): Promise<string[]> {
  if (!getPreferredSellers()) {
    try {
      const raw = await AsyncStorage.getItem(PREFERRED_FOLLOWS_CACHE_KEY);
      if (raw && raw.length <= 75000) {
        const value = JSON.parse(raw);
        if (valid(value)) memory = value;
      }
    } catch {
      /* Best-effort cache. */
    }
  }
  const cached = getPreferredSellers();
  if (signal.aborted) return cached?.authors ?? [];
  if (cached) {
    onCache?.(cached.authors);
    if (!force && Date.now() - cached.at < FRESH_MS) return cached.authors;
  }
  const urls = marketSnapshotRelays(relays).urls;
  const lease = acquireMarketListingsPool(urls);
  const scheduler = createYieldScheduler({ signal, safetyEvery: 32 });
  try {
    const events = new Map<string, import('nostr-tools').Event>();
    const result = await collectRelaySnapshot({
      urls,
      signal,
      deadline: Date.now() + 5000,
      graceMs: 1000,
      relayPool: lease.pool,
      filters: [{ kinds: [3], authors: [PREFERRED_SELLERS_ACCOUNT], limit: 1 }],
      onEvent: (event) => {
        if (
          events.size < 16 &&
          event.kind === 3 &&
          event.pubkey === PREFERRED_SELLERS_ACCOUNT &&
          event.content.length <= 32768 &&
          event.tags.length <= 2048 &&
          event.created_at <= Date.now() / 1000 + 300
        )
          events.set(event.id + event.sig, event);
      },
    });
    for (const event of [...events.values()].sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    )) {
      await scheduler.maybeYield();
      if (signal.aborted) return cached?.authors ?? [];
      if (!verifyEventCached(event)) continue;
      const authors = [
        ...new Set(
          event.tags
            .filter((tag) => tag[0] === 'p' && /^[a-f0-9]{64}$/.test(tag[1] ?? ''))
            .map((tag) => tag[1]),
        ),
      ]
        .slice(0, 1024)
        .sort();
      memory = { authors, at: Date.now() };
      try {
        await AsyncStorage.setItem(PREFERRED_FOLLOWS_CACHE_KEY, JSON.stringify(memory));
      } catch {
        /* Best-effort. */
      }
      return authors;
    }
    if (cached) return cached.authors;
    throw new Error(
      result.answered.length ? 'No verified preferred follow list' : 'Preferred relays unavailable',
    );
  } finally {
    scheduler.dispose();
    lease.release();
  }
}
