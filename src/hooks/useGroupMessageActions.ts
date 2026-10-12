import { useAccountState } from '../contexts/useAccountState';
import { resolveQuote, indexMessagesById } from '../utils/messageQuote';
import { deriveGroupWireKind } from '../utils/messageContent';
import { useCallback, useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { marmotReactionSource } from '../services/marmotReactions';
import type { GroupMessage } from '../services/groupMessagesStorageService';
import type { Item } from '../utils/conversationItems';
import { groupActionItem } from '../utils/groupMessageActions';
import { useConversationReactions } from './useConversationReactions';

const EMPTY_NAMES: ReadonlyMap<string, string> = new Map();
const noZap = () => {};
const noEvents = async () => [];
const noPublish = async () => null;
const noDelete = async () => false;

/** Group-scoped adapter for the shared optimistic reaction/action controller.
 * Observes the existing session emitter, never opens another relay stream. */
export function useGroupMessageActions({
  messages,
  myPubkey,
  groupId,
  memberNameByPubkey = EMPTY_NAMES,
  formatLocale,
}: {
  messages: GroupMessage[];
  myPubkey: string | null;
  groupId: string | null;
  memberNameByPubkey?: ReadonlyMap<string, string>;
  formatLocale?: string;
}) {
  const focused = useIsFocused();
  const source = useMemo(
    () => (myPubkey && groupId ? marmotReactionSource(myPubkey, '', groupId) : null),
    [myPubkey, groupId],
  );
  const items = useMemo(
    () => new Map(messages.map((m) => [m.id, groupActionItem(m, myPubkey)])),
    [messages, myPubkey],
  );
  const authors = useMemo(() => new Map(messages.map((m) => [m.id, m.senderPubkey])), [messages]);
  const authorForItem = useCallback((item: Item) => authors.get(item.id) ?? null, [authors]);
  const reactionMessages = useMemo(
    () =>
      messages.map((m) => ({
        id: m.id,
        rumorId: groupId ? items.get(m.id)?.rumorId : undefined,
        text: m.text,
        createdAt: m.createdAt,
        fromMe: m.senderPubkey === myPubkey,
      })),
    [messages, items, groupId, myPubkey],
  );
  const reactions = useConversationReactions({
    messages: reactionMessages,
    scopeKey: `${myPubkey}:${groupId}`,
    myPubkey,
    peerPubkey: '',
    authorForItem,
    fetchReactionsForMessages: focused ? (source?.fetchReactionsForMessages ?? noEvents) : noEvents,
    fetchReactionDeletions: focused ? (source?.fetchReactionDeletions ?? noEvents) : noEvents,
    publishReaction: source?.publishReaction ?? noPublish,
    deleteReaction: source?.deleteReaction ?? noDelete,
    subscribeLiveReactions: focused ? source?.subscribe : undefined,
    onZapMessage: noZap,
  });
  const { buildOnLongPress, buildOnToggleReaction, reactionsForItem } = reactions;
  const handlersById = useMemo(
    () =>
      new Map(
        [...items].map(([id, item]) => [
          id,
          {
            onLongPress: buildOnLongPress(item),
            onToggleReaction: buildOnToggleReaction(item),
          },
        ]),
      ),
    [items, buildOnLongPress, buildOnToggleReaction],
  );
  const propsById = useMemo(
    () =>
      new Map(
        [...items].map(([id, item]) => [
          id,
          {
            ...handlersById.get(id),
            reactions: reactionsForItem(item),
          },
        ]),
      ),
    [items, handlersById, reactionsForItem],
  );
  const propsForMessage = useCallback(
    (message: GroupMessage): Partial<NonNullable<ReturnType<typeof propsById.get>>> =>
      groupId ? (propsById.get(message.id) ?? {}) : {},
    [groupId, propsById],
  );
  const [replyTo, setReplyTo] = useAccountState<string | undefined>(
    `${myPubkey}:${groupId}`,
    undefined,
  );
  const cancelReply = useCallback(() => setReplyTo(undefined), [setReplyTo]);
  const { actionsForMessage: actioned, closeMessageActions: closeActions } = reactions;
  const startReply = useCallback(() => {
    if (!groupId || !actioned) return;
    setReplyTo(actioned.targetId);
    closeActions();
  }, [groupId, actioned, setReplyTo, closeActions]);
  const replyQuote = useMemo(() => {
    const quote = resolveQuote(
      replyTo,
      indexMessagesById(
        messages.map((m) => ({
          ...m,
          fromMe: m.senderPubkey.toLowerCase() === myPubkey?.toLowerCase(),
          wireKind: deriveGroupWireKind(m.text),
        })),
      ),
      formatLocale,
    );
    const parent = messages.find((m) => m.id === replyTo);
    return quote && parent
      ? { ...quote, authorName: memberNameByPubkey.get(parent.senderPubkey) }
      : quote;
  }, [replyTo, messages, myPubkey, memberNameByPubkey, formatLocale]);
  return { ...reactions, propsForMessage, replyTo, cancelReply, startReply, replyQuote };
}
