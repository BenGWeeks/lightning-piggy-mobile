import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { Filter } from 'nostr-tools/filter';
import * as nip04 from 'nostr-tools/nip04';
import { nip44Decrypt, nip44Encrypt, nostrFinalizeEvent } from './nostrCrypto';
import { pool, trackRelays } from './nostrService';
import { LIVE_LOCATION_PING_KIND, type LiveUpdateKey } from './liveLocationService';

// Ephemeral kind-20069 live-location ping helpers (#206). Extracted from
// nostrService (#703 — keep that over-cap file from growing).
//
// Two update shapes exist on the relays:
//   - session-key updates (#1300, current): signed by a throwaway per-session
//     key, NO tags, NIP-44 encrypted under a secret shared in the start marker
//     — relays learn neither sender, recipient nor session, and neither side
//     needs a signer (so Amber / NIP-46 work in the background);
//   - legacy pings (older builds): signed by the user, `p` + `d` tags, NIP-04.

/** A NIP-17 share's update channel, including the session's secret key. */
export interface LiveUpdateChannel extends LiveUpdateKey {
  /** Hex secret key of the session pubkey — sender side only. */
  sessionSecretKey: string;
}

/** Mint a fresh update channel for a new NIP-17 share. */
export function newLiveUpdateChannel(): LiveUpdateChannel {
  const sk = generateSecretKey();
  return {
    pubkey: getPublicKey(sk),
    secret: bytesToHex(generateSecretKey()),
    sessionSecretKey: bytesToHex(sk),
  };
}

/** Sign + encrypt one session-key update (no tags, no user identity). */
export function createSessionLiveUpdateEvent(
  channel: LiveUpdateChannel,
  payloadJson: string,
  nowSec: number = Math.floor(Date.now() / 1000),
) {
  return nostrFinalizeEvent(
    {
      kind: LIVE_LOCATION_PING_KIND,
      created_at: nowSec,
      tags: [],
      content: nip44Encrypt(payloadJson, hexToBytes(channel.secret)),
    },
    hexToBytes(channel.sessionSecretKey),
  );
}

/** Decrypt a session-key update's content; null if it doesn't decrypt. */
export function decryptSessionLiveUpdate(secretHex: string, content: string): string | null {
  try {
    return nip44Decrypt(content, hexToBytes(secretHex));
  } catch {
    return null;
  }
}

/**
 * ONE relay REQ for the session-key updates of every watched NIP-17 share:
 * `authors` = the session pubkeys announced in their start markers. Bounded
 * by `since` (earliest share start) and `limit`.
 */
export function subscribeSessionLiveUpdates(input: {
  sessionPubkeys: string[];
  since: number;
  relays: string[];
  onEvent: (ev: { pubkey: string; content: string; created_at: number }) => void;
}): () => void {
  if (input.sessionPubkeys.length === 0) return () => {};
  trackRelays(input.relays);
  const filter: Filter = {
    kinds: [LIVE_LOCATION_PING_KIND],
    authors: input.sessionPubkeys,
    since: input.since,
    limit: 50,
  };
  const sub = pool.subscribeMany(input.relays, filter, {
    onevent: (ev) => input.onEvent(ev),
  });
  return () => {
    try {
      sub.close();
    } catch {
      // best-effort
    }
  };
}

/**
 * Build an ephemeral kind-20069 live-location ping. Body is NIP-04
 * encrypted with the sender's secret so only the recipient can read
 * the coordinates; tags carry `['p', recipient]` for relay routing
 * (mainstream relays index `#p`) and `['d', sessionId]` so the
 * receiver's subscription can filter by session — the same sender
 * may have multiple concurrent shares running to different peers.
 *
 * NIP-01 mandates that relays drop events in the 20000-29999 range
 * after fan-out, which is exactly what we want for a high-frequency
 * coordinate stream — no relay-side history to clutter the receiver
 * the next time they open the conversation.
 */
export async function createLiveLocationPingEvent(
  senderSecretKey: Uint8Array,
  recipientPubkey: string,
  sessionId: string,
  payloadJson: string,
  kind: number,
): Promise<{ kind: number; created_at: number; tags: string[][]; content: string }> {
  const ciphertext = await nip04.encrypt(senderSecretKey, recipientPubkey, payloadJson);
  return {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', recipientPubkey],
      ['d', sessionId],
    ],
    content: ciphertext,
  };
}

/**
 * LEGACY receive path (shares started by older builds): subscribe to
 * author-signed NIP-04 pings for MANY sessions over a SINGLE relay REQ.
 * The full-Map "friends sharing with me" layer can watch a dozen concurrent
 * inbound shares; opening one REQ per session (as the per-conversation viewer
 * does for its handful) floods relays — nos.lol / Primal reject with "too many
 * concurrent REQs", which also starves the app's other subscriptions. One
 * filter with `authors` + `#d` arrays collapses them into a single REQ; since
 * sessionIds are unique random hex, the receiver still routes each ping to the
 * right session by its `d` tag (the caller decodes + matches on sessionId).
 *
 * No-op (returns a noop unsub) when there are no sessions to watch.
 */
export function subscribeLiveLocationPingsMulti(input: {
  viewerPubkey: string;
  senderPubkeys: string[];
  sessionIds: string[];
  kind: number;
  /** Unix epoch SECONDS — earliest session start, to bound the window. */
  since: number;
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
  if (input.senderPubkeys.length === 0 || input.sessionIds.length === 0) {
    return () => {};
  }
  trackRelays(input.relays);
  const filter: Filter = {
    kinds: [input.kind],
    authors: input.senderPubkeys,
    '#p': [input.viewerPubkey],
    '#d': input.sessionIds,
    since: input.since,
    limit: 50,
  };
  const sub = pool.subscribeMany(input.relays, filter, {
    onevent: (ev) => input.onEvent(ev),
  });
  return () => {
    try {
      sub.close();
    } catch {
      // best-effort
    }
  };
}
