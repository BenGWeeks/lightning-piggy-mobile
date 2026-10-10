// Registration with Lightning Piggy's notification WATCHER — the wire format.
//
// The watcher (github.com/BenGWeeks/lightning-piggy-notifications) watches
// relays for events addressed to registered users (NIP-04 / NIP-17 DMs, zap
// receipts, mentions, NWC wallet notifications) and sends a content-free push.
// There is no HTTP API: the app gift-wraps (NIP-59) a kind-8480 rumor to the
// watcher's pubkey, and the seal — signed by the user's own signer — is what
// authenticates the request. See PROTOCOL.md in the watcher repo; this module
// is pure (no storage, no network) so it is checked against the watcher's own
// parser in watcherRegistrationConformance.test.ts.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent } from 'nostr-tools/pure';

import { nip44EncryptForRecipient } from './nostrCrypto';
import type { PushPlatform } from './marmotPushToken';

/** npub17hcchazg4akxq4ccuskxmxegl2euyz8je7h6xjthekeyz8pux78qfzgph2 */
export const WATCHER_PUBKEY = 'f5f18bf448af6c605718e42c6d9b28fab3c208f2cfafa34977cdb2411c3c378e';
export const REGISTRATION_KIND = 8480;
/** The watcher's own relays (its kind-10050 fallback). It always watches
 * these, so listing them in a registration would only waste a slot. */
export const WATCHER_DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
];
export const MAX_REGISTRATION_RELAYS = 8;
export const MAX_NWC_CONNECTIONS = 3;
/** The watcher accepts a `ts` at most this far in the past / future. */
export const REGISTRATION_MAX_AGE_SEC = 6 * 3600;
export const REGISTRATION_MAX_SKEW_SEC = 120;

export type WatcherCategory = 'dm' | 'zap' | 'mention' | 'payment';
export const WATCHER_CATEGORIES: readonly WatcherCategory[] = ['dm', 'zap', 'mention', 'payment'];
export type WatcherCategories = Record<WatcherCategory, boolean>;
export const NO_CATEGORIES: WatcherCategories = {
  dm: false,
  zap: false,
  mention: false,
  payment: false,
};

export const anyCategory = (c: WatcherCategories): boolean => WATCHER_CATEGORIES.some((k) => c[k]);

export interface NwcProofEntry {
  /** Pubkey of the connection's secret — the `p` tag on the wallet's notifications. */
  client: string;
  /** Wallet service pubkey — the author of the notifications. */
  wallet: string;
  /** BIP-340 signature by the client secret, bound to the user (see nwcProof). */
  proof: string;
}

export interface RegisterContent {
  v: 1;
  action: 'register';
  app: string;
  platform: PushPlatform;
  token: string;
  apns_env?: 'production' | 'sandbox';
  categories: WatcherCategories;
  relays: string[];
  nwc: NwcProofEntry[];
  ts: number;
}

export interface UnregisterContent {
  v: 1;
  action: 'unregister';
  app: string;
  platform: PushPlatform;
  token: string;
  ts: number;
}

export type RegistrationContent = RegisterContent | UnregisterContent;

/** Everything but `ts` — what the app decides to send. */
export type RegistrationBody =
  | Omit<RegisterContent, 'ts' | 'v'>
  | Omit<UnregisterContent, 'ts' | 'v'>;

/** The user's signer, reduced to the two operations a seal needs. With
 * Amber / NIP-46 these are the only signer round-trips of a registration. */
export interface SealSigner {
  pubkey: string;
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  signEvent(template: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<NostrEvent>;
}

// --- NWC ----------------------------------------------------------------------

export interface NwcConnectionInfo {
  wallet: string;
  secret: string;
  relays: string[];
}

/** `nostr+walletconnect://<wallet>?relay=…&secret=<hex>` → its parts; null if malformed. */
export function parseNwcConnection(url: string): NwcConnectionInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol.toLowerCase() !== 'nostr+walletconnect:') return null;
  // Some URL implementations put the authority in `pathname` for unknown schemes.
  const wallet = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  const secret = (parsed.searchParams.get('secret') ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wallet) || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return { wallet, secret, relays: parsed.searchParams.getAll('relay') };
}

/** The message an NWC proof signs: sha256("lightning-piggy-watcher/nwc/v1:<user>:<wallet>"). */
export function nwcProofMessage(userPubkey: string, walletPubkey: string): Uint8Array {
  return sha256(utf8ToBytes(`lightning-piggy-watcher/nwc/v1:${userPubkey}:${walletPubkey}`));
}

/** Prove this app holds the connection's secret, bound to `userPubkey` so the
 * proof can't be replayed for anyone else. */
export function nwcProof(
  userPubkey: string,
  conn: { wallet: string; secret: string },
): NwcProofEntry {
  const secret = hexToBytes(conn.secret);
  return {
    client: bytesToHex(schnorr.getPublicKey(secret)),
    wallet: conn.wallet,
    proof: bytesToHex(schnorr.sign(nwcProofMessage(userPubkey, conn.wallet), secret)),
  };
}

// --- relays -------------------------------------------------------------------

const BLOCKED_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.onion',
  '.home.arpa',
];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The watcher's relay rule, applied up front so no slot is wasted on a relay
 * it would drop: public `wss://` hostnames only, no credentials / query. */
export function normaliseWatcherRelay(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 256) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'wss:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.') || host.startsWith('[') || IPV4.test(host)) return null;
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return null;
  const port = u.port ? `:${u.port}` : '';
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
  return `wss://${host}${port}${path}`;
}

/**
 * The relays the watcher should watch for this user, most important first and
 * capped at 8: the NWC wallet relays (payments are only ever published there),
 * then the DM inbox (kind 10050), then the read relays (kind 10002: NIP-04 DMs,
 * zap receipts, mentions). The watcher's own relays are left out — it always
 * watches those.
 */
export function selectRegistrationRelays(
  categories: WatcherCategories,
  sources: { nwc: string[]; inbox: string[]; read: string[] },
): string[] {
  const exclude = new Set(WATCHER_DEFAULT_RELAYS);
  const ordered = [
    ...(categories.payment ? sources.nwc : []),
    ...(categories.dm ? sources.inbox : []),
    ...(categories.dm || categories.zap || categories.mention ? sources.read : []),
  ];
  const out: string[] = [];
  for (const raw of ordered) {
    const n = normaliseWatcherRelay(raw);
    if (!n || exclude.has(n) || out.includes(n)) continue;
    out.push(n);
    if (out.length === MAX_REGISTRATION_RELAYS) break;
  }
  return out;
}

// --- timestamps / identity ------------------------------------------------------

/**
 * The next `ts`: strictly increasing per user — max(now, last + 1) — or null
 * when that would fall outside the watcher's 2-minute future window (the
 * clock went back): wait rather than send something it refuses.
 *
 * One exception: a watermark more than 6 h ahead can't be one the watcher
 * accepted (it refuses anything over 2 min ahead of its own clock), unless
 * this clock is now >6 h slow — and then every ts is "too old" anyway. So it
 * is a relic of a wrong clock and is ignored instead of blocking for hours.
 */
export function nextRegistrationTs(lastTs: number, nowSec: number): number | null {
  if (lastTs > nowSec + REGISTRATION_MAX_AGE_SEC) return nowSec;
  const ts = Math.max(nowSec, lastTs + 1);
  return ts <= nowSec + REGISTRATION_MAX_SKEW_SEC - 10 ? ts : null;
}

/**
 * What a registration says, minus the parts that change on every send (`ts`,
 * the randomised NWC proof signatures). Two bodies with the same fingerprint
 * register the same thing. `withRelays: false` ignores the relay list.
 */
export function registrationFingerprint(
  body: Omit<RegisterContent, 'ts' | 'v'>,
  opts: { withRelays?: boolean } = {},
): string {
  const canonical = {
    app: body.app,
    platform: body.platform,
    token: body.token,
    apns_env: body.apns_env ?? null,
    categories: WATCHER_CATEGORIES.map((k) => body.categories[k]),
    nwc: body.nwc.map((e) => `${e.client}:${e.wallet}`).sort(),
    relays: opts.withRelays === false ? null : [...body.relays].sort(),
  };
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(canonical)))).slice(0, 32);
}

/** A stand-in for the device token in local state: the raw token is never
 * stored (DATA_STORAGE.adoc) — it is re-read from the OS when needed. */
export const pushTokenHash = (platform: PushPlatform, token: string): string =>
  bytesToHex(sha256(utf8ToBytes(`lp-watcher-token:${platform}:${token}`))).slice(0, 32);

// --- the gift wrap --------------------------------------------------------------

const TWO_DAYS = 2 * 86400;
const randomPast = (t: number) => t - Math.floor(Math.random() * TWO_DAYS);

/**
 * Gift-wrap a registration to the watcher. Two signer operations (the seal's
 * NIP-44 encryption and its signature); the wrap itself is signed with a
 * throwaway key so relays can't see who registered.
 */
export async function buildRegistrationWrap(
  signer: SealSigner,
  body: RegistrationBody,
  ts: number,
  watcherPubkey: string = WATCHER_PUBKEY,
): Promise<NostrEvent> {
  const content: RegistrationContent = { v: 1, ...body, ts } as RegistrationContent;
  const rumor = {
    kind: REGISTRATION_KIND,
    pubkey: signer.pubkey,
    created_at: ts,
    tags: [] as string[][],
    content: JSON.stringify(content),
  };
  const rumorJson = JSON.stringify({ ...rumor, id: getEventHash(rumor) });

  const seal = await signer.signEvent({
    kind: 13,
    created_at: randomPast(ts),
    tags: [],
    content: await signer.nip44Encrypt(watcherPubkey, rumorJson),
  });
  // A seal by another key, with tags, or not verifying is refused by the
  // watcher — catch it here rather than publish something that goes nowhere.
  if (seal.kind !== 13 || seal.pubkey !== signer.pubkey || seal.tags.length !== 0) {
    throw new Error('watcher: signer returned an unexpected seal');
  }
  // A fresh object: nostr-tools caches "verified" on the event it signed.
  const fresh = {
    id: seal.id,
    pubkey: seal.pubkey,
    created_at: seal.created_at,
    kind: seal.kind,
    tags: seal.tags,
    content: seal.content,
    sig: seal.sig,
  };
  if (!verifyEvent(fresh)) {
    throw new Error('watcher: seal signature invalid');
  }

  const ephemeral = generateSecretKey();
  return finalizeEvent(
    {
      kind: 1059,
      created_at: randomPast(Math.floor(Date.now() / 1000)),
      tags: [['p', watcherPubkey]],
      content: nip44EncryptForRecipient(JSON.stringify(seal), ephemeral, watcherPubkey),
    },
    ephemeral,
  );
}
