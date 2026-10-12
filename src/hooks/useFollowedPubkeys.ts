import { useMemo } from 'react';
import { useNostrContacts } from '../contexts/NostrContext';
import { buildFollowedSet, canAutoLoadMedia } from '../utils/mediaTrust';
import { useActivePubkey } from './useActivePubkey';

/**
 * Memoised, lower-cased set of the pubkeys the active account follows.
 * Rebuilt only when the contact list changes, so list rows that derive a
 * boolean from it keep stable props (#1338 trust gating).
 */
export function useFollowedPubkeys(): ReadonlySet<string> {
  const { contacts } = useNostrContacts();
  return useMemo(() => buildFollowedSet(contacts), [contacts]);
}

/**
 * May media by `authorPubkey` (a profile's bio / posts, an embedded event)
 * load without a tap? True for me and for people I follow (#1338). An
 * unknown author fails closed.
 */
export function useIsTrustedAuthor(authorPubkey: string | null | undefined): boolean {
  const me = useActivePubkey();
  const followed = useFollowedPubkeys();
  const isMe = !!me && !!authorPubkey && me.toLowerCase() === authorPubkey.toLowerCase();
  return canAutoLoadMedia(isMe, authorPubkey, followed);
}
