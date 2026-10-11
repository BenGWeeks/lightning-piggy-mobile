import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { Event as NostrEvent } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS, pool, trackRelays } from '../services/nostrService';
import { querySyncAbortable } from '../services/relayQuery';
import {
  DEFAULT_COMMENTS_LIMIT,
  belongsToRoot,
  commentFilterForRoot,
  commentRootRef,
  directReplies,
  topLevelComments,
  type CommentRoot,
} from '../utils/productComments';
import { reconcileComments } from '../utils/commentEdits';
import { DELETION_KIND, deletionFilters, idRefs } from '../utils/nip09';

export interface UseProductComments {
  /** Every visible comment in the thread (all depths) — deleted and
   * superseded (edited) versions already removed. */
  allComments: NostrEvent[];
  /** Comments rooted directly on the product, newest-first. */
  topLevel: NostrEvent[];
  /** Direct replies to a given comment id, oldest-first. */
  getDirectReplies: (parentId: string) => NostrEvent[];
  loading: boolean;
  /**
   * True when the relay query failed. The user-facing copy is localized at the
   * render layer (`market.comments.loadError`) rather than baked in here, so
   * the message follows the app's selected locale.
   */
  error: boolean;
  refetch: () => void;
  /** Show a comment we just published at once (before the refetch sees it). */
  addLocally: (comment: NostrEvent) => void;
  /** Hide a comment at once (deleted / replaced); returns the undo. */
  hideLocally: (id: string) => () => void;
}

/**
 * Live product comments (NIP-22 kind 1111) rooted on the kind-30402 product.
 * `root` should be memoised by the caller so its identity is stable across
 * renders; a null root (seller without a Nostr identity) yields an empty set.
 */
export function useProductComments(root: CommentRoot | null): UseProductComments {
  const { relays } = useNostr();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  // Author kind-5 deletions of the fetched comments (#1272).
  const [deletions, setDeletions] = useState<NostrEvent[]>([]);
  // Optimistic state from this device's own edits/deletes. Survives refetches:
  // a relay that ignores NIP-09 must not bring a deleted comment back here.
  const [localAdded, setLocalAdded] = useState<NostrEvent[]>([]);
  const [localHidden, setLocalHidden] = useState<ReadonlySet<string>>(() => new Set());
  // Read by the fetch (not a dep): our own posts are checked for deletions
  // too, in case another device deleted one relays no longer return.
  const localAddedRef = useRef(localAdded);
  useEffect(() => {
    localAddedRef.current = localAdded;
  }, [localAdded]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const readRelays = useMemo(() => {
    const r = relays.filter((x) => x.read).map((x) => x.url);
    return r.length > 0 ? r : DEFAULT_RELAYS;
  }, [relays]);

  // Stable string identity for the root, so the effect re-runs only when the
  // product actually changes (not on every parent re-render).
  const rootRef = root ? commentRootRef(root) : null;

  // Focus-armed (repo rule: relay work is armed with useFocusEffect, never a
  // bare useEffect): the Explore stack uses freezeOnBlur, so a blurred product
  // page must abort its in-flight query rather than run it to maxWait.
  useFocusEffect(
    useCallback(() => {
      if (!root) {
        setEvents([]);
        setDeletions([]);
        setLoading(false);
        setError(false);
        return;
      }
      const controller = new AbortController();
      setLoading(true);
      setError(false);
      // Register the relays we open so nostrService.cleanup() closes them.
      trackRelays(readRelays);
      querySyncAbortable(pool, readRelays, commentFilterForRoot(root, DEFAULT_COMMENTS_LIMIT), {
        maxWait: 5000,
        rejectOnAllRelaysFailure: true,
        signal: controller.signal,
      })
        .then((evs) => {
          if (controller.signal.aborted) return;
          // The `#A` filter is only a relay-side request — keep only comments
          // whose ROOT tag is this product before storing/counting them.
          const comments = evs.filter((e) => belongsToRoot(e, root));
          setEvents(comments);
          setLoading(false);
          // Then the kind-5s naming them (most relays already dropped what was
          // deleted; this covers the ones that kept it). Best-effort: a failed
          // lookup just keeps the previous deletions.
          return Promise.all(
            deletionFilters('e', idRefs([...comments, ...localAddedRef.current])).map((filter) =>
              querySyncAbortable(pool, readRelays, filter, {
                maxWait: 4000,
                signal: controller.signal,
              }),
            ),
          ).then(
            (batches) => {
              if (controller.signal.aborted) return;
              setDeletions(batches.flat().filter((e) => e.kind === DELETION_KIND));
            },
            () => undefined,
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => controller.abort();
      // `root` is memoised upstream; `rootRef` is the stable re-run trigger.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rootRef, readRelays, tick]),
  );

  const visible = useMemo(
    () =>
      reconcileComments(
        localAdded.length > 0 ? [...events, ...localAdded] : events,
        deletions,
        localHidden,
      ),
    [events, localAdded, deletions, localHidden],
  );
  const topLevel = useMemo(() => (root ? topLevelComments(visible, root) : []), [visible, root]);
  const getDirectReplies = useCallback(
    (parentId: string) => directReplies(visible, parentId),
    [visible],
  );

  // One setState per user action (never per relay event).
  const addLocally = useCallback((comment: NostrEvent) => {
    setLocalAdded((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
  }, []);
  const hideLocally = useCallback((id: string) => {
    setLocalHidden((prev) => new Set(prev).add(id));
    return () =>
      setLocalHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
  }, []);

  return {
    allComments: visible,
    topLevel,
    getDirectReplies,
    loading,
    error,
    refetch,
    addLocally,
    hideLocally,
  };
}
