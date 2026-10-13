import { useEffect, useRef } from 'react';
import { createLiveSubFollowGateBuffer, type DeferredFollowGateEntry } from './liveSubFollowGate';

/** Keep gate state current without reopening the relay subscription. */
export function useLiveFollowGate(follows: Set<string>, hydrated: boolean) {
  const followPubkeysRef = useRef(follows);
  const followHydratedRef = useRef(hydrated);
  const followGateBufferRef = useRef(createLiveSubFollowGateBuffer());
  const deferredReplayRef = useRef<((item: DeferredFollowGateEntry) => void) | null>(null);
  useEffect(() => {
    followPubkeysRef.current = follows;
    followHydratedRef.current = hydrated;
    const replay = deferredReplayRef.current;
    if (hydrated && replay) {
      followGateBufferRef.current.reevaluate(follows, replay);
      followGateBufferRef.current.clear();
    }
  }, [follows, hydrated]);
  return { followPubkeysRef, followHydratedRef, followGateBufferRef, deferredReplayRef };
}
