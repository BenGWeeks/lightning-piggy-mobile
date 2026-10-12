import { useMemo } from 'react';
import { useNostrContacts } from '../contexts/NostrContext';
import { buildFollowedSet } from '../utils/mediaTrust';

/**
 * Memoised, lower-cased set of the pubkeys the active account follows.
 * Rebuilt only when the contact list changes, so list rows that derive a
 * boolean from it keep stable props (#1338 trust gating).
 */
export function useFollowedPubkeys(): ReadonlySet<string> {
  const { contacts } = useNostrContacts();
  return useMemo(() => buildFollowedSet(contacts), [contacts]);
}
