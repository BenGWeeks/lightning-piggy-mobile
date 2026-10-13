import { useCallback, useEffect, useMemo, useState } from 'react';
import { searchMessages, type SearchableMessage } from '../utils/chatSearch';
export function useChatSearch(
  messages: readonly SearchableMessage[],
  jump: (id: string) => unknown,
) {
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => searchMessages(messages, query), [messages, query]);
  const selected = matches[Math.min(index, Math.max(0, matches.length - 1))];
  useEffect(() => {
    if (active && selected) jump(selected);
  }, [active, selected, jump]);
  const change = useCallback((value: string) => {
    setQuery(value);
    setIndex(0);
  }, []);
  const move = useCallback(
    (step: number) => setIndex((i) => Math.max(0, Math.min(matches.length - 1, i + step))),
    [matches.length],
  );
  const close = useCallback(() => {
    setActive(false);
    setQuery('');
    setIndex(0);
  }, []);
  const open = useCallback(() => setActive(true), []);
  return {
    active,
    query,
    index: Math.min(index, Math.max(0, matches.length - 1)),
    count: matches.length,
    change,
    move,
    close,
    open,
  };
}
