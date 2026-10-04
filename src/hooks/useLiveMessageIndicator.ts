import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export interface LiveMessageEntry {
  id: string;
  createdAt: number;
}

/** Follow the live edge, but let readers decide when to leave message history. */
export function useLiveMessageIndicator({
  scope,
  entries,
  loading = false,
  edge = 'start',
  scrollToLatest,
}: {
  scope: string;
  entries: readonly LiveMessageEntry[];
  loading?: boolean;
  edge?: 'start' | 'end';
  scrollToLatest: (animated: boolean) => void;
}) {
  const previous = useRef<{ scope: string; ids: Set<string>; newest: number } | null>(null);
  const activeScope = useRef(scope);
  const nearEdge = useRef(true);
  const scrollRef = useRef(scrollToLatest);
  scrollRef.current = scrollToLatest;
  const [atEdge, setAtEdge] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useEffect(() => {
    if (activeScope.current !== scope) {
      activeScope.current = scope;
      previous.current = null;
      nearEdge.current = true;
      setAtEdge(true);
      setHasNewMessages(false);
    }
    if (loading) return;
    const old = previous.current;
    const newest = entries.reduce((max, entry) => Math.max(max, entry.createdAt), -Infinity);
    const changedScope = old?.scope !== scope;
    const arrived =
      !changedScope &&
      entries.some((entry) => !old.ids.has(entry.id) && entry.createdAt >= old.newest);
    previous.current = {
      scope,
      ids: new Set(entries.map((entry) => entry.id)),
      newest: changedScope ? newest : Math.max(newest, old!.newest),
    };
    if (changedScope) {
      nearEdge.current = true;
      setAtEdge(true);
      setHasNewMessages(false);
      return;
    }
    if (!arrived) return;
    if (!nearEdge.current) {
      setHasNewMessages(true);
      return;
    }
    const timer = setTimeout(() => {
      if (nearEdge.current) scrollRef.current(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [scope, entries, loading]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distance =
        edge === 'start'
          ? contentOffset.y
          : contentSize.height - layoutMeasurement.height - contentOffset.y;
      const near = distance < 200;
      nearEdge.current = near;
      setAtEdge((old) => (old === near ? old : near));
      if (near) setHasNewMessages(false);
    },
    [edge],
  );

  const jumpToLatest = useCallback(() => {
    nearEdge.current = true;
    setAtEdge(true);
    setHasNewMessages(false);
    scrollRef.current(true);
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (nearEdge.current) scrollRef.current(false);
  }, []);
  return { atEdge, hasNewMessages, onScroll, jumpToLatest, onContentSizeChange };
}
