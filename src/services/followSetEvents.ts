import type { NostrContact } from '../types/nostr';

// The adopted list is authoritative for live delivery before React commits
// the contact-list transition. No cache paints or profile updates emit here.
type Listener = (contacts: NostrContact[]) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeFollowSet(owner: string, listener: Listener): () => void {
  const owned = listeners.get(owner) ?? new Set<Listener>();
  owned.add(listener);
  listeners.set(owner, owned);
  return () => {
    owned.delete(listener);
    if (owned.size === 0) listeners.delete(owner);
  };
}

export function publishFollowSet(owner: string, contacts: NostrContact[]): void {
  for (const listener of listeners.get(owner) ?? []) listener(contacts);
}
