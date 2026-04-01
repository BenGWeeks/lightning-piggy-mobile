import { SimplePool } from 'nostr-tools/pool';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import type { NostrProfile, NostrContact, RelayConfig } from '../types/nostr';

const pool = new SimplePool();

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
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
  try {
    const event = await pool.get(relays, {
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

export async function fetchProfiles(
  pubkeys: string[],
  relays: string[],
): Promise<Map<string, NostrProfile>> {
  const profiles = new Map<string, NostrProfile>();
  if (pubkeys.length === 0) return profiles;

  try {
    // Batch in groups of 50 to avoid overwhelming relays
    const batchSize = 50;
    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);
      const events = await pool.querySync(relays, {
        kinds: [0],
        authors: batch,
      });

      for (const event of events) {
        // Only keep the most recent profile per pubkey
        const existing = profiles.get(event.pubkey);
        if (existing) {
          // We already have one — skip if this event is older
          continue;
        }
        const parsed = parseProfileContent(event.content);
        profiles.set(event.pubkey, {
          pubkey: event.pubkey,
          npub: npubEncode(event.pubkey),
          ...parsed,
        });
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
  const signed = finalizeEvent(event, secretKey);
  await Promise.any(pool.publish(relays, signed));
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

export function cleanup(): void {
  pool.close(DEFAULT_RELAYS);
}
