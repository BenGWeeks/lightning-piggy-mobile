// Marmot push notifications (MIP-05, `marmot-push-v1`) — the SEND side.
//
// Members of a Marmot group gossip their encrypted native push tokens inside
// the group (kinds 447/448 records, 449 removals). When we send a message, we
// wake the other members' phones by gift-wrapping their encrypted tokens to
// each token's notification server (kind 446 trigger). The server — White
// Noise's Transponder, for White Noise users — decrypts the token and sends a
// content-free native push. We never see a device token, the server never
// sees the message or the group.
//
// Receiving pushes on OUR devices needs a Lightning Piggy notification server
// (Apple/Google only deliver with the app's own credentials), so this module
// only reads other members' records and triggers them.
//
// Spec: marmot features/push-notifications.md + transports/nostr.md ("Push
// notification delivery"). Everything here is advisory: a bad record is
// dropped, and nothing ever affects message validity or group state.

import { Buffer } from 'buffer';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getEventHash, nip59, type Event as NostrEvent } from 'nostr-tools';

export const PUSH_TRIGGER_KIND = 446;
export const PUSH_TOKEN_UPDATE_KIND = 447;
export const PUSH_TOKEN_LIST_KIND = 448;
export const PUSH_TOKEN_REMOVAL_KIND = 449;
const OWNER_PROOF_KIND = 451;
const PUSH_VERSION = 'marmot-push-v1';
const ENCRYPTED_TOKEN_LEN = 1084;
const MAX_ENTRIES = 32;
// MDK caps one gift wrap at 19 tokens to stay under relay size limits.
const TOKENS_PER_WRAP = 19;
const MAX_FUTURE_MS = 3_600_000;
const RECORD_DOMAIN = 'marmot-push-token-record-v1';
const REMOVAL_DOMAIN = 'marmot-push-token-removal-v1';
const PLATFORM_BYTE = { apns: 1, fcm: 2 } as const;

/** App kinds whose send wakes the other members (MDK: chat and poll; not
 * reactions, edits, deletes, push gossip or kinds White Noise can't show). */
export const PUSH_TRIGGERING_KINDS: readonly number[] = [9, 1068];

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{24}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

type Platform = keyof typeof PLATFORM_BYTE;

export interface PushRecord {
  member: string;
  leaf: number;
  platform: Platform;
  fingerprint: string;
  server: string;
  relayHint?: string;
  /** Standard base64 of the 1084-byte EncryptedToken. */
  encryptedToken: string;
  ownerTs: number;
  ownerSig: string;
}

type Removal = Omit<PushRecord, 'relayHint' | 'encryptedToken'>;

interface Stamp {
  ts: number;
  digest: string;
}

/** Per record key: the stamp of the entry that last wrote it, and the record
 * (null = a removal's tombstone, which blocks older entries resurrecting it). */
export type PushRecordState = Record<string, { stamp: Stamp; record: PushRecord | null }>;

const recordKey = (r: Removal) => `${r.member}|${r.leaf}|${r.platform}|${r.server}`;
/** "member|leaf" — current group leaves, as the selection/cleanup filter. */
export const leafKey = (member: string, leaf: number) => `${member}|${leaf}`;

// --- parsing ---------------------------------------------------------------

const isUint = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;

function parseIdentity(raw: Record<string, unknown>, nowMs: number): Removal | null {
  const { member_id_hex, leaf_index, platform, token_fingerprint, server_pubkey_hex } = raw;
  const { owner_ts, owner_sig } = raw;
  if (typeof member_id_hex !== 'string' || !HEX64.test(member_id_hex)) return null;
  if (!isUint(leaf_index, 0xffffffff)) return null;
  if (platform !== 'apns' && platform !== 'fcm') return null;
  if (typeof token_fingerprint !== 'string' || !FINGERPRINT.test(token_fingerprint)) return null;
  if (typeof server_pubkey_hex !== 'string' || !HEX64.test(server_pubkey_hex)) return null;
  if (!isUint(owner_ts, Number.MAX_SAFE_INTEGER) || owner_ts > nowMs + MAX_FUTURE_MS) return null;
  if (typeof owner_sig !== 'string' || !HEX128.test(owner_sig)) return null;
  return {
    member: member_id_hex,
    leaf: leaf_index,
    platform,
    fingerprint: token_fingerprint,
    server: server_pubkey_hex,
    ownerTs: owner_ts,
    ownerSig: owner_sig,
  };
}

function decodeEncryptedToken(v: unknown): string | null {
  if (typeof v !== 'string' || v.length % 4 !== 0 || !BASE64.test(v)) return null;
  const bytes = Buffer.from(v, 'base64');
  // Canonical only: Buffer ignores non-zero padding bits ("…AB=="), which a
  // strict decoder (MDK) rejects — and the owner proof signs the exact string.
  return bytes.length === ENCRYPTED_TOKEN_LEN && bytes.toString('base64') === v ? v : null;
}

/** Shape-valid entries of a 447/448 (`tokens`) or 449 (`removals`) payload.
 * Signatures are checked separately. A whole array over 32 is dropped. */
export function parsePushPayload(
  kind: number,
  content: string,
  nowMs: number,
): { records: PushRecord[]; removals: Removal[] } {
  const none = { records: [], removals: [] };
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return none;
  }
  if (!json || typeof json !== 'object' || (json as { v?: unknown }).v !== PUSH_VERSION) {
    return none;
  }
  const field = kind === PUSH_TOKEN_REMOVAL_KIND ? 'removals' : 'tokens';
  const arr = (json as Record<string, unknown>)[field];
  if (!Array.isArray(arr) || arr.length > MAX_ENTRIES) return none;
  const out: { records: PushRecord[]; removals: Removal[] } = { records: [], removals: [] };
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const id = parseIdentity(raw as Record<string, unknown>, nowMs);
    if (!id) continue;
    if (kind === PUSH_TOKEN_REMOVAL_KIND) {
      out.removals.push(id);
      continue;
    }
    const encryptedToken = decodeEncryptedToken(
      (raw as { encrypted_token?: unknown }).encrypted_token,
    );
    if (!encryptedToken) continue;
    const hint = (raw as { relay_hint?: unknown }).relay_hint;
    if (hint !== undefined && typeof hint !== 'string') continue;
    // SignedRecord carries the hint's length as a u16.
    if (hint && utf8ToBytes(hint).length > 0xffff) continue;
    out.records.push({
      ...id,
      encryptedToken,
      ...(hint && hint.trim() ? { relayHint: hint } : {}),
    });
  }
  return out;
}

// --- owner authentication + ordering ----------------------------------------

/** Id of the local-only kind-451 owner-proof event the owner signed. */
export function ownerProofEventId(entry: Removal | PushRecord, groupIdHex: string): string {
  const isRecord = 'encryptedToken' in entry;
  const tags = [
    ['d', isRecord ? RECORD_DOMAIN : REMOVAL_DOMAIN],
    ['group_id', groupIdHex],
    ['member_id', entry.member],
    ['leaf_index', String(entry.leaf)],
    ['platform', entry.platform],
    ['server_pubkey', entry.server],
    ['token_fingerprint', entry.fingerprint],
    ['owner_ts', String(entry.ownerTs)],
    ['relay_hint', isRecord ? (entry.relayHint ?? '') : ''],
    ...(isRecord ? [['encrypted_token_encoding', 'base64']] : []),
  ];
  return getEventHash({
    pubkey: entry.member,
    created_at: 0,
    kind: OWNER_PROOF_KIND,
    tags,
    content: isRecord ? entry.encryptedToken : '',
  });
}

export function verifyOwnerSig(entry: Removal | PushRecord, groupIdHex: string): boolean {
  try {
    return schnorr.verify(
      hexToBytes(entry.ownerSig),
      hexToBytes(ownerProofEventId(entry, groupIdHex)),
      hexToBytes(entry.member),
    );
  } catch {
    return false;
  }
}

/** SHA-256 of the fixed-width SignedRecord — the ordering tie-breaker. */
export function signedRecordDigest(entry: Removal | PushRecord, groupId: Uint8Array): string {
  const isRecord = 'encryptedToken' in entry;
  const domain = utf8ToBytes(isRecord ? RECORD_DOMAIN : REMOVAL_DOMAIN);
  const hint = isRecord && entry.relayHint ? utf8ToBytes(entry.relayHint) : new Uint8Array();
  const token = isRecord ? Buffer.from(entry.encryptedToken, 'base64') : new Uint8Array();
  const buf = new Uint8Array(
    domain.length + 2 + groupId.length + 32 + 4 + 1 + 32 + 12 + 8 + 2 + hint.length + token.length,
  );
  const view = new DataView(buf.buffer);
  let o = 0;
  const put = (b: Uint8Array) => {
    buf.set(b, o);
    o += b.length;
  };
  put(domain);
  view.setUint16(o, groupId.length);
  o += 2;
  put(groupId);
  put(hexToBytes(entry.member));
  view.setUint32(o, entry.leaf);
  o += 4;
  buf[o++] = PLATFORM_BYTE[entry.platform];
  put(hexToBytes(entry.server));
  put(hexToBytes(entry.fingerprint.slice('sha256:'.length)));
  view.setBigUint64(o, BigInt(entry.ownerTs));
  o += 8;
  view.setUint16(o, hint.length);
  o += 2;
  put(hint);
  put(token);
  return bytesToHex(sha256(buf));
}

const newer = (a: Stamp, b: Stamp) => a.ts > b.ts || (a.ts === b.ts && a.digest > b.digest);

/**
 * Apply one 447/448/449 payload to a group's record state. Each entry must
 * carry a valid owner signature and name a current leaf; it then wins its
 * record key only with a strictly greater (owner_ts, digest) stamp. Removals
 * leave a tombstone. Returns the new state (the input is not mutated).
 */
export async function applyPushPayload(
  state: PushRecordState,
  kind: number,
  content: string,
  group: { idHex: string; id: Uint8Array; leaves: Set<string> },
  nowMs: number,
  maybeYield: () => Promise<void> = async () => undefined,
): Promise<PushRecordState> {
  const { records, removals } = parsePushPayload(kind, content, nowMs);
  const next = { ...state };
  for (const entry of [...records, ...removals]) {
    await maybeYield(); // a full 448 is up to 32 pure-JS Schnorr verifies
    if (!group.leaves.has(leafKey(entry.member, entry.leaf))) continue;
    if (!verifyOwnerSig(entry, group.idHex)) continue;
    const stamp = { ts: entry.ownerTs, digest: signedRecordDigest(entry, group.id) };
    const key = recordKey(entry);
    const stored = next[key];
    if (stored && !newer(stamp, stored.stamp)) continue;
    next[key] = { stamp, record: 'encryptedToken' in entry ? (entry as PushRecord) : null };
  }
  return next;
}

/** Drop records and tombstones of leaves that have left the group. */
export function pruneToLeaves(state: PushRecordState, leaves: Set<string>): PushRecordState {
  const next: PushRecordState = {};
  for (const [key, value] of Object.entries(state)) {
    const [member, leaf] = key.split('|');
    if (leaves.has(`${member}|${leaf}`)) next[key] = value;
  }
  return next;
}

// --- triggering --------------------------------------------------------------

export interface TriggerTarget {
  server: string;
  relayHints: string[];
  tokens: string[];
}

/** Whose devices to wake for a message we send: every other member's active
 * record, newest per (member, platform, server) like MDK, grouped by server. */
export function selectTriggerTargets(
  state: PushRecordState,
  myPubkey: string,
  leaves: Set<string>,
): TriggerTarget[] {
  const me = myPubkey.toLowerCase();
  const newest = new Map<string, { stamp: Stamp; record: PushRecord }>();
  for (const { stamp, record } of Object.values(state)) {
    if (!record || record.member === me || !leaves.has(leafKey(record.member, record.leaf))) {
      continue;
    }
    const k = `${record.member}|${record.platform}|${record.server}`;
    const prev = newest.get(k);
    if (!prev || newer(stamp, prev.stamp)) newest.set(k, { stamp, record });
  }
  const byServer = new Map<string, TriggerTarget>();
  for (const { record } of newest.values()) {
    const t = byServer.get(record.server) ?? { server: record.server, relayHints: [], tokens: [] };
    t.tokens.push(record.encryptedToken);
    if (record.relayHint && !t.relayHints.includes(record.relayHint)) {
      t.relayHints.push(record.relayHint);
    }
    byServer.set(record.server, t);
  }
  return [...byServer.values()];
}

/**
 * The kind-1059 gift wraps carrying kind-446 triggers to `server`: the
 * rumor's content is the concatenated EncryptedTokens (base64), its only tag
 * `["v","marmot-push-v1"]`; rumor and seal share one fresh ephemeral key, the
 * wrap another (nostr-tools nip59).
 */
export function* buildTriggerWraps(server: string, tokens: string[]): Generator<NostrEvent> {
  // A generator: each wrap is a sign + two NIP-44 encryptions, so callers can
  // yield the JS thread between wraps instead of building them all at once.
  for (let i = 0; i < tokens.length; i += TOKENS_PER_WRAP) {
    const chunk = tokens.slice(i, i + TOKENS_PER_WRAP).map((t) => Buffer.from(t, 'base64'));
    const content = Buffer.concat(chunk).toString('base64');
    yield nip59.wrapEvent(
      { kind: PUSH_TRIGGER_KIND, content, tags: [['v', PUSH_VERSION]] },
      generateSecretKey(),
      server,
    );
  }
}
