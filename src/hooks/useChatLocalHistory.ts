import { useCallback, useEffect, useMemo } from 'react';
import { useAccountState } from '../contexts/useAccountState';
import {
  loadChatClearBoundary,
  saveChatClearBoundary,
  type ChatClearBoundary,
} from '../services/chatLocalHistory';
import type { SearchableMessage } from '../utils/chatSearch';
const aliases = (m: Pick<SearchableMessage, 'id' | 'rumorId' | 'localId'>) =>
  [m.id, m.rumorId, m.localId].filter((id): id is string => !!id);

export function useChatLocalHistory<T extends SearchableMessage>(
  owner: string | null,
  thread: string,
  raw: T[],
) {
  const scope = owner ? `${owner}:${thread}` : null;
  const [boundary, setBoundary] = useAccountState<ChatClearBoundary | null>(scope, null);
  useEffect(() => {
    let cancelled = false;
    if (owner)
      void loadChatClearBoundary(owner, thread)
        .then((value) => {
          if (!cancelled) setBoundary(value);
        })
        .catch(() => {
          if (!cancelled) setBoundary({ at: 0, hidden: [] });
        });
    return () => {
      cancelled = true;
    };
  }, [owner, thread, setBoundary]);
  const messages = useMemo(() => {
    if (boundary === null) return [];
    const hidden = new Set(boundary.hidden.map((m) => m.id));
    return raw.filter(
      (m) => m.createdAt >= boundary.at && !aliases(m).some((id) => hidden.has(id)),
    );
  }, [raw, boundary]);
  const clear = useCallback(async () => {
    if (!owner) return;
    const at = Math.floor(Date.now() / 1000);
    const hidden = new Map(
      [...(boundary?.hidden ?? []), ...raw]
        .filter((m) => m.createdAt >= at)
        .flatMap((m) => aliases(m).map((id) => [id, { id, createdAt: m.createdAt }] as const)),
    );
    const next = { at, hidden: [...hidden.values()] };
    await saveChatClearBoundary(owner, thread, next);
    setBoundary(next);
  }, [owner, thread, raw, boundary, setBoundary]);
  return { messages, clear, clearBoundary: boundary?.at ?? Infinity };
}
