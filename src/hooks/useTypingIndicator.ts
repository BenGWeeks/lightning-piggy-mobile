import { useCallback, useEffect, useRef, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import { getMemoisedSecretKey } from '../contexts/nostrSecretKeyCache';
import { publishTypingIndicator, subscribeTyping } from '../services/nostrTyping';

/** At most one typing event is published per this window while the user is
 *  actively typing — keeps a fast typist from flooding relays. */
const SEND_THROTTLE_MS = 4000;
/** Clear the peer's "typing…" this long after their last typing event. */
const PEER_TYPING_TIMEOUT_MS = 6000;

/**
 * Ephemeral typing indicator for a 1:1 conversation with `peerPubkey`.
 *
 * - `isPeerTyping` — true while the peer is typing (set on each incoming
 *   ephemeral typing event, auto-cleared PEER_TYPING_TIMEOUT_MS after the last).
 * - `notifyTyping()` — call on every composer keystroke; throttled to one
 *   publish per SEND_THROTTLE_MS. **Only the local `nsec` signer sends** —
 *   Amber / NIP-46 would prompt / relay-round-trip per keystroke, so those
 *   signers still *receive* typing but don't broadcast it.
 */
export function useTypingIndicator(peerPubkey: string | null): {
  isPeerTyping: boolean;
  notifyTyping: () => void;
} {
  const { pubkey, signerType, relays } = useNostr();
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const lastSentRef = useRef(0);
  const peerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Receive: subscribe to the peer's typing pings to me.
  useEffect(() => {
    if (!pubkey || !peerPubkey) return;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    if (readRelays.length === 0) return;
    const unsub = subscribeTyping({
      myPubkey: pubkey,
      peerPubkey,
      relays: readRelays,
      onTyping: () => {
        setIsPeerTyping(true);
        if (peerTimerRef.current) clearTimeout(peerTimerRef.current);
        peerTimerRef.current = setTimeout(() => setIsPeerTyping(false), PEER_TYPING_TIMEOUT_MS);
      },
    });
    return () => {
      unsub();
      if (peerTimerRef.current) clearTimeout(peerTimerRef.current);
      setIsPeerTyping(false);
    };
    // `relays` identity changes when the user edits their relay list; re-arm then.
  }, [pubkey, peerPubkey, relays]);

  const notifyTyping = useCallback(() => {
    if (signerType !== 'nsec' || !pubkey || !peerPubkey) return;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return;
    lastSentRef.current = now;
    void (async () => {
      try {
        const secretKey = await getMemoisedSecretKey(pubkey);
        if (!secretKey) return;
        const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
        await publishTypingIndicator({ peerPubkey, secretKey, relays: writeRelays });
      } catch {
        // Typing indicators are best-effort — a failed key read / publish
        // must never surface as an unhandled rejection.
      }
    })();
  }, [signerType, pubkey, peerPubkey, relays]);

  return { isPeerTyping, notifyTyping };
}
