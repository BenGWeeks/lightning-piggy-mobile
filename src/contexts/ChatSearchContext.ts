import { createContext } from 'react';
/** One query per visible conversation; memoised bubbles still update through context. */
export const ChatSearchContext = createContext('');
