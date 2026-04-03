import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import type { NostrProfile, NostrContact, RelayConfig } from '../types/nostr';

const pool = new SimplePool();

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
    // Overall timeout: 90s max for all profile fetching
    const overallDeadline = Date.now() + 90000;

    // Batch in groups of 50, run 3 batches concurrently, 12s timeout per batch
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
          withTimeout(pool.querySync(allRelays, { kinds: [0], authors: batch }), 12000),
        ),
      );
      for (const events of results) {
        if (events) processEvents(events);
      }
      // Notify caller with partial results so UI updates incrementally
      if (onBatch) onBatch(new Map(profiles));
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
  await Promise.any(pool.publish(relays, signedEvent as any));
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
