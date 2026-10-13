import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveSharedContactProfiles,
  SHARED_PROFILE_BATCH_SIZE,
  SHARED_PROFILE_TIMEOUT_MS,
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
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    mounted.current = true;
    const scheduledPubkeys = scheduled.current;
    const pendingTimers = timers.current;
    return () => {
      mounted.current = false;
      scheduledPubkeys.clear();
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
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
    if (refs.length === 0) return;
    // The deadline belongs to scheduling, including cards waiting for a batch.
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      timers.current.delete(timer);
      if (mounted.current) {
        setSharedProfiles((prev) => {
          const next = { ...prev };
          for (const ref of refs) {
            if (next[ref.pubkey] === undefined) next[ref.pubkey] = null;
          }
          return next;
        });
      }
    }, SHARED_PROFILE_TIMEOUT_MS);
    timers.current.add(timer);
    void (async () => {
      for (let i = 0; i < refs.length; i += SHARED_PROFILE_BATCH_SIZE) {
        if (!mounted.current || expired) return;
        const updates = await resolveSharedContactProfiles(
          refs.slice(i, i + SHARED_PROFILE_BATCH_SIZE),
        );
        if (mounted.current && !expired) setSharedProfiles((prev) => ({ ...prev, ...updates }));
      }
    })().finally(() => {
      clearTimeout(timer);
      timers.current.delete(timer);
    });
  }, [messages, known]);

  return useMemo(() => ({ ...sharedProfiles, ...known }), [sharedProfiles, known]);
}
