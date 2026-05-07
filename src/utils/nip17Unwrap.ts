import * as nip59 from 'nostr-tools/nip59';
import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';
import type { RawGiftWrapEvent } from '../services/nostrService';

/**
 * Shape of a decoded NIP-17 message after two layers of NIP-44 decrypt.
 * Matches the kind-14 (chat) / kind-15 (file) rumor fields we read.
 */
export interface DecodedRumor {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Runtime-validate the parsed JSON of a kind-13 seal. Rejects missing or
 * mistyped fields that `as` casts would silently accept. The seal's kind
 * must be 13 per NIP-59 — we assert it up front so the caller can tell
 * "bad seal" apart from "right shape, wrong kind".
 */
function parseSeal(
  raw: string,
): { pubkey: string; content: string; kind: number; created_at: number; tags: string[][] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const s = parsed as Record<string, unknown>;
  if (typeof s.pubkey !== 'string' || !HEX64.test(s.pubkey.toLowerCase())) return null;
  if (typeof s.content !== 'string') return null;
  if (typeof s.kind !== 'number') return null;
  if (typeof s.created_at !== 'number') return null;
  if (!Array.isArray(s.tags)) return null;
  if (!s.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) return null;
  return {
    pubkey: (s.pubkey as string).toLowerCase(),
    content: s.content as string,
    kind: s.kind as number,
    created_at: s.created_at as number,
    tags: s.tags as string[][],
  };
}

/**
 * Runtime-validate the parsed rumor payload. Unlike the seal, the rumor
 * is unsigned so we don't check a sig — we just require the shape we'll
 * actually read.
 */
function parseRumor(raw: string): DecodedRumor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.pubkey !== 'string' || !HEX64.test(r.pubkey.toLowerCase())) return null;
  if (typeof r.created_at !== 'number') return null;
  if (typeof r.kind !== 'number') return null;
  if (typeof r.content !== 'string') return null;
  if (!Array.isArray(r.tags)) return null;
  if (!r.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) return null;
  return {
    pubkey: (r.pubkey as string).toLowerCase(),
    created_at: r.created_at as number,
    kind: r.kind as number,
    content: r.content as string,
    tags: r.tags as string[][],
  };
}

/**
 * Asserts the wrap event's signature before we trust its `pubkey` /
 * `content`. The wrap is signed by a random ephemeral key per the spec —
 * we don't care who the ephemeral key belongs to, only that the payload
 * wasn't mutated in transit. Returns true on valid sig.
 */
export function verifyWrapSig(wrap: RawGiftWrapEvent): boolean {
  try {
    return verifyEvent(wrap as unknown as NostrEvent);
  } catch {
    return false;
  }
}

type Nip44Decrypt = (ciphertext: string, counterpartyPubkey: string) => Promise<string>;

/**
 * Two-layer NIP-17 unwrap: wrap → seal → rumor. Takes a `decryptNip44`
 * callback so the same logic works for nsec (pure JS via nostr-tools) and
 * for Amber (IPC via amberService). The callback must throw on failure.
 *
 * Returns null (never throws) on any verification / shape failure so
 * callers can skip bad wraps without crashing the inbox. Reasons for a
 * null return are logged through the injected `onSkip` hook.
 */
export async function unwrapWrapViaNip44(
  wrap: RawGiftWrapEvent,
  decryptNip44: Nip44Decrypt,
  onSkip?: (reason: string, wrapId: string) => void,
): Promise<DecodedRumor | null> {
  const skip = (reason: string): null => {
    onSkip?.(reason, wrap.id);
    return null;
  };

  if (!verifyWrapSig(wrap)) return skip('wrap signature invalid');

  let sealJson: string;
  try {
    sealJson = await decryptNip44(wrap.content, wrap.pubkey);
  } catch (error) {
    return skip(`wrap decrypt failed: ${(error as Error)?.message ?? 'unknown'}`);
  }
  const seal = parseSeal(sealJson);
  if (!seal) return skip('seal JSON malformed or wrong shape');
  if (seal.kind !== 13) return skip(`seal kind is ${seal.kind}, expected 13`);

  let rumorJson: string;
  try {
    rumorJson = await decryptNip44(seal.content, seal.pubkey);
  } catch (error) {
    return skip(`seal decrypt failed: ${(error as Error)?.message ?? 'unknown'}`);
  }
  const rumor = parseRumor(rumorJson);
  if (!rumor) return skip('rumor JSON malformed or wrong shape');

  // NIP-17 spec requirement: rumor.pubkey MUST equal seal.pubkey. Bail on
  // any mismatch — a tampered rumor is indistinguishable from someone
  // spoofing a sender identity.
  if (rumor.pubkey !== seal.pubkey) {
    return skip(
      `rumor pubkey ${rumor.pubkey.slice(0, 8)}… != seal pubkey ${seal.pubkey.slice(0, 8)}…`,
    );
  }

  return rumor;
}

/**
 * Convenience wrapper for the nsec path: invokes nostr-tools' nip59
 * unwrapEvent directly. Still runs verifyWrapSig for parity with the
 * Amber path (nostr-tools' unwrap will throw if the payload is malformed
 * but doesn't re-verify the sig — that's the caller's job per NIP-01).
 */
export function unwrapWrapNsec(
  wrap: RawGiftWrapEvent,
  secretKey: Uint8Array,
  onSkip?: (reason: string, wrapId: string) => void,
): DecodedRumor | null {
  if (!verifyWrapSig(wrap)) {
    onSkip?.('wrap signature invalid', wrap.id);
    return null;
  }
  try {
    const rumor = nip59.unwrapEvent(wrap as unknown as NostrEvent, secretKey);
    const r: unknown = rumor;
    if (!r || typeof r !== 'object') {
      onSkip?.('rumor not an object', wrap.id);
      return null;
    }
    const casted = r as DecodedRumor;
    if (typeof casted.pubkey !== 'string' || !HEX64.test(casted.pubkey.toLowerCase())) {
      onSkip?.('rumor pubkey malformed', wrap.id);
      return null;
    }
    return {
      pubkey: casted.pubkey.toLowerCase(),
      created_at: casted.created_at,
      kind: casted.kind,
      content: casted.content,
      tags: casted.tags,
    };
  } catch (error) {
    onSkip?.(`nsec unwrap failed: ${(error as Error)?.message ?? 'unknown'}`, wrap.id);
    return null;
  }
}

/**
 * Given a decoded rumor and the viewer's own pubkey, returns who the
 * conversation's "partner" is, or null if malformed.
 *
 *  - If `rumor.pubkey === viewerPubkey` the user sent the message
 *    themselves (outgoing; partner comes from the first `p` tag).
 *  - Otherwise the sender is the partner (incoming).
 *
 * Returned pubkey is already lowercased.
 */
export function partnerFromRumor(
  rumor: DecodedRumor,
  viewerPubkey: string,
): { partnerPubkey: string; fromMe: boolean } | null {
  const me = viewerPubkey.toLowerCase();
  if (rumor.pubkey === me) {
    const pTag = rumor.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
    if (!pTag || !HEX64.test(pTag)) return null;
    return { partnerPubkey: pTag, fromMe: true };
  }
  return { partnerPubkey: rumor.pubkey, fromMe: false };
}

/**
 * Extract the value of the rumor's `subject` tag (NIP-14 / NIP-17 spec
 * "the current name/topic of the conversation"), or null if absent /
 * empty / non-string. Trimmed; subjects that whitespace-collapse to
 * empty are returned as null so callers can use `?? fallback` cleanly.
 *
 * Used by the spec-aligned group-routing fallback: when a kind-14
 * arrives from a foreign client (Amethyst, 0xchat) that doesn't know
 * about LP's kind-30200 group-state event, the `subject` is the only
 * source of truth for the conversation's name.
 */
export function subjectFromRumor(rumor: DecodedRumor): string | null {
  for (const t of rumor.tags) {
    if (t[0] !== 'subject') continue;
    const v = t[1];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    return trimmed;
  }
  return null;
}

/**
 * Extract the full set of pubkeys participating in a kind-14 rumor.
 * Includes the sender (`rumor.pubkey`) plus every well-formed `p` tag
 * value, lowercased and deduplicated.
 *
 * Used by the group-routing path: a kind-14 rumor with two-or-more
 * pubkeys-other-than-the-viewer is a group message — we match the
 * resulting set against the locally-known group rosters.
 */
export function participantsFromRumor(rumor: DecodedRumor): Set<string> {
  const set = new Set<string>();
  if (HEX64.test(rumor.pubkey)) set.add(rumor.pubkey.toLowerCase());
  for (const tag of rumor.tags) {
    if (tag[0] !== 'p') continue;
    const v = tag[1]?.toLowerCase();
    if (v && HEX64.test(v)) set.add(v);
  }
  return set;
}

/**
 * Classify a kind-14 rumor as either a 1:1 DM or a group message.
 * Returns null if the rumor is malformed (e.g. no resolvable partner).
 *
 *  - DM: exactly one OTHER participant (the viewer plus one peer).
 *  - Group: two or more OTHER participants. Caller is responsible for
 *    looking up which group the participant set matches.
 *
 * `fromMe` reflects whether the viewer is the sender. The set of
 * `otherParticipants` always EXCLUDES the viewer.
 */
export function classifyRumor(
  rumor: DecodedRumor,
  viewerPubkey: string,
):
  | { type: 'dm'; partnerPubkey: string; fromMe: boolean }
  | { type: 'group'; otherParticipants: Set<string>; fromMe: boolean }
  | null {
  const me = viewerPubkey.toLowerCase();
  const all = participantsFromRumor(rumor);
  if (all.size === 0) return null;
  const others = new Set<string>(all);
  others.delete(me);
  const fromMe = rumor.pubkey.toLowerCase() === me;
  if (others.size === 0) {
    // Self-talk wraps shouldn't happen in practice — bail rather than
    // miscategorise as a DM with `partnerPubkey === me`.
    return null;
  }
  if (others.size === 1) {
    const partnerPubkey = Array.from(others)[0];
    return { type: 'dm', partnerPubkey, fromMe };
  }
  return { type: 'group', otherParticipants: others, fromMe };
}
