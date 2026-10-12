import { useMemo, type RefObject } from 'react';
import type { FlatList } from 'react-native';
import { useChatReadPosition } from './useChatReadPosition';
import { useListScrollToId } from './useListScrollToId';
import { dmReadKey } from '../services/chatReadPositions';
import type { Item } from '../utils/conversationItems';
import type { UnreadEntry } from '../utils/chatUnread';

export const conversationItemKey = (it: Item) => it.id;

/**
 * Read position for a 1:1 thread (#1295): `useChatReadPosition` fed from the
 * inverted timeline. `items` run newest-first with day headers mixed in; the
 * read maths wants oldest-first messages, and a jump lands its row near the
 * visual top (viewPosition 1 on an inverted list).
 */
export function useConversationReadPosition({
  listRef,
  items,
  owner,
  peer,
  loading,
  leaveEdge,
}: {
  listRef: RefObject<FlatList<Item> | null>;
  items: readonly Item[];
  owner: string | null;
  peer: string;
  loading: boolean;
  leaveEdge: (holdMs?: number) => void;
}) {
  const entries = useMemo<UnreadEntry[]>(() => {
    const out: UnreadEntry[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind !== 'dayHeader')
        out.push({ id: it.id, createdAt: it.createdAt, fromMe: it.fromMe });
    }
    return out;
  }, [items]);
  const { scrollToId, onScrollToIndexFailed } = useListScrollToId(
    listRef,
    items,
    conversationItemKey,
    1,
  );
  const read = useChatReadPosition({
    owner,
    conversationKey: dmReadKey(peer),
    entries,
    loading,
    scrollToId,
    leaveEdge,
  });
  return { ...read, onScrollToIndexFailed };
}
