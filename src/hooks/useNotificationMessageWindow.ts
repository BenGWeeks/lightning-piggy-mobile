import { useEffect, useMemo, useState } from 'react';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { DmProtocol } from '../utils/dmProtocol';
import { getConversationMessageWindow } from '../services/dmDb';
import { mapStoredRowsToMessages } from '../contexts/conversationReadThrough';

/** Retain the notification target, re-reading its local window on live message changes. */
export function useNotificationMessageWindow(
  owner: string | null,
  peer: string,
  protocol: DmProtocol,
  messageId: string | undefined,
  messages: ConversationMessageInput[],
) {
  const scope = `${owner}:${peer}:${protocol}`;
  const [window, setWindow] = useState<{
    scope: string;
    messageId: string;
    messages: ConversationMessageInput[];
  } | null>(null);
  const targetId = messageId ?? (window?.scope === scope ? window.messageId : undefined);
  useEffect(() => {
    if (!owner || !targetId) return;
    // The newest slice cannot tell us which older rows were deleted or edited.
    // Re-derive the bounded window from the authoritative store, including after
    // navigation consumes messageId; retain its target rather than stale rows.
    let cancelled = false;
    void getConversationMessageWindow(owner, peer, protocol, targetId)
      .then((rows) => {
        if (!cancelled)
          setWindow({ scope, messageId: targetId, messages: mapStoredRowsToMessages(rows) });
      })
      .catch(() => {}); // Missing/deleted/unavailable: keep the newest slice.
    return () => {
      cancelled = true;
    };
  }, [owner, peer, protocol, targetId, scope, messages]);
  return useMemo(() => {
    if (window?.scope !== scope || !window.messages.length) return messages;
    const merged = new Map(window.messages.map((m) => [m.id, m]));
    messages.forEach((m) => merged.set(m.id, m));
    return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [window, scope, messages]);
}
