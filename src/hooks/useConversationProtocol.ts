import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_DM_PROTOCOL, latestThreadProtocol, type DmProtocol } from '../utils/dmProtocol';

export function useConversationProtocol(
  conversationId: string,
  routeProtocol: DmProtocol | undefined,
  messages: readonly { createdAt: number; wireKind?: number }[],
) {
  const [choice, setChoice] = useState<{ conversationId: string; protocol: DmProtocol }>();
  const threadProtocol = useMemo(() => latestThreadProtocol(messages), [messages]);
  const setProtocol = useCallback(
    (protocol: DmProtocol) => {
      setChoice({ conversationId, protocol });
    },
    [conversationId],
  );
  const protocol =
    (choice?.conversationId === conversationId ? choice.protocol : undefined) ??
    routeProtocol ??
    threadProtocol ??
    DEFAULT_DM_PROTOCOL;
  return { protocol, setProtocol };
}
