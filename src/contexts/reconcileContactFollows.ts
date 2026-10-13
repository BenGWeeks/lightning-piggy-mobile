import {
  adoptFollowSnapshot,
  fetchFollowSnapshot,
  readFollowSnapshot,
} from '../services/contactFollowFreshness';
import { getUserRelays } from '../services/nostrRelayStorage';
import type { NostrContact } from '../types/nostr';

/** Cache paints immediately; readiness is published only with the reconciled list. */
export async function reconcileContactFollows(
  pubkey: string,
  relayUrls: string[],
  cached: NostrContact[] | null,
  paint: (contacts: NostrContact[]) => void,
  finish: (contacts: NostrContact[]) => void,
): Promise<NostrContact[]> {
  const snapshot = await readFollowSnapshot(pubkey);
  let contacts = snapshot?.contacts ?? cached ?? [];
  paint(contacts);
  const configured = await getUserRelays();
  const fresh = await fetchFollowSnapshot(pubkey, [
    ...relayUrls,
    ...configured.filter((r) => r.read).map((r) => r.url),
  ]);
  if (fresh) contacts = (await adoptFollowSnapshot(pubkey, fresh)).contacts;
  finish(contacts);
  return contacts;
}
