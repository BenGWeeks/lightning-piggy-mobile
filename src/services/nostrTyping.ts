import { finalizeEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools';
import { pool, publishSignedEvent, trackRelays } from './nostrService';

/**
 * Ephemeral "user is typing…" indicator for 1:1 DM conversations.
 *
 * Uses an **ephemeral event** (kind 20000–29999, NIP-16): relays fan it out to
 * live subscribers but never store it — exactly the semantics a transient
 * typing signal wants. The event is `p`-tagged to the peer so they can filter
 * for it, carries **no content** (only the author + kind + p-tag tuple), and
 * carries an NIP-40 `expiration` so NIP-40-aware relays drop it after a few
 * seconds even before the client-side timeout.
 *
 * Privacy note: the `p` tag reveals "A is typing to B" as relay-visible
 * metadata — this is inherent to any relay-based typing indicator, and no
 * message *content* is ever exposed. Sending is gated to the local `nsec`
 * signer in the UI layer (see useTypingIndicator): Amber / NIP-46 are never
 * asked to sign a keystroke-frequency event.
 */
export const TYPING_INDICATOR_KIND = 20001;

/** Relays drop the event this many seconds after it's sent (NIP-40). Slightly
 *  longer than the receiver's client-side clear timeout so a relay never keeps
 *  a "typing" alive past the UI. */
export const TYPING_EXPIRY_SECONDS = 30;

/** Lookback applied to the subscription's `since` so a small sender-clock
 *  skew doesn't make a relay drop a live typing event whose `created_at`
 *  lands just before the receiver's `now`. Mirrors the drift compensation in
 *  other tag-filtered ephemeral subs (e.g. `nostrLiveLocation` → `now - 60`).
 *  Replay isn't a concern here — ephemeral events are never stored. */
export const TYPING_SINCE_LOOKBACK_SECONDS = 60;

/** Build the unsigned ephemeral typing event for `peerPubkey`. */
export function buildTypingEvent(
  peerPubkey: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: TYPING_INDICATOR_KIND,
    created_at: nowSec,
    tags: [
      ['p', peerPubkey],
      ['expiration', String(nowSec + TYPING_EXPIRY_SECONDS)],
    ],
    content: '',
  };
}

/** Sign (with the local secret key) + publish a typing indicator to `relays`.
 *  Best-effort: failures are swallowed — a dropped typing ping is harmless. */
export async function publishTypingIndicator(input: {
  peerPubkey: string;
  secretKey: Uint8Array;
  relays: string[];
}): Promise<void> {
  if (input.relays.length === 0) return;
  try {
    const signed = finalizeEvent(buildTypingEvent(input.peerPubkey), input.secretKey);
    await publishSignedEvent(signed, input.relays);
  } catch {
    // Typing indicators are fire-and-forget — never surface an error.
  }
}

/**
 * Subscribe to typing events the peer sends *to me*. Calls `onTyping` for each
 * one. `since: now` so we don't replay stale pings on (re)subscribe. Returns an
 * unsubscribe function.
 */
export function subscribeTyping(input: {
  myPubkey: string;
  peerPubkey: string;
  relays: string[];
  onTyping: () => void;
}): () => void {
  if (input.relays.length === 0) return () => {};
  // Track for nostrService.cleanup() so these relay connections are closed
  // on teardown like every other sub helper.
  trackRelays(input.relays);
  const filter: Filter = {
    kinds: [TYPING_INDICATOR_KIND],
    authors: [input.peerPubkey],
    '#p': [input.myPubkey],
    since: Math.floor(Date.now() / 1000) - TYPING_SINCE_LOOKBACK_SECONDS,
  };
  const sub = pool.subscribeMany(input.relays, filter, {
    onevent: () => input.onTyping(),
  });
  return () => {
    try {
      sub.close();
    } catch {
      // ignore — already closed
    }
  };
}
