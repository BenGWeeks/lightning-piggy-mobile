import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getReadMarker,
  getReadPositionsVersion,
  hydrateReadPositions,
  subscribeReadPositions,
} from '../services/chatReadPositions';
import type { ReadMarker } from '../utils/chatUnread';

/**
 * The account's chat read positions (#1295) as a lookup function. Its
 * identity changes only when the store hydrates or flushes (coalesced, at
 * most every PERSIST_DELAY_MS), so a list that depends on it re-renders on
 * those beats rather than on every scroll mark.
 */
export function useReadPositions(
  owner: string | null | undefined,
): (conversationKey: string) => ReadMarker | null {
  const version = useSyncExternalStore(
    subscribeReadPositions,
    getReadPositionsVersion,
    getReadPositionsVersion,
  );
  useEffect(() => {
    void hydrateReadPositions(owner);
  }, [owner]);
  return useCallback(
    (conversationKey: string) => getReadMarker(owner, conversationKey),
    // `version` is the store snapshot: a new lookup per hydrate / flush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owner, version],
  );
}
