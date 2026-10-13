import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  createFollowGateStore,
  getFollowGateStore,
  replayFollowGateStore,
  subscribeFollowSet,
} from '../services/followSetEvents';
import type { DeferredFollowGateEntry } from './liveSubFollowGate';

/** Canonical account state survives hook remounts and subscription re-opens. */
export function useLiveFollowGate(follows: Set<string>, hydrated: boolean, owner?: string | null) {
  const [unowned] = useState(createFollowGateStore);
  const store = owner ? getFollowGateStore(owner) : unowned;
  useLayoutEffect(() => {
    if (!owner) return;
    return subscribeFollowSet(owner, () => replayFollowGateStore(store));
  }, [owner, store]);
  useEffect(() => {
    // Cache paints and delayed UI props must not roll back authoritative adoption.
    if (store.adopted) return;
    store.followPubkeysRef.current = follows;
    store.followHydratedRef.current = hydrated;
    if (hydrated) replayFollowGateStore(store);
  }, [follows, hydrated, store]);
  const setDeferredReplay = useCallback(
    (replay: ((item: DeferredFollowGateEntry) => void) | null) => {
      store.deferredReplayRef.current = replay;
      // Adoption may have completed while the subscription was closed.
      if (replay) replayFollowGateStore(store);
    },
    [store],
  );
  return { ...store, setDeferredReplay };
}
