import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../components/BrandedAlert';
import type { ConversationMessageInput, Item } from '../utils/conversationItems';
import {
  applyReactionDeletion,
  isOptimisticReactionId,
  makeOptimisticReactionId,
  parseReactionEvent,
  reduceReactions,
  type MessageReactionState,
  type ReactionRecord,
} from '../utils/reactions';

// Per-message reactions + long-press action state for the 1:1 conversation
// (#205). Lifted out of ConversationScreen (file-size cap) so the screen stays
// composition: the hook owns the kind-7 fetch/reduce, the optimistic
// publish/retract toggle, and the "currently-actioned message" descriptor;
// the screen just renders pills + the MessageActionsSheet from what it returns.

export interface UseConversationReactionsParams {
  messages: ConversationMessageInput[];
  // Viewer pubkey (author of our own sent bubbles).
  myPubkey: string | null;
  // This conversation's peer pubkey (author of received bubbles).
  peerPubkey: string;
  fetchReactionsForMessages: (targetEventIds: string[]) => Promise<
    {
      id: string;
      pubkey: string;
      kind: number;
      content: string;
      created_at: number;
      tags: string[][];
    }[]
  >;
  publishReaction: (input: {
    emoji: string;
    targetEventId: string;
    targetAuthorPubkey: string;
    targetEventKind?: number;
  }) => Promise<string | null>;
  deleteReaction: (reactionEventId: string) => Promise<boolean>;
  // Fetch NIP-09 (kind-5) retractions of the given reaction event ids, so a
  // peer un-reacting is reflected locally instead of leaving a stale pill.
  fetchReactionDeletions: (reactionEventIds: string[]) => Promise<
    {
      id: string;
      pubkey: string;
      created_at: number;
      tags: string[][];
    }[]
  >;
  // Opens the SendSheet preset to the peer — the "Zap this message" action.
  onZapMessage: () => void;
}

interface ActionedMessage {
  targetId: string;
  authorPubkey: string;
  fromMe: boolean;
  // kind-14 (NIP-17 chat) or kind-4 (NIP-04 DM); goes in the kind-7 `k` tag.
  targetKind: 14 | 4;
}

export interface UseConversationReactionsResult {
  reactionsByTarget: Map<string, MessageReactionState>;
  actionsForMessage: ActionedMessage | null;
  closeMessageActions: () => void;
  handleToggleReaction: (emoji: string, existingReactionId: string | null) => void;
  handleZapMessage: () => void;
  // Per-item helpers the screen's renderItem wires straight into MessageBubble.
  reactionsForItem: (item: Item) => MessageReactionState | undefined;
  buildOnLongPress: (item: Item) => (() => void) | undefined;
  buildOnToggleReaction: (
    item: Item,
  ) => ((emoji: string, existingReactionId: string | null) => void) | undefined;
}

// A message item's cross-peer-stable reaction/zap target id, or undefined for
// variants that don't carry one (zap cards, order cards, day headers).
function itemRumorId(item: Item): string | undefined {
  if (item.kind === 'message' || item.kind === 'gif' || item.kind === 'location') {
    return item.rumorId;
  }
  return undefined;
}

export function useConversationReactions({
  messages,
  myPubkey,
  peerPubkey,
  fetchReactionsForMessages,
  publishReaction,
  deleteReaction,
  fetchReactionDeletions,
  onZapMessage,
}: UseConversationReactionsParams): UseConversationReactionsResult {
  // `reactionRecords` is the flat list of every kind-7 seen for any message in
  // this thread; `reactionsByTarget` is the reduced view. Separate slots so an
  // optimistic local append folds in cleanly without a re-fetch.
  const [reactionRecords, setReactionRecords] = useState<ReactionRecord[]>([]);
  const reactionsByTarget = useMemo<Map<string, MessageReactionState>>(
    () => reduceReactions(reactionRecords, myPubkey ?? null),
    [reactionRecords, myPubkey],
  );

  // Target ids we've already issued a fetch for — guards a back-pressure loop
  // when a slow relay + optimistic-append churn re-run the effect.
  const reactionFetchScheduledRef = useRef(new Set<string>());

  const mergeFreshRecords = useCallback((fresh: ReactionRecord[]) => {
    if (fresh.length === 0) return;
    setReactionRecords((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const merged = [...prev];
      for (const r of fresh) {
        if (!seen.has(r.id)) {
          merged.push(r);
          seen.add(r.id);
        }
      }
      return merged;
    });
  }, []);

  // Apply a batch of NIP-09 (kind-5) deletion events to the local record list.
  // Each deletion's `e` tags name the reaction ids it retracts; NIP-09 only
  // lets an event's own author delete it, so `applyReactionDeletion` drops a
  // record only when the deleter pubkey matches the reactor's — a third party
  // can't retract someone else's reaction. No-op (returns `prev`) when nothing
  // actually matched, so an unrelated deletion batch doesn't force a re-render.
  const applyDeletionEvents = useCallback((deletions: { pubkey: string; tags: string[][] }[]) => {
    if (deletions.length === 0) return;
    setReactionRecords((prev) => {
      let next = prev;
      for (const d of deletions) {
        for (const t of d.tags) {
          if (t[0] === 'e' && typeof t[1] === 'string' && t[1].length > 0) {
            next = applyReactionDeletion(next, t[1].toLowerCase(), d.pubkey);
          }
        }
      }
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // Fetch reactions for any new target ids (the cross-peer-stable rumor id).
  // Optimistic-local / warm-cache rows without a rumorId are skipped — they'll
  // get fetched once a decrypt supplies the id.
  useEffect(() => {
    // Capture the (stable) scheduled-ids Set once so the cleanup closes over
    // the same instance the effect body used — the ref is never reassigned.
    const scheduled = reactionFetchScheduledRef.current;
    const targets: string[] = [];
    for (const m of messages) {
      const targetId = m.rumorId;
      if (!targetId) continue;
      if (scheduled.has(targetId)) continue;
      targets.push(targetId);
      scheduled.add(targetId);
    }
    if (targets.length === 0) return;
    let cancelled = false;
    let settled = false;
    (async () => {
      try {
        const events = await fetchReactionsForMessages(targets);
        settled = true;
        if (cancelled || events.length === 0) return;
        const fresh = events.map(parseReactionEvent).filter((r): r is ReactionRecord => !!r);
        mergeFreshRecords(fresh);
        // Now that we know the reaction ids for these targets, pull any NIP-09
        // retractions of them and apply them — so a peer who un-reacted before
        // we loaded doesn't leave a stale pill rendered.
        const reactionIds = fresh.map((r) => r.id);
        if (reactionIds.length === 0) return;
        const deletions = await fetchReactionDeletions(reactionIds);
        if (cancelled) return;
        applyDeletionEvents(deletions);
      } catch {
        settled = true;
      }
    })();
    return () => {
      cancelled = true;
      // If the effect is torn down (e.g. `messages` changed) before the fetch
      // resolves, un-schedule this run's ids so a later run can retry.
      // Otherwise a cancelled in-flight fetch would leave them permanently
      // marked "scheduled" and their reactions would never load.
      if (!settled) {
        for (const id of targets) scheduled.delete(id);
      }
    };
  }, [
    messages,
    fetchReactionsForMessages,
    mergeFreshRecords,
    fetchReactionDeletions,
    applyDeletionEvents,
  ]);

  // The currently-actioned message (long-pressed → MessageActionsSheet open).
  const [actionsForMessage, setActionsForMessage] = useState<ActionedMessage | null>(null);
  const closeMessageActions = useCallback(() => setActionsForMessage(null), []);

  // Optimistic-publish bookkeeping for the removal-before-ack race. When the
  // user un-reacts before `publishReaction` has returned the real kind-7 id,
  // we can't yet delete the real event — so we record the optimistic id here.
  // Once the publish resolves, the add path sees the id in this set and
  // retracts the REAL id instead of leaking a reaction the user cancelled.
  const cancelledOptimisticRef = useRef(new Set<string>());
  // Monotonic counter feeding `makeOptimisticReactionId` so two taps in the
  // same millisecond can't collide on an id (the cancel bookkeeping keys on it).
  const optimisticSeqRef = useRef(0);

  // Core toggle: publish/delete a reaction for an EXPLICIT target descriptor.
  // Taking the target as an argument (rather than reading `actionsForMessage`)
  // keeps the pill-tap path race-free — the caller passes the item's descriptor
  // directly instead of seeding state and hoping it commits first.
  const toggleReactionForTarget = useCallback(
    async (target: ActionedMessage | null, emoji: string, existingReactionId: string | null) => {
      if (!target || !myPubkey) {
        closeMessageActions();
        return;
      }
      closeMessageActions();
      if (existingReactionId) {
        setReactionRecords((prev) => prev.filter((r) => r.id !== existingReactionId));
        // Removal-before-ack race: if the reaction is still an un-acked
        // optimistic add, its real kind-7 id isn't known yet — a NIP-09 delete
        // against the `local-react-*` placeholder is a no-op on relays, so the
        // real event would later publish and resurface on the next load. Flag
        // the pending publish as cancelled instead; the add path below retracts
        // the REAL id once `publishReaction` resolves.
        if (isOptimisticReactionId(existingReactionId)) {
          cancelledOptimisticRef.current.add(existingReactionId);
          return;
        }
        const ok = await deleteReaction(existingReactionId);
        if (!ok) {
          // Reconcile via re-fetch if the deletion failed (optimistic remove
          // was wrong) — cheaper than threading rollback state.
          reactionFetchScheduledRef.current.delete(target.targetId);
          const events = await fetchReactionsForMessages([target.targetId]);
          mergeFreshRecords(events.map(parseReactionEvent).filter((r): r is ReactionRecord => !!r));
        }
        return;
      }
      // Optimistic add — synthesize a `local-…` record so the pill renders
      // immediately; replace with the real id once publish returns.
      const optimisticId = makeOptimisticReactionId(optimisticSeqRef.current++);
      const optimistic: ReactionRecord = {
        id: optimisticId,
        reactorPubkey: myPubkey.toLowerCase(),
        emoji,
        createdAt: Math.floor(Date.now() / 1000),
        targetEventId: target.targetId,
      };
      setReactionRecords((prev) => [...prev, optimistic]);
      const realId = await publishReaction({
        emoji,
        targetEventId: target.targetId,
        targetAuthorPubkey: target.authorPubkey,
        targetEventKind: target.targetKind,
      });
      // Did the user un-react while the publish was in flight? (`delete` both
      // reads and clears the flag in one shot.)
      const cancelled = cancelledOptimisticRef.current.delete(optimisticId);
      if (realId) {
        if (cancelled) {
          // The reaction WAS published (real id now known) but the user has
          // since removed it — retract the REAL kind-7 so it doesn't reappear
          // on the next load. The optimistic record was already filtered out
          // by the removal path above.
          void deleteReaction(realId);
          return;
        }
        setReactionRecords((prev) =>
          prev.map((r) => (r.id === optimisticId ? { ...r, id: realId } : r)),
        );
      } else {
        // Publish failed — nothing landed on a relay. Drop the placeholder and
        // only warn if the user hadn't already cancelled the reaction.
        setReactionRecords((prev) => prev.filter((r) => r.id !== optimisticId));
        if (!cancelled) {
          Alert.alert(
            'Reaction failed',
            'Could not publish your reaction. Check your relays and try again.',
          );
        }
      }
    },
    [
      closeMessageActions,
      myPubkey,
      publishReaction,
      deleteReaction,
      fetchReactionsForMessages,
      mergeFreshRecords,
    ],
  );

  // Sheet-driven toggle (MessageActionsSheet): acts on the currently-actioned
  // message. Reads `actionsForMessage` because the sheet is a singleton bound
  // to whichever message was long-pressed.
  const handleToggleReaction = useCallback(
    (emoji: string, existingReactionId: string | null) => {
      void toggleReactionForTarget(actionsForMessage, emoji, existingReactionId);
    },
    [toggleReactionForTarget, actionsForMessage],
  );

  // Zap the actioned message's author. Close the sheet first so SendSheet
  // doesn't open on top of a bottom sheet.
  const handleZapMessage = useCallback(() => {
    closeMessageActions();
    onZapMessage();
  }, [closeMessageActions, onZapMessage]);

  // Resolve an item's descriptor (target id + author + inner kind), or null
  // when it isn't a reaction target (missing rumor id, or a non-message row).
  const descriptorForItem = useCallback(
    (item: Item): ActionedMessage | null => {
      const targetId = itemRumorId(item);
      if (!targetId || item.kind === 'zap' || item.kind === 'order' || item.kind === 'dayHeader') {
        return null;
      }
      const authorPubkey = item.fromMe ? myPubkey : peerPubkey;
      if (!authorPubkey) return null;
      const targetKind: 14 | 4 = item.kind === 'message' && item.wireKind === 4 ? 4 : 14;
      return { targetId, authorPubkey, fromMe: item.fromMe, targetKind };
    },
    [myPubkey, peerPubkey],
  );

  const reactionsForItem = useCallback(
    (item: Item): MessageReactionState | undefined => {
      const targetId = itemRumorId(item);
      return targetId ? reactionsByTarget.get(targetId) : undefined;
    },
    [reactionsByTarget],
  );

  const buildOnLongPress = useCallback(
    (item: Item): (() => void) | undefined => {
      const descriptor = descriptorForItem(item);
      if (!descriptor) return undefined;
      return () => setActionsForMessage(descriptor);
    },
    [descriptorForItem],
  );

  const buildOnToggleReaction = useCallback(
    (item: Item) => {
      const descriptor = descriptorForItem(item);
      if (!descriptor) return undefined;
      // Pass the descriptor straight through so the toggle acts on THIS pill's
      // message — no `setActionsForMessage` + `setTimeout` dance (which could
      // race a concurrent long-press and toggle the wrong / a null target).
      return (emoji: string, existingReactionId: string | null) => {
        void toggleReactionForTarget(descriptor, emoji, existingReactionId);
      };
    },
    [descriptorForItem, toggleReactionForTarget],
  );

  return {
    reactionsByTarget,
    actionsForMessage,
    closeMessageActions,
    handleToggleReaction,
    handleZapMessage,
    reactionsForItem,
    buildOnLongPress,
    buildOnToggleReaction,
  };
}
