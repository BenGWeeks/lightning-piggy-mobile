// MIP-05 entries WE publish for this device: the kind-447 self-update that
// announces our encrypted push token in a group, and the kind-449 removal
// that retracts it. Each entry carries `owner_sig` — the user's signature
// over a local-only kind-451 owner-proof event (marmotPush.ownerProofEvent),
// so it stays verifiable whichever member relays it.
//
// Pure: building, signature checking and serialisation only. Deciding when
// to publish (and how often to ask a remote signer) is marmotPushRegistrar.

import { Buffer } from 'buffer';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getEventHash } from 'nostr-tools';

import {
  ownerProofEvent,
  PUSH_TOKEN_REMOVAL_KIND,
  PUSH_TOKEN_UPDATE_KIND,
  PUSH_VERSION,
  type PushRecord,
  type Removal,
} from './marmotPush';
import { encryptPushToken, type PushPlatform } from './marmotPushToken';

/** This device's push registration, as the registrar publishes it. */
export interface DeviceRegistration {
  platform: PushPlatform;
  /** Raw platform token bytes (never persisted or logged). */
  token: Uint8Array;
  /** `sha256:` + 24 hex — names the token without revealing it. */
  fingerprint: string;
  /** Notification server's x-only pubkey, lowercase hex. */
  server: string;
  relayHint?: string;
}

/** What a signer hands back: a full signed Nostr event. */
export interface SignedProof {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

type ProofTemplate = ReturnType<typeof ownerProofEvent>;
export type Sign = (template: ProofTemplate) => Promise<SignedProof>;

/** Our unsigned token record for one group. The token is sealed afresh per
 * group (no shared ciphertext), but the spec-required fingerprint is the
 * same everywhere, so someone in two of our groups can tell the records
 * belong to one device. */
export function buildOwnRecord(
  reg: DeviceRegistration,
  member: string,
  leaf: number,
  ownerTs: number,
): Omit<PushRecord, 'ownerSig'> {
  const sealed = encryptPushToken(reg.platform, reg.token, reg.server);
  return {
    member,
    leaf,
    platform: reg.platform,
    fingerprint: reg.fingerprint,
    server: reg.server,
    ...(reg.relayHint && reg.relayHint.trim() ? { relayHint: reg.relayHint } : {}),
    encryptedToken: Buffer.from(sealed).toString('base64'),
    ownerTs,
  };
}

/**
 * MIP-05: before copying an external signer's signature into `owner_sig`,
 * the returned event must match the request exactly, its id must be the
 * locally recomputed one, and the BIP-340 signature must verify.
 */
/** The signer handed back something other than a valid signature over the
 * exact owner-proof event we asked for. */
export class OwnerProofMismatch extends Error {}

export function ownerSigFromSigned(expected: ProofTemplate, signed: SignedProof): string {
  const id = getEventHash(expected);
  const same =
    signed.id === id &&
    signed.pubkey === expected.pubkey &&
    signed.created_at === expected.created_at &&
    signed.kind === expected.kind &&
    signed.content === expected.content &&
    JSON.stringify(signed.tags) === JSON.stringify(expected.tags);
  if (!same) throw new OwnerProofMismatch('push: signer returned a different owner-proof event');
  let valid = false;
  try {
    valid =
      /^[0-9a-f]{128}$/.test(signed.sig) &&
      schnorr.verify(hexToBytes(signed.sig), hexToBytes(id), hexToBytes(expected.pubkey));
  } catch {
    valid = false;
  }
  if (!valid) throw new OwnerProofMismatch('push: owner-proof signature does not verify');
  return signed.sig;
}

/** Sign an entry's owner proof for `groupIdHex` (one signer call). */
export async function signEntry<T extends Omit<PushRecord, 'ownerSig'> | Omit<Removal, 'ownerSig'>>(
  entry: T,
  groupIdHex: string,
  sign: Sign,
): Promise<T & { ownerSig: string }> {
  // The template only reads the identity fields + token; ownerSig is unused.
  const template = ownerProofEvent({ ...entry, ownerSig: '' } as PushRecord | Removal, groupIdHex);
  return { ...entry, ownerSig: ownerSigFromSigned(template, await sign(template)) };
}

/** A removal for a record we published earlier (same record key). */
export function removalFor(record: PushRecord, ownerTs: number): Omit<Removal, 'ownerSig'> {
  return {
    member: record.member,
    leaf: record.leaf,
    platform: record.platform,
    fingerprint: record.fingerprint,
    server: record.server,
    ownerTs,
  };
}

const identityJson = (e: Removal) => ({
  member_id_hex: e.member,
  leaf_index: e.leaf,
  platform: e.platform,
  token_fingerprint: e.fingerprint,
  server_pubkey_hex: e.server,
});

/** The app event announcing our token record (kind 447 self-update). */
export function tokenUpdateEvent(record: PushRecord) {
  const entry = {
    ...identityJson(record),
    ...(record.relayHint ? { relay_hint: record.relayHint } : {}),
    encrypted_token: record.encryptedToken,
    owner_ts: record.ownerTs,
    owner_sig: record.ownerSig,
  };
  return {
    kind: PUSH_TOKEN_UPDATE_KIND,
    tags: [['v', PUSH_VERSION]],
    content: JSON.stringify({ v: PUSH_VERSION, tokens: [entry] }),
  };
}

/** The app event retracting a token record (kind 449). */
export function tokenRemovalEvent(removal: Removal) {
  const entry = {
    ...identityJson(removal),
    owner_ts: removal.ownerTs,
    owner_sig: removal.ownerSig,
  };
  return {
    kind: PUSH_TOKEN_REMOVAL_KIND,
    tags: [['v', PUSH_VERSION]],
    content: JSON.stringify({ v: PUSH_VERSION, removals: [entry] }),
  };
}
