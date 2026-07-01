import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Event as NostrEvent } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS, pool } from '../services/nostrService';
import { querySyncAbortable } from '../services/relayQuery';
import {
  DEFAULT_COMMENTS_LIMIT,
  commentFilterForRoot,
  commentRootRef,
  directReplies,
  topLevelComments,
  type CommentRoot,
} from '../utils/productComments';

export interface UseProductComments {
  /** Every comment in the thread (all depths). */
  allComments: NostrEvent[];
  /** Comments rooted directly on the product, newest-first. */
  topLevel: NostrEvent[];
  /** Direct replies to a given comment id, oldest-first. */
  getDirectReplies: (parentId: string) => NostrEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Live product comments (NIP-22 kind 1111) rooted on the kind-30402 product.
 * `root` should be memoised by the caller so its identity is stable across
 * renders; a null root (seller without a Nostr identity) yields an empty set.
 */
export function useProductComments(root: CommentRoot | null): UseProductComments {
  const { relays } = useNostr();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const readRelays = useMemo(() => {
    const r = relays.filter((x) => x.read).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);

  // Stable string identity for the root, so the effect re-runs only when the
  // product actually changes (not on every parent re-render).
  const rootRef = root ? commentRootRef(root) : null;

  useEffect(() => {
    if (!root) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    querySyncAbortable(pool, readRelays, commentFilterForRoot(root, DEFAULT_COMMENTS_LIMIT), {
      maxWait: 5000,
      signal: controller.signal,
    })
      .then((evs) => {
        if (!controller.signal.aborted) setEvents(evs);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Failed to load comments');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // `root` is memoised upstream; `rootRef` is the stable re-run trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, readRelays, tick]);

  const topLevel = useMemo(() => (root ? topLevelComments(events, root) : []), [events, root]);
  const getDirectReplies = useCallback(
    (parentId: string) => directReplies(events, parentId),
    [events],
  );

  return { allComments: events, topLevel, getDirectReplies, loading, error, refetch };
}
