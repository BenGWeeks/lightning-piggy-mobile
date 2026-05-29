import type { Filter } from 'nostr-tools/filter';
import * as nip04 from 'nostr-tools/nip04';
import { pool, trackRelays } from './nostrService';

// Ephemeral kind-20069 live-location ping helpers (#206). Extracted from
// nostrService (#703 — keep that over-cap file from growing); behaviour is
// unchanged.

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
 * Subscribe to ephemeral kind-N events for the viewer's pubkey, filtered
 * by sessionId. `since` is set to the live-share start time so we don't
 * pick up stale pings if a relay (incorrectly) cached one — a defensive
 * measure since spec-conformant relays will drop ephemerals on disconnect
 * but real-world relays sometimes hold them briefly in memory.
 *
 * Returns an unsubscribe function. The caller is responsible for
 * decrypting the inbound event content with their own secret key.
 */
export function subscribeLiveLocationPings(input: {
  viewerPubkey: string;
  senderPubkey: string;
  sessionId: string;
  kind: number;
  /** Unix epoch SECONDS — defaults to now-60 to cope with clock drift. */
  since?: number;
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
  const filter: Filter = {
    kinds: [input.kind],
    authors: [input.senderPubkey],
    '#p': [input.viewerPubkey],
    '#d': [input.sessionId],
    since: input.since ?? Math.floor(Date.now() / 1000) - 60,
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
 * Subscribe to live-location pings for MANY sessions over a SINGLE relay REQ.
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
