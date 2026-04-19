import { SimplePool } from 'nostr-tools/pool';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import type { NostrProfile, NostrContact, RelayConfig } from '../types/nostr';

const pool = new SimplePool();

// Shared pubkey + read relays of the currently logged-in Nostr user.
// Kept as module state because `WalletProvider` wraps `NostrProvider` in
// the tree, so the wallet layer can't read `NostrContext` via React hooks
// — but it needs the recipient pubkey (for the `#p` zap-receipt filter)
// and the user's configured read relays (so queries also hit the relays
// that actually carry their zap history).
let _currentUserPubkey: string | null = null;
let _currentUserReadRelays: string[] = [];
const _pubkeyListeners = new Set<(pubkey: string | null) => void>();
export function setCurrentUserPubkey(pubkey: string | null): void {
  if (_currentUserPubkey === pubkey) return;
  _currentUserPubkey = pubkey;
  _pubkeyListeners.forEach((fn) => {
    try {
      fn(pubkey);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] pubkey listener threw:', e);
    }
  });
}
export function getCurrentUserPubkey(): string | null {
  return _currentUserPubkey;
}
export function setCurrentUserReadRelays(relays: string[]): void {
  _currentUserReadRelays = [...relays];
}
export function getCurrentUserReadRelays(): string[] {
  return _currentUserReadRelays;
}
export function onCurrentUserPubkeyChange(fn: (pubkey: string | null) => void): () => void {
  _pubkeyListeners.add(fn);
  return () => _pubkeyListeners.delete(fn);
}

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// Relays that aggregate profile metadata across the network
const PROFILE_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export function decodeNsec(nsec: string): { pubkey: string; secretKey: Uint8Array } {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') {
    throw new Error('Invalid nsec format');
  }
  const secretKey = decoded.data;
  const pubkey = getPublicKey(secretKey);
  return { pubkey, secretKey };
}

export function npubEncode(hex: string): string {
  return nip19.npubEncode(hex);
}

export function parseProfileContent(content: string): {
  name: string | null;
  displayName: string | null;
  picture: string | null;
  banner: string | null;
  about: string | null;
  lud16: string | null;
  nip05: string | null;
} {
  try {
    const data = JSON.parse(content);
    return {
      name: data.name || null,
      displayName: data.display_name || null,
      picture: data.picture || null,
      banner: data.banner || null,
      about: data.about || null,
      lud16: data.lud16 || null,
      nip05: data.nip05 || null,
    };
  } catch {
    return {
      name: null,
      displayName: null,
      picture: null,
      banner: null,
      about: null,
      lud16: null,
      nip05: null,
    };
  }
}

export async function fetchProfile(pubkey: string, relays: string[]): Promise<NostrProfile | null> {
  const allRelays = [...new Set([...relays, ...PROFILE_RELAYS])];
  trackRelays(allRelays);
  try {
    const event = await pool.get(allRelays, {
      kinds: [0],
      authors: [pubkey],
    });
    if (!event) return null;

    const parsed = parseProfileContent(event.content);
    return {
      pubkey,
      npub: npubEncode(pubkey),
      ...parsed,
    };
  } catch (error) {
    console.warn('Failed to fetch Nostr profile:', error);
    return null;
  }
}

export async function fetchContactList(pubkey: string, relays: string[]): Promise<NostrContact[]> {
  trackRelays(relays);
  try {
    const event = await pool.get(relays, {
      kinds: [3],
      authors: [pubkey],
    });
    if (!event) return [];

    return event.tags
      .filter((tag) => tag[0] === 'p')
      .map((tag) => ({
        pubkey: tag[1],
        relay: tag[2] || null,
        petname: tag[3] || null,
        profile: null,
      }));
  } catch (error) {
    console.warn('Failed to fetch Nostr contact list:', error);
    return [];
  }
}

export async function fetchRelayList(pubkey: string, relays: string[]): Promise<RelayConfig[]> {
  trackRelays(relays);
  try {
    const event = await pool.get(relays, {
      kinds: [10002],
      authors: [pubkey],
    });
    if (!event) return [];

    return event.tags
      .filter((tag) => tag[0] === 'r')
      .map((tag) => {
        const url = tag[1];
        const marker = tag[2];
        return {
          url,
          read: !marker || marker === 'read',
          write: !marker || marker === 'write',
        };
      });
  } catch (error) {
    console.warn('Failed to fetch NIP-65 relay list:', error);
    return [];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function fetchProfiles(
  pubkeys: string[],
  relays: string[],
  onBatch?: (profiles: Map<string, NostrProfile>) => void,
): Promise<Map<string, NostrProfile>> {
  const profiles = new Map<string, NostrProfile>();
  if (pubkeys.length === 0) return profiles;

  // Include profile aggregator relays for better coverage
  const allRelays = [...new Set([...relays, ...PROFILE_RELAYS])];

  const processEvents = (events: { pubkey: string; content: string }[]) => {
    for (const event of events) {
      if (profiles.has(event.pubkey)) continue;
      const parsed = parseProfileContent(event.content);
      profiles.set(event.pubkey, {
        pubkey: event.pubkey,
        npub: npubEncode(event.pubkey),
        ...parsed,
      });
    }
  };

  try {
    // Overall timeout: 120s max for all profile fetching
    const overallDeadline = Date.now() + 120000;

    // Batch in groups of 50, run 3 batches concurrently, 15s timeout per batch
    const batchSize = 50;
    const concurrency = 3;
    const batches: string[][] = [];
    for (let i = 0; i < pubkeys.length; i += batchSize) {
      batches.push(pubkeys.slice(i, i + batchSize));
    }

    for (let i = 0; i < batches.length; i += concurrency) {
      // Bail if overall deadline exceeded
      if (Date.now() > overallDeadline) {
        if (__DEV__) console.warn('[Nostr] fetchProfiles: overall timeout reached');
        break;
      }
      // Yield to event loop between batch rounds so UI stays responsive
      // Use 50ms delay to give React time to process renders and user input
      if (i > 0) await new Promise((r) => setTimeout(r, 50));

      const concurrent = batches.slice(i, i + concurrency);
      const results = await Promise.all(
        concurrent.map((batch) =>
          withTimeout(pool.querySync(allRelays, { kinds: [0], authors: batch }), 15000),
        ),
      );
      for (const events of results) {
        if (events) processEvents(events);
      }
      // Notify caller with partial results so UI updates incrementally
      if (onBatch) onBatch(new Map(profiles));
    }

    // Retry pass for missing profiles (smaller batches, longer timeout)
    const missing = pubkeys.filter((pk) => !profiles.has(pk));
    if (missing.length > 0 && missing.length < pubkeys.length && Date.now() < overallDeadline) {
      if (__DEV__)
        console.log(`[Nostr] fetchProfiles: retrying ${missing.length} missing profiles`);
      const retryBatches: string[][] = [];
      for (let i = 0; i < missing.length; i += 20) {
        retryBatches.push(missing.slice(i, i + 20));
      }
      for (let i = 0; i < retryBatches.length; i += concurrency) {
        if (Date.now() > overallDeadline) break;
        const concurrent = retryBatches.slice(i, i + concurrency);
        const results = await Promise.all(
          concurrent.map((batch) =>
            withTimeout(pool.querySync(allRelays, { kinds: [0], authors: batch }), 10000),
          ),
        );
        for (const events of results) {
          if (events) processEvents(events);
        }
        if (onBatch) onBatch(new Map(profiles));
      }
    }
  } catch (error) {
    console.warn('Failed to batch fetch profiles:', error);
  }

  return profiles;
}

export async function signAndPublishEvent(
  event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  },
  secretKey: Uint8Array,
  relays: string[],
): Promise<void> {
  trackRelays(relays);
  const signed = finalizeEvent(event, secretKey);
  await Promise.any(pool.publish(relays, signed));
}

export async function publishSignedEvent(
  signedEvent: {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  },
  relays: string[],
): Promise<void> {
  trackRelays(relays);
  await Promise.any(pool.publish(relays, signedEvent as VerifiedEvent));
}

/**
 * Parse a NIP-57 zap receipt (kind 9735) to extract the sender pubkey and the
 * comment they typed when zapping. The receipt's `description` tag carries
 * the stringified kind 9734 zap request event; the sender's pubkey is the
 * `pubkey` field of that inner event, unless the zap request was marked
 * anonymous via `['anon', ...]`.
 */
export function parseZapReceipt(event: { tags: string[][] }): {
  senderPubkey: string | null;
  comment: string;
  anonymous: boolean;
} | null {
  const descTag = event.tags.find((t) => t[0] === 'description');
  if (!descTag || !descTag[1]) return null;
  try {
    const zapRequest = JSON.parse(descTag[1]) as {
      pubkey?: string;
      content?: string;
      tags?: string[][];
    };
    const anonymous = Array.isArray(zapRequest.tags)
      ? zapRequest.tags.some((t) => t[0] === 'anon')
      : false;
    return {
      senderPubkey: anonymous ? null : zapRequest.pubkey || null,
      comment: typeof zapRequest.content === 'string' ? zapRequest.content : '',
      anonymous,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch NIP-57 zap receipts (kind 9735) addressed to `recipientPubkey`.
 *
 * We can't use `#bolt11` here — damus, primal and most mainstream relays
 * reject tag filters they haven't indexed (they respond with
 * `NOTICE: bad req: unindexed tag filter`). `#p` is always indexed, so we
 * fetch a bounded slice of receipts for the wallet owner and let the caller
 * match individual bolt11 invoices locally against the returned events.
 */
export async function fetchZapReceiptsForRecipient(
  recipientPubkeys: string | string[],
  relays: string[],
  options: { limit?: number; since?: number } = {},
): Promise<{ tags: string[][]; created_at: number; id: string }[]> {
  return fetchZapReceiptsByTag('#p', recipientPubkeys, relays, options);
}

/**
 * Fetch kind-9735 zap receipts where the SENDER pubkey matches one of
 * the given pubkeys (via the optional uppercase `P` tag per NIP-57).
 *
 * Used for cross-device attribution of outgoing zaps: when a zap was
 * sent from a different device, local storage has no entry for it. If
 * the recipient's LNURL server included `['P', <sender_pubkey>]` in
 * the receipt we can still resolve the recipient by querying relays.
 *
 * Servers MAY omit the `P` tag (NIP-57 marks it optional), so this is
 * a best-effort fallback, not a replacement for the local-storage path.
 */
export async function fetchZapReceiptsForSender(
  senderPubkeys: string | string[],
  relays: string[],
  options: { limit?: number; since?: number } = {},
): Promise<{ tags: string[][]; created_at: number; id: string }[]> {
  return fetchZapReceiptsByTag('#P', senderPubkeys, relays, options);
}

async function fetchZapReceiptsByTag(
  tag: '#p' | '#P',
  pubkeys: string | string[],
  relays: string[],
  options: { limit?: number; since?: number } = {},
): Promise<{ tags: string[][]; created_at: number; id: string }[]> {
  const arr = Array.isArray(pubkeys) ? pubkeys : [pubkeys];
  const deduped = [...new Set(arr.filter(Boolean))];
  if (deduped.length === 0) return [];
  const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
  trackRelays(allRelays);
  const baseFilter = {
    kinds: [9735],
    limit: options.limit ?? 500,
    ...(options.since ? { since: options.since } : {}),
  };
  // The `tag` parameter is a literal '#p' or '#P' — cast to the nostr-tools
  // filter type which expects `#<letter>` index signatures.
  const filter = { ...baseFilter, [tag]: deduped } as Parameters<typeof pool.querySync>[1];
  try {
    const events = await withTimeout(pool.querySync(allRelays, filter), 15000);
    if (!events) return [];
    const byId = new Map<string, { tags: string[][]; created_at: number; id: string }>();
    for (const e of events) byId.set(e.id, e);
    return Array.from(byId.values());
  } catch (error) {
    if (__DEV__) console.warn(`[Nostr] fetchZapReceiptsByTag ${tag} failed:`, error);
    return [];
  }
}

export function createZapRequestEvent(
  senderPubkey: string,
  recipientPubkey: string,
  amountMsats: number,
  relays: string[],
  content: string,
): { kind: number; created_at: number; tags: string[][]; content: string; pubkey: string } {
  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: senderPubkey,
    tags: [
      ['p', recipientPubkey],
      ['amount', amountMsats.toString()],
      ['relays', ...relays],
    ],
    content,
  };
}

export function signEvent(
  event: { kind: number; created_at: number; tags: string[][]; content: string },
  secretKey: Uint8Array,
) {
  return finalizeEvent(event, secretKey);
}

export function createContactListEvent(
  contacts: { pubkey: string; relay: string | null; petname: string | null }[],
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const tags = contacts.map((c) => {
    const tag = ['p', c.pubkey];
    tag.push(c.relay || '');
    tag.push(c.petname || '');
    return tag;
  });
  return {
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

export function createProfileEvent(profileData: {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  lud16?: string;
  nip05?: string;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  // Remove undefined/empty values
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(profileData)) {
    if (value) cleaned[key] = value;
  }
  return {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(cleaned),
  };
}

export async function createDirectMessageEvent(
  secretKey: Uint8Array,
  recipientPubkey: string,
  plaintext: string,
): Promise<{ kind: number; created_at: number; tags: string[][]; content: string }> {
  const encrypted = await nip04.encrypt(secretKey, recipientPubkey, plaintext);
  return {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted,
  };
}

export function generateKeypair(): { secretKey: Uint8Array; pubkey: string; nsec: string } {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const nsec = nip19.nsecEncode(secretKey);
  return { secretKey, pubkey, nsec };
}

const connectedRelays = new Set<string>();

// Track all relays we connect to for proper cleanup
function trackRelays(relays: string[]) {
  relays.forEach((r) => connectedRelays.add(r));
}

export function cleanup(): void {
  pool.close([...connectedRelays, ...DEFAULT_RELAYS]);
  connectedRelays.clear();
}
