import { SimplePool } from 'nostr-tools/pool';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  getEventHash,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
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

export function getRelayConnectionStatus(): Map<string, boolean> {
  return pool.listConnectionStatus();
}

/**
 * Parameterised-replaceable group-state event kind used by Lightning Piggy
 * for client-side group consensus. See PR #227.
 *
 * Tags:
 *  - ["d", group.id]            unique group identifier
 *  - ["name", group.name]       human-readable display name
 *  - ["p", memberPubkey] ...    one entry per member (excluding the signer)
 *
 * Signed by ANY current group member, not only the original creator.
 * The receiver-side trust gate (GroupsContext.reconcileFromGroupStateEvent)
 * accepts updates from any sender who's already in the local member set
 * for that group (plus the viewer themselves for cross-device sync).
 * Receivers reconcile against the latest created_at they've seen for
 * a given groupId.
 */
export const GROUP_STATE_KIND = 30200;

export interface GroupStateEventInput {
  groupId: string;
  name: string;
  memberPubkeys: string[];
}

/**
 * Build (unsigned) the kind-30200 group-state event. Caller is responsible
 * for signing + publishing — same pattern as createDirectMessageEvent.
 */
export function createGroupStateEvent(input: GroupStateEventInput): {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
} {
  const tags: string[][] = [
    ['d', input.groupId],
    ['name', input.name],
  ];
  for (const pk of input.memberPubkeys) {
    tags.push(['p', pk]);
  }
  return {
    kind: GROUP_STATE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

/**
 * Build the inner kind-14 chat rumor for a group message. Mirrors the
 * NIP-17 spec: the inner rumor carries the human-visible content + a
 * `subject` tag (NIP-14) for the group name + one `p` tag per recipient
 * so members can detect they share a thread.
 *
 * Returned event is unsigned; pass it to nip59 wrap helpers per recipient.
 */
export function createGroupChatRumor(input: {
  senderPubkey: string;
  subject: string;
  memberPubkeys: string[];
  content: string;
}): { kind: number; created_at: number; tags: string[][]; content: string; pubkey: string } {
  const tags: string[][] = [['subject', input.subject]];
  for (const pk of input.memberPubkeys) {
    tags.push(['p', pk]);
  }
  return {
    pubkey: input.senderPubkey,
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: input.content,
  };
}

/**
 * NIP-17 multi-recipient send via nostr-tools `wrapManyEvents`. Builds a
 * kind-14 rumor once, then seal+wraps it for each recipient (the helper
 * spec-conformantly re-wraps for the sender as well so they see their own
 * message on other devices). All wraps are then published in parallel.
 *
 * NSEC-only path. Amber path requires per-event signEvent IPC which the
 * NIP-59 helpers don't support out of the box; tracked as a follow-up.
 */
export async function sendNip17ToManyWithNsec(input: {
  senderSecretKey: Uint8Array;
  rumor: { kind: number; created_at: number; tags: string[][]; content: string };
  recipientPubkeys: string[];
  relays: string[];
}): Promise<{ wrapsPublished: number; errors: string[] }> {
  trackRelays(input.relays);
  // Dedup recipients (sender is included by wrapManyEvents internally).
  const dedupedRecipients = Array.from(new Set(input.recipientPubkeys.map((p) => p.toLowerCase())));
  const wraps = nip59.wrapManyEvents(
    input.rumor as Parameters<typeof nip59.wrapManyEvents>[0],
    input.senderSecretKey,
    dedupedRecipients,
  );
  const errors: string[] = [];
  let published = 0;
  await Promise.all(
    wraps.map(async (wrap) => {
      try {
        await Promise.any(pool.publish(input.relays, wrap as VerifiedEvent));
        published++;
      } catch (e) {
        errors.push((e as Error)?.message ?? 'publish failed');
      }
    }),
  );
  return { wrapsPublished: published, errors };
}

/**
 * NIP-17 multi-recipient send for signers that don't expose a raw secret
 * key (Amber, NIP-46, etc.). Mirrors `sendNip17ToManyWithNsec` but routes
 * the two operations that require the user's key — the seal's NIP-44
 * encryption and the seal's signature — through caller-supplied async
 * callbacks. The wrap (kind-1059) is signed with a fresh ephemeral key
 * generated locally, so it does not need the signer.
 *
 * Per recipient (and once for the sender, so other devices receive their
 * own message) this triggers, via the callbacks:
 *
 *   1× signerNip44Encrypt(rumorJson, recipientPubkey)
 *   1× signerSignSeal(unsignedSeal)
 *
 * Both calls are awaited SEQUENTIALLY across recipients. Amber's native
 * module rejects concurrent intents with a `BUSY` error, so the loop
 * MUST NOT use Promise.all over the per-recipient signing path. Wrap
 * publishing is parallel (no signer involvement).
 *
 * The first signing failure aborts the loop and is surfaced via `errors`;
 * any wraps already produced for prior recipients are still published.
 */
export async function sendNip17ToManyWithSigner(input: {
  senderPubkey: string;
  rumor: { kind: number; created_at: number; tags: string[][]; content: string; pubkey: string };
  recipientPubkeys: string[];
  relays: string[];
  signerNip44Encrypt: (plaintext: string, recipientPubkey: string) => Promise<string>;
  signerSignSeal: (unsignedSeal: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    pubkey: string;
  }) => Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }>;
}): Promise<{ wrapsPublished: number; errors: string[] }> {
  trackRelays(input.relays);

  // Match nostr-tools' `wrapManyEvents` semantics: include the sender so
  // their own message lands in their inbox on other devices. Dedup the
  // combined list so a sender who is also explicitly p-tagged isn't
  // wrapped twice.
  const recipients = Array.from(
    new Set([input.senderPubkey, ...input.recipientPubkeys].map((p) => p.toLowerCase())),
  );

  // Compute the rumor id once. The rumor is never signed (nostr-tools
  // calls this a "rumor" precisely because it has no signature) — only
  // its id is needed so receivers can dedupe across multiple wraps.
  const rumorWithId = { ...input.rumor, id: getEventHash(input.rumor) };
  const rumorJson = JSON.stringify(rumorWithId);

  // Spec: each seal/wrap uses a randomized created_at within the past
  // ~2 days to defeat traffic correlation. Mirror nostr-tools nip59.
  const TWO_DAYS = 2 * 24 * 60 * 60;
  const randomNow = (): number =>
    Math.round(Math.floor(Date.now() / 1000) - Math.random() * TWO_DAYS);

  const errors: string[] = [];
  const signedWraps: VerifiedEvent[] = [];

  // SEQUENTIAL — Amber's BUSY guard rejects parallel intents, and
  // alternating "seal sign" / "nip44 encrypt" prompts share that guard.
  for (const recipient of recipients) {
    try {
      const sealCiphertext = await input.signerNip44Encrypt(rumorJson, recipient);
      const unsignedSeal = {
        kind: 13, // Seal (NIP-59)
        created_at: randomNow(),
        tags: [] as string[][],
        content: sealCiphertext,
        pubkey: input.senderPubkey,
      };
      const signedSeal = await input.signerSignSeal(unsignedSeal);

      // The wrap uses an ephemeral key — never the user's key — so we
      // can finalize it locally without any signer round-trip. The wrap's
      // `pubkey` is the ephemeral pubkey (set by finalizeEvent); the only
      // identifier on the wrap that ties it to a recipient is the `p` tag.
      const ephemeralKey = generateSecretKey();
      const sealJson = JSON.stringify(signedSeal);
      const wrapContent = nip44EncryptForRecipient(sealJson, ephemeralKey, recipient);
      const wrap = finalizeEvent(
        {
          kind: 1059, // GiftWrap (NIP-59)
          created_at: randomNow(),
          tags: [['p', recipient]],
          content: wrapContent,
        },
        ephemeralKey,
      );
      signedWraps.push(wrap);
    } catch (e) {
      errors.push((e as Error)?.message ?? 'signer step failed');
      // First failure is almost certainly user-cancellation in Amber or
      // a permission denial; bail rather than firing N more dialogs.
      break;
    }
  }

  let published = 0;
  await Promise.all(
    signedWraps.map(async (wrap) => {
      try {
        await Promise.any(pool.publish(input.relays, wrap));
        published++;
      } catch (e) {
        errors.push((e as Error)?.message ?? 'publish failed');
      }
    }),
  );
  return { wrapsPublished: published, errors };
}

/**
 * NIP-44 v2 encrypt, matching the primitive nostr-tools' nip59 uses
 * internally. Exposed here so the Amber NIP-17 path can construct the
 * gift wrap (which is signed with an ephemeral key, never the user's
 * key, so it doesn't need to round-trip through Amber).
 */
function nip44EncryptForRecipient(
  plaintext: string,
  senderSecretKey: Uint8Array,
  recipientPubkey: string,
): string {
  const conversationKey = nip44.v2.utils.getConversationKey(senderSecretKey, recipientPubkey);
  return nip44.v2.encrypt(plaintext, conversationKey);
}

/**
 * Open a persistent relay subscription that streams DM-relevant events
 * (NIP-04 kind-4 in either direction + NIP-17 kind-1059 wraps p-tagged
 * to the viewer) as they are published. Mirrors the filter shape of
 * `fetchInboxDmEvents` so consumers can route incoming events through
 * the same per-event processing path used by the cold-start
 * `refreshDmInbox` cache-merge.
 *
 * This is layered ALONGSIDE `fetchInboxDmEvents` (issue #188): the
 * one-shot `querySync` still drains historical state on cold start /
 * pull-to-refresh; this subscription catches anything published after
 * that, eliminating the polling loop while preserving the existing
 * fetch path as a backstop.
 *
 * Subscription lifecycle:
 *  - Caller starts on login / hydrate, stops on logout / unmount.
 *  - `subscribeMany` keeps the WebSocket alive and re-emits past events
 *    if a relay reconnects, so we don't manage reconnect ourselves —
 *    the pool's relay layer handles it. The returned `onclose`-aware
 *    unsubscribe just disposes the sub handle.
 *  - `since` (optional) lets the caller pass a recent timestamp to
 *    avoid re-streaming a full back-catalog on first connect; defaults
 *    to "now − 60s" if undefined so we still catch events published in
 *    the brief window between cold-start fetch and sub start.
 *
 * Dedup is the caller's responsibility — the same event MAY arrive via
 * this sub AND a concurrent `fetchInboxDmEvents` call. The intended
 * dedupe key is the wrap id (`ev.id`), which is what the existing
 * NIP-17 wrap caches and `mergeInboxEntries` already use.
 */
export interface DmInboxSubscriptionInput {
  myPubkey: string;
  relays: string[];
  /** Lower-bound timestamp (epoch seconds). Defaults to `now - 60`. */
  since?: number;
  onKind4: (ev: RawDmEvent) => void;
  onKind1059: (ev: RawGiftWrapEvent) => void;
  /** Best-effort EOSE callback (one per relay). Optional. */
  onEose?: () => void;
}

export function subscribeInboxDmEvents(input: DmInboxSubscriptionInput): () => void {
  const allRelays = [...new Set([...input.relays, ...DEFAULT_RELAYS])];
  trackRelays(allRelays);
  // Damus's clock-drift pad: shift `since` back 2 minutes (matches
  // fetchInboxDmEvents) so a relay with a slow clock still streams the
  // edge-case events whose stamp falls just behind our cursor.
  const nowSec = Math.floor(Date.now() / 1000);
  const since = Math.max(0, (input.since ?? nowSec - 60) - 120);
  const sentK4Filter: Filter = { kinds: [4], authors: [input.myPubkey], since };
  const recvK4Filter: Filter = { kinds: [4], '#p': [input.myPubkey], since };
  const wrapsFilter: Filter = { kinds: [1059], '#p': [input.myPubkey], since };

  const onevent = (ev: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    sig: string;
  }): void => {
    try {
      if (ev.kind === 1059) {
        input.onKind1059(ev as RawGiftWrapEvent);
      } else if (ev.kind === 4) {
        input.onKind4(ev as RawDmEvent);
      }
    } catch (err) {
      if (__DEV__) console.warn('[Nostr] subscribeInboxDmEvents handler threw:', err);
    }
  };

  const oneose = (): void => {
    try {
      input.onEose?.();
    } catch {
      // best-effort
    }
  };

  // Three separate subs because subscribeMany takes a single Filter and
  // the relay-side semantics for `kinds + authors + #p` are an AND, not
  // an OR — collapsing them would over-filter (only events that are
  // BOTH authored by us AND p-tag us, which is roughly nothing).
  const subSentK4 = pool.subscribeMany(allRelays, sentK4Filter, { onevent, oneose });
  const subRecvK4 = pool.subscribeMany(allRelays, recvK4Filter, { onevent, oneose });
  const subWraps = pool.subscribeMany(allRelays, wrapsFilter, { onevent, oneose });

  return () => {
    for (const s of [subSentK4, subRecvK4, subWraps]) {
      try {
        s.close();
      } catch {
        // best-effort — sub may already be torn down
      }
    }
  };
}

/**
 * Subscribe to inbound kind-30200 group-state events relevant to the
 * viewer. Two filters are OR-ed together so the viewer sees:
 *
 *  - groups OTHER members published that p-tag the viewer (`#p: [self]`)
 *  - groups the VIEWER authored themselves (`authors: [self]`)
 *
 * The second filter exists because `createGroupStateEvent` excludes the
 * author from the `p` tags (spec convention — the signer is implicit),
 * so a viewer-authored event wouldn't match the p-tag filter and the
 * group wouldn't sync across the viewer's own devices.
 *
 * Returns an unsubscribe function. Dedup / reconciliation is the
 * caller's job (callback receives every matching event; caller compares
 * created_at).
 */
export function subscribeGroupStateForViewer(input: {
  viewerPubkey: string;
  relays: string[];
  onEvent: (ev: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => void;
}): () => void {
  trackRelays(input.relays);
  const onevent = (ev: Parameters<typeof input.onEvent>[0]): void => {
    input.onEvent(ev);
  };
  // Two separate filters (subscribeMany takes a single Filter): one for
  // events that p-tag the viewer, one for events the viewer authored.
  const subPtag = pool.subscribeMany(
    input.relays,
    { kinds: [GROUP_STATE_KIND], '#p': [input.viewerPubkey] } as Filter,
    { onevent },
  );
  const subAuthored = pool.subscribeMany(
    input.relays,
    { kinds: [GROUP_STATE_KIND], authors: [input.viewerPubkey] } as Filter,
    { onevent },
  );
  return () => {
    for (const s of [subPtag, subAuthored]) {
      try {
        s.close();
      } catch {
        // best-effort
      }
    }
  };
}
