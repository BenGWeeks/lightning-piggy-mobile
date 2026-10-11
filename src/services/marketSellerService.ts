// Relay I/O for the seller side of the Market (#1273): fetch the user's own
// Gamma Markets events and publish newly signed ones. Thin shell over the
// pure builders/reducer in utils/marketSeller*.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Event } from 'nostr-tools';
import { pool, trackRelays, DEFAULT_RELAYS, publishSignedEvent } from './nostrService';
import {
  sellerCacheStorageKey as cacheKey,
  sellerHiddenStorageKey as hiddenKey,
  sellerStoreState,
} from './sellerEventStore';
import { reduceSellerSnapshot } from '../utils/marketSellerSnapshot';
import { querySyncAbortable } from './relayQuery';
import {
  COLLECTION_KIND,
  DELETION_KIND,
  LISTING_KIND,
  SHIPPING_OPTION_KIND,
} from '../utils/marketSellerEvents';

const FETCH_MAX_WAIT_MS = 8000;
const PUBLISH_TIMEOUT_MS = 12000;
const MAX_RELAYS = 8;
const MAX_HIDDEN = 200;
const SELLER_KINDS = [LISTING_KIND, COLLECTION_KIND, SHIPPING_OPTION_KIND, DELETION_KIND];

/** The user's write relays (where their own events live), capped. */
export function sellerRelays(relays: readonly { url: string; write: boolean; read: boolean }[]) {
  const write = relays.filter((r) => r.write && /^wss:\/\//.test(r.url)).map((r) => r.url);
  return [...new Set(write.length > 0 ? write : DEFAULT_RELAYS)].slice(0, MAX_RELAYS);
}

/** One bounded snapshot of the seller's listings, shop, zones and deletions. */
export async function fetchSellerEvents(input: {
  pubkey: string;
  relays: string[];
  signal?: AbortSignal;
}): Promise<Event[]> {
  const pubkey = input.pubkey.toLowerCase();
  trackRelays(input.relays);
  const events = await querySyncAbortable(
    pool,
    input.relays,
    { kinds: SELLER_KINDS, authors: [pubkey], limit: 300 },
    { maxWait: FETCH_MAX_WAIT_MS, signal: input.signal, rejectOnAllRelaysFailure: true },
  );
  // `authors` / `kinds` are only a request — never trust a relay to honour them.
  return events.filter((e) => e.pubkey === pubkey && SELLER_KINDS.includes(e.kind));
}

/** Publish to the seller's relays; resolves once ONE relay accepts, rejects
 * if none do within the deadline. */
export async function publishSellerEvent(signed: Event, relays: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Publishing timed out')), PUBLISH_TIMEOUT_MS);
  });
  try {
    await Promise.race([publishSignedEvent(signed, relays.slice(0, MAX_RELAYS)), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- locally hidden (deleted on this device) -------------------------------
// A NIP-09 deletion is a request; some relays keep serving the event. The
// coordinates the user deleted here stay hidden in "My shop" until a newer
// revision appears.

export async function loadHiddenListings(pubkey: string): Promise<Map<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(hiddenKey(pubkey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (e): e is [string, number] =>
          Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number',
      ),
    );
  } catch {
    return new Map();
  }
}

export async function saveHiddenListings(
  pubkey: string,
  hidden: ReadonlyMap<string, number>,
): Promise<void> {
  const newest = [...hidden.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_HIDDEN);
  try {
    await AsyncStorage.setItem(hiddenKey(pubkey), JSON.stringify(newest));
  } catch {
    // Best effort — the relay deletion still applies.
  }
}

// ---- persisted snapshot -----------------------------------------------------
// The winning revisions (shop, zones, newest listings) plus recent deletions,
// so "My shop" paints instantly after a cold start and a slow or unreachable
// relay set can't make an existing shop look like a first-time setup.

const MAX_CACHED_LISTINGS = 150;
const MAX_CACHED_DELETIONS = 50;

const isEventLike = (e: unknown): e is Event =>
  !!e &&
  typeof e === 'object' &&
  typeof (e as Event).id === 'string' &&
  typeof (e as Event).pubkey === 'string' &&
  typeof (e as Event).kind === 'number' &&
  typeof (e as Event).created_at === 'number' &&
  typeof (e as Event).content === 'string' &&
  Array.isArray((e as Event).tags);

export async function loadSellerCache(pubkey: string): Promise<Event[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(pubkey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((e): e is Event => isEventLike(e) && e.pubkey === pubkey)
      : [];
  } catch {
    return [];
  }
}

/** Persist the account's current snapshot from the in-memory store. */
export async function persistSellerSnapshot(pubkey: string): Promise<void> {
  const state = sellerStoreState(pubkey);
  const all = [...state.events.values()];
  const snapshot = reduceSellerSnapshot(all, pubkey, state.hidden);
  const deletions = all
    .filter((e) => e.kind === DELETION_KIND)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_CACHED_DELETIONS);
  const keep = [
    ...(snapshot.shop ? [snapshot.shop] : []),
    ...snapshot.zoneEvents.values(),
    ...snapshot.listings.slice(0, MAX_CACHED_LISTINGS),
    ...deletions,
  ];
  try {
    await AsyncStorage.setItem(cacheKey(pubkey), JSON.stringify(keep));
  } catch {
    // Best effort — relays remain the source of truth.
  }
}
