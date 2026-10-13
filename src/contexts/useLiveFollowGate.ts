import { useEffect, useLayoutEffect, useRef } from 'react';
import { subscribeFollowSet } from '../services/followSetEvents';
import { buildFollowSet } from '../utils/followPubkeys';
import { createLiveSubFollowGateBuffer, type DeferredFollowGateEntry } from './liveSubFollowGate';

/** Keep both wire paths current without waiting for contact-list transitions. */
export function useLiveFollowGate(follows: Set<string>, hydrated: boolean, owner?: string | null) {
  const followPubkeysRef = useRef(follows);
  const followHydratedRef = useRef(hydrated);
  const followGateBufferRef = useRef(createLiveSubFollowGateBuffer());
  const deferredReplayRef = useRef<((item: DeferredFollowGateEntry) => void) | null>(null);
  const adopted = useRef(false);
  const replayBuffered = () => {
    const replay = deferredReplayRef.current;
    if (!replay) return;
    const buffer = followGateBufferRef.current;
    let released = 0;
    buffer.reevaluate(followPubkeysRef.current, (item) => {
      released++;
      replay(item);
    });
    const dropped = buffer.size;
    buffer.clear();
    if (__DEV__)
      console.log(`[Nostr] follow-gate replay: ${released} released, ${dropped} dropped`);
  };
  const replayBufferedRef = useRef(replayBuffered);
  replayBufferedRef.current = replayBuffered;
  useLayoutEffect(() => {
    adopted.current = false;
    followHydratedRef.current = false;
    followPubkeysRef.current = new Set();
    if (!owner) return;
    return subscribeFollowSet(owner, (contacts) => {
      adopted.current = true;
      followPubkeysRef.current = buildFollowSet(contacts.map((c) => c.pubkey));
      followHydratedRef.current = true;
      // This is the same synchronous adoption that logs "follow set".
      // Replay the buffer directly; knownWrapIds/seen must not suppress it.
      replayBufferedRef.current();
    });
  }, [owner]);
  useEffect(() => {
    // Delayed UI props must never roll back the authoritative adopted list.
    if (adopted.current) return;
    followPubkeysRef.current = follows;
    followHydratedRef.current = hydrated;
    if (hydrated) replayBufferedRef.current();
  }, [follows, hydrated]);
  return { followPubkeysRef, followHydratedRef, followGateBufferRef, deferredReplayRef };
}
