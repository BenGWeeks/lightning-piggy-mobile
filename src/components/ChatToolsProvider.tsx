import React from 'react';
import { ChatSearchContext } from '../contexts/ChatSearchContext';
import { ChatMessageHighlightContext } from '../contexts/ChatMessageHighlightContext';
export function ChatToolsProvider({
  query,
  highlightedId,
  children,
}: {
  query: string;
  highlightedId: string | null;
  children: React.ReactNode;
}) {
  return (
    <ChatMessageHighlightContext.Provider value={highlightedId}>
      <ChatSearchContext.Provider value={query}>{children}</ChatSearchContext.Provider>
    </ChatMessageHighlightContext.Provider>
  );
}
