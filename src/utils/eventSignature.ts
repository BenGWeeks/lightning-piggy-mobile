// Explicit Nostr signature check for read paths that must not trust the
// pool's verifier (which may skip or fast-path some kinds). Pure — no I/O.
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';

/**
 * Whether `event`'s id and schnorr signature are valid; malformed input is
 * invalid rather than throwing. nostr-tools memoises the result on the event,
 * so re-checking something the pool already verified is free.
 */
export function hasValidSignature(event: NostrEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}
