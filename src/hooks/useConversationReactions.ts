import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../components/BrandedAlert';
import type { ConversationMessageInput, Item } from '../utils/conversationItems';
import {
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
  }, [messages, fetchReactionsForMessages, mergeFreshRecords]);

  // The currently-actioned message (long-pressed → MessageActionsSheet open).
  const [actionsForMessage, setActionsForMessage] = useState<ActionedMessage | null>(null);
  const closeMessageActions = useCallback(() => setActionsForMessage(null), []);

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
      const optimisticId = `local-react-${Date.now()}`;
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
      if (realId) {
        setReactionRecords((prev) =>
          prev.map((r) => (r.id === optimisticId ? { ...r, id: realId } : r)),
        );
      } else {
        setReactionRecords((prev) => prev.filter((r) => r.id !== optimisticId));
        Alert.alert(
          'Reaction failed',
          'Could not publish your reaction. Check your relays and try again.',
        );
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
