import { createContext } from 'react';
/** Briefly marks the message reached by a history/notification jump. */
export const ChatMessageHighlightContext = createContext<string | null>(null);
