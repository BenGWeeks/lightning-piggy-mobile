import { SimplePool } from 'nostr-tools/pool';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import * as nip59 from 'nostr-tools/nip59';
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

export function nprofileEncode(pubkey: string, relays: string[] = []): string {
  return nip19.nprofileEncode({ pubkey, relays });
}

export interface DecodedProfileReference {
  pubkey: string;
  relays: string[];
}

// Best-effort relay hints to embed in an outgoing nprofile. Prefers the
// contact's own kind-3 relay (where the user's follow entry suggests they
// publish), falls back to the viewer's NIP-65 read relays (the places we
// already trust for profile fetches), and finally to a small default slice
// so the nprofile never carries zero hints — an empty hint list defeats
// the purpose of nprofile vs. npub. Dedupes and caps at 3 to keep URIs
// compact; receiving clients still search their own relays on top.
export function buildProfileRelayHints(
  targetPubkey: string,
  viewerContacts: Array<{ pubkey: string; relay: string | null }>,
  viewerReadRelays: string[],
): string[] {
  const hints: string[] = [];
  const contactRelay = viewerContacts.find((c) => c.pubkey === targetPubkey)?.relay;
  if (contactRelay) hints.push(contactRelay);
  for (const r of viewerReadRelays) hints.push(r);
  for (const r of DEFAULT_RELAYS) hints.push(r);
  const deduped: string[] = [];
  for (const r of hints) {
    if (!r) continue;
    if (deduped.includes(r)) continue;
    deduped.push(r);
    if (deduped.length >= 3) break;
  }
  return deduped;
}

// Accepts a NIP-21 `nostr:` URI or a bare bech32 identifier and returns
// the pubkey + optional relay hints when it's a profile reference
// (npub or nprofile). Returns null for anything else (note, nevent, …).
// NIP-21 URI schemes are case-insensitive — `NOSTR:`, `Nostr:`, etc.
// all need to be accepted, so strip with a case-insensitive match.
export function decodeProfileReference(input: string): DecodedProfileReference | null {
  const stripped = /^nostr:/i.test(input) ? input.slice(6) : input;
  try {
    const decoded = nip19.decode(stripped);
    if (decoded.type === 'npub') {
      return { pubkey: decoded.data, relays: [] };
    }
    if (decoded.type === 'nprofile') {
      return { pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
    }
  } catch {
    // fall through
  }
  return null;
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

export interface RawDmEvent {
  id: string;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Fetch NIP-4 encrypted DMs (kind 4) exchanged between `myPubkey` and
 * `otherPubkey`, in either direction. Returns raw events — decryption
 * happens in the context layer where the signer (nsec / Amber) lives.
 *
 * Uses two parallel filters: messages authored by me tagged to the other,
 * and messages authored by the other tagged to me. Most relays index
 * `#p`, so this pair covers both conversation halves.
 */
export async function fetchDirectMessageEvents(
  myPubkey: string,
  otherPubkey: string,
  relays: string[],
  options: { limit?: number; since?: number } = {},
): Promise<RawDmEvent[]> {
  const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
  trackRelays(allRelays);
  const limit = options.limit ?? 200;
  // Damus's trick (SubscriptionManager.swift:293-300): pad `since` back
  // by 2 minutes so relays with slightly-off clocks still return the
  // last few events we might have missed on the previous fetch. On
  // first fetch (no cached last-seen) the caller passes undefined, so
  // the filter has no `since` and the relay returns full history.
  const since = options.since !== undefined ? Math.max(0, options.since - 120) : undefined;
  const fromMeFilter: Filter = {
    kinds: [4],
    authors: [myPubkey],
    '#p': [otherPubkey],
    limit,
  };
  const toMeFilter: Filter = {
    kinds: [4],
    authors: [otherPubkey],
    '#p': [myPubkey],
    limit,
  };
  if (since !== undefined) {
    fromMeFilter.since = since;
    toMeFilter.since = since;
  }
  try {
    const [fromMe, toMe] = await Promise.all([
      withTimeout(pool.querySync(allRelays, fromMeFilter), 15000),
      withTimeout(pool.querySync(allRelays, toMeFilter), 15000),
    ]);
    const byId = new Map<string, RawDmEvent>();
    for (const ev of fromMe ?? []) byId.set(ev.id, ev as RawDmEvent);
    for (const ev of toMe ?? []) byId.set(ev.id, ev as RawDmEvent);
    return Array.from(byId.values());
  } catch (error) {
    if (__DEV__) console.warn('[Nostr] fetchDirectMessageEvents failed:', error);
    return [];
  }
}

export interface RawGiftWrapEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface FetchedInboxEvents {
  kind4: RawDmEvent[];
  kind1059: RawGiftWrapEvent[];
}

/**
 * Fetch every DM event that could end up in the current user's inbox:
 * legacy NIP-04 kind-4 events in either direction, plus NIP-17 gift wraps
 * (kind 1059) addressed to them. Returned events are raw — the caller
 * decrypts/unwraps in the context layer where the signer lives.
 *
 * Three parallel filters: `authors=me` covers outgoing kind-4 (which tag
 * the recipient, not me); `#p=me` covers incoming kind-4 and NIP-17 wraps
 * (which always tag the recipient — including self-wraps of the sender's
 * own copy). This matches Damus's twin kind-4 strategy and layers NIP-17
 * on top.
 */
export async function fetchInboxDmEvents(
  myPubkey: string,
  relays: string[],
  options: { limit?: number; since?: number } = {},
): Promise<FetchedInboxEvents> {
  const allRelays = [...new Set([...relays, ...DEFAULT_RELAYS])];
  trackRelays(allRelays);
  const limit = options.limit ?? 500;
  // `since` shifted back 2 minutes (Damus clock-drift pad). All three
  // inbox sub-queries share the same since floor: any relay that
  // stamped an event slightly-in-our-past still returns it.
  const since = options.since !== undefined ? Math.max(0, options.since - 120) : undefined;
  const sentK4Filter: Filter = { kinds: [4], authors: [myPubkey], limit };
  const recvK4Filter: Filter = { kinds: [4], '#p': [myPubkey], limit };
  const wrapsFilter: Filter = { kinds: [1059], '#p': [myPubkey], limit };
  if (since !== undefined) {
    sentK4Filter.since = since;
    recvK4Filter.since = since;
    wrapsFilter.since = since;
  }
  try {
    const [sentK4, receivedK4, wraps] = await Promise.all([
      withTimeout(pool.querySync(allRelays, sentK4Filter), 15000),
      withTimeout(pool.querySync(allRelays, recvK4Filter), 15000),
      withTimeout(pool.querySync(allRelays, wrapsFilter), 15000),
    ]);
    const k4 = new Map<string, RawDmEvent>();
    for (const ev of sentK4 ?? []) k4.set(ev.id, ev as RawDmEvent);
    for (const ev of receivedK4 ?? []) k4.set(ev.id, ev as RawDmEvent);
    const k1059 = new Map<string, RawGiftWrapEvent>();
    for (const ev of wraps ?? []) k1059.set(ev.id, ev as RawGiftWrapEvent);
    return { kind4: Array.from(k4.values()), kind1059: Array.from(k1059.values()) };
  } catch (error) {
    if (__DEV__) console.warn('[Nostr] fetchInboxDmEvents failed:', error);
    return { kind4: [], kind1059: [] };
  }
}

export interface UnwrappedRumor {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/**
 * Unwrap a NIP-17 gift wrap (kind 1059) to its inner rumor. The rumor's
 * `pubkey` is the real sender; its `created_at` is the real send time
 * (the wrap's own timestamp is randomised up to 2 days in the past per
 * the spec). `nip59.unwrapEvent` decrypts the wrap with our secret key,
 * parses the inner seal, decrypts the seal, and verifies the rumor's
 * pubkey matches the seal's pubkey — throws on mismatch, which the
 * caller should treat as a skip-and-log.
 */
export function unwrapGiftWrap(secretKey: Uint8Array, wrap: RawGiftWrapEvent): UnwrappedRumor {
  const rumor = nip59.unwrapEvent(wrap as Parameters<typeof nip59.unwrapEvent>[0], secretKey);
  return {
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    content: rumor.content,
  };
}

export async function decryptNip04WithSecret(
  secretKey: Uint8Array,
  otherPubkey: string,
  ciphertext: string,
): Promise<string> {
  return nip04.decrypt(secretKey, otherPubkey, ciphertext);
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
