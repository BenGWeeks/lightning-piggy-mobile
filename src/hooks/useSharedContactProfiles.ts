import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveSharedContactProfiles,
  SHARED_PROFILE_BATCH_SIZE,
} from '../services/sharedContactProfiles';
import { extractSharedContact } from '../utils/messageContent';
import type { NostrContact, NostrProfile } from '../types/nostr';

const EMPTY_CONTACTS: readonly NostrContact[] = [];

/** Shared by NIP-17 and Marmot, including our optimistic sent messages.
 * Pending requests belong to the mount, not a messages-array revision: send
 * reconciliation must not discard a result whose pubkey is already scheduled.
 * One state update per bounded batch; known friends need no relay round trip. */
export function useSharedContactProfiles(
  messages: readonly { text: string }[],
  contacts: readonly NostrContact[] = EMPTY_CONTACTS,
): Record<string, NostrProfile | null> {
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, NostrProfile | null>>({});
  const scheduled = useRef(new Set<string>());
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const scheduledPubkeys = scheduled.current;
    return () => {
      mounted.current = false;
      scheduledPubkeys.clear();
    };
  }, []);

  const known = useMemo(() => {
    const profiles: Record<string, NostrProfile> = {};
    for (const contact of contacts) {
      if (contact.profile) profiles[contact.pubkey] = contact.profile;
    }
    return profiles;
  }, [contacts]);

  useEffect(() => {
    const byPubkey = new Map<string, Set<string>>();
    for (const message of messages) {
      const ref = extractSharedContact(message.text);
      if (!ref || known[ref.pubkey] || scheduled.current.has(ref.pubkey)) continue;
      const relays = byPubkey.get(ref.pubkey) ?? new Set<string>();
      for (const relay of ref.relays) relays.add(relay);
      byPubkey.set(ref.pubkey, relays);
    }
    const refs = [...byPubkey].map(([pubkey, relays]) => ({ pubkey, relays: [...relays] }));
    for (const ref of refs) scheduled.current.add(ref.pubkey);
    void (async () => {
      for (let i = 0; i < refs.length; i += SHARED_PROFILE_BATCH_SIZE) {
        if (!mounted.current) return;
        const updates = await resolveSharedContactProfiles(
          refs.slice(i, i + SHARED_PROFILE_BATCH_SIZE),
        );
        if (mounted.current) setSharedProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
  }, [messages, known]);

  return useMemo(() => ({ ...sharedProfiles, ...known }), [sharedProfiles, known]);
}
