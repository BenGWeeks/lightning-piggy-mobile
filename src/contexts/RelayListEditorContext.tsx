import React, { createContext, useContext } from 'react';
import { useRelayListEditor } from '../hooks/useRelayListEditor';

const Context = createContext<ReturnType<typeof useRelayListEditor> | null>(null);

/** Own one draft for the list and its details routes. */
export function RelayListEditorProvider({ children }: { children: React.ReactNode }) {
  const editor = useRelayListEditor();
  return <Context.Provider value={editor}>{children}</Context.Provider>;
}

export function useRelayListDraft() {
  const editor = useContext(Context);
  if (!editor) throw new Error('Relay list editor provider missing');
  return editor;
}
