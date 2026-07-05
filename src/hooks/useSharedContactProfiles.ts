import { useEffect, useRef, useState } from 'react';
import { fetchProfile, DEFAULT_RELAYS } from '../services/nostrService';
import { extractSharedContact } from '../utils/messageContent';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { NostrProfile } from '../types/nostr';

/**
 * Resolves the Nostr kind-0 profiles for `nostr:` contact references the other
 * party has shared in a conversation, so shared-contact cards can render a
 * name/avatar instead of a bare pubkey. Extracted from ConversationScreen
 * (#431) to keep that screen under the file-size cap and give the fetch its own
 * testable seam.
 *
 * Behaviour preserved verbatim from the inline effect:
 *  - Batches all newly-seen shared pubkeys per `messages` update and fetches
 *    their kind-0 in parallel.
 *  - Merges any relay hints carried in the nprofile with {@link DEFAULT_RELAYS}
 *    so a person publishing on niche relays is still found.
 *  - Tracks already-scheduled pubkeys in a ref so the effect can depend on
 *    `[messages]` alone — writing `sharedProfiles` never re-triggers the fetch.
 *  - A `null` value means the lookup ran and came back empty.
 */
export function useSharedContactProfiles(
  messages: ConversationMessageInput[],
): Record<string, NostrProfile | null> {
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, NostrProfile | null>>({});
  const scheduledProfilePubkeys = useRef(new Set<string>());

  useEffect(() => {
    const byPubkey = new Map<string, Set<string>>();
    for (const m of messages) {
      const ref = extractSharedContact(m.text);
      if (!ref) continue;
      if (scheduledProfilePubkeys.current.has(ref.pubkey)) continue;
      const set = byPubkey.get(ref.pubkey) ?? new Set<string>();
      for (const r of ref.relays) set.add(r);
      byPubkey.set(ref.pubkey, set);
    }
    if (byPubkey.size === 0) return;
    // Mark all found pubkeys as scheduled before the async work starts so
    // a second messages-update doesn't re-queue the same fetches.
    for (const pk of byPubkey.keys()) scheduledProfilePubkeys.current.add(pk);
    let cancelled = false;
    (async () => {
      const updates: Record<string, NostrProfile | null> = {};
      await Promise.all(
        [...byPubkey.entries()].map(async ([pk, relaySet]) => {
          const mergedRelays = [...new Set([...DEFAULT_RELAYS, ...relaySet])];
          try {
            updates[pk] = await fetchProfile(pk, mergedRelays);
          } catch {
            updates[pk] = null;
          }
        }),
      );
      if (!cancelled) {
        setSharedProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);

  return sharedProfiles;
}
