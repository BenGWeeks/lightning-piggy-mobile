import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { FlatList } from 'react-native';

/** Give up re-trying a scroll to a not-yet-measured row after this many tries. */
const MAX_RETRIES = 3;

/**
 * Scroll a chat FlatList to the row with a given id (#1295: the first unread
 * message, the next mention). Rows aren't fixed-height, so a target outside
 * the rendered window fails `scrollToIndex`; we then jump to an estimate from
 * the average row height and retry once it has rendered.
 *
 * `viewPosition` is where the row lands: 0 = top of the viewport. In an
 * inverted list the axis is flipped, so pass 1 there to land near the top.
 */
export function useListScrollToId<T>(
  listRef: RefObject<FlatList<T> | null>,
  data: readonly T[],
  keyOf: (item: T) => string,
  viewPosition: number,
) {
  const dataRef = useRef(data);
  dataRef.current = data;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const scrollToId = useCallback(
    (id: string, animated = true): boolean => {
      const index = dataRef.current.findIndex((item) => keyRef.current(item) === id);
      if (index < 0 || !listRef.current) return false;
      retries.current = 0;
      listRef.current.scrollToIndex({ index, viewPosition, viewOffset: 8, animated });
      return true;
    },
    [listRef, viewPosition],
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const list = listRef.current;
      if (!list || retries.current >= MAX_RETRIES) return;
      retries.current += 1;
      list.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (info.index < dataRef.current.length) {
          listRef.current?.scrollToIndex({ index: info.index, viewPosition, animated: true });
        }
      }, 120);
    },
    [listRef, viewPosition],
  );

  return { scrollToId, onScrollToIndexFailed };
}
