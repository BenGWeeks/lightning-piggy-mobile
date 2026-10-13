import { useCallback, useEffect, useMemo } from 'react';
import { useAccountState } from '../contexts/useAccountState';
import { loadChatClearBoundary, saveChatClearBoundary } from '../services/chatLocalHistory';
import type { SearchableMessage } from '../utils/chatSearch';
export function useChatLocalHistory<T extends SearchableMessage>(
  owner: string | null,
  thread: string,
  raw: T[],
) {
  const scope = owner ? `${owner}:${thread}` : null;
  const [boundary, setBoundary] = useAccountState<number | null>(scope, null);
  useEffect(() => {
    let cancelled = false;
    if (owner)
      void loadChatClearBoundary(owner, thread)
        .then((value) => {
          if (!cancelled) setBoundary(value);
        })
        .catch(() => {
          if (!cancelled) setBoundary(0);
        });
    return () => {
      cancelled = true;
    };
  }, [owner, thread, setBoundary]);
  const messages = useMemo(
    () => (boundary === null ? [] : raw.filter((m) => m.createdAt > boundary)),
    [raw, boundary],
  );
  const clear = useCallback(async () => {
    if (!owner) return;
    const next = Math.max(Math.floor(Date.now() / 1000), ...raw.map((m) => m.createdAt));
    await saveChatClearBoundary(owner, thread, next);
    setBoundary(next);
  }, [owner, thread, raw, setBoundary]);
  return { messages, clear, clearBoundary: boundary ?? Infinity };
}
