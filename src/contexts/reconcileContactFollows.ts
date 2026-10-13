import {
  adoptFollowSnapshot,
  fetchFollowSnapshot,
  readFollowSnapshot,
  resolveCachedFollowContacts,
} from '../services/contactFollowFreshness';
import { captureFollowSession } from '../services/followSetEvents';
import { getUserRelays } from '../services/nostrRelayStorage';
import { perAccountKey } from '../services/perAccountStorage';
import { sanitizeContacts } from '../utils/contacts';
import {
  CONTACTS_CACHE_KEY_BASE,
  CONTACTS_TIMESTAMP_KEY_BASE,
  PROFILES_CACHE_KEY_BASE,
  CACHE_TIMESTAMP_KEY_BASE,
  readCachedWithTtl,
} from './nostrCacheKeys';
import type { NostrProfile, NostrContact } from '../types/nostr';

/** Cache paints immediately; readiness is published only with the reconciled list. */
export async function reconcileContactFollows(
  pubkey: string,
  relayUrls: string[],
  cached: NostrContact[] | null,
  paint: (contacts: NostrContact[]) => void,
  finish: (contacts: NostrContact[]) => void,
  isCurrentSession = captureFollowSession(),
): Promise<NostrContact[]> {
  const paintCurrent = (next: NostrContact[]) => {
    if (isCurrentSession()) paint(next);
  };
  const snapshot = await readFollowSnapshot(pubkey);
  const contacts = snapshot?.contacts ?? cached ?? [];
  paintCurrent(contacts);
  const configured = await getUserRelays();
  const fresh = await fetchFollowSnapshot(pubkey, [
    ...relayUrls,
    ...configured.filter((r) => r.read).map((r) => r.url),
  ]);
  if (fresh) return (await adoptFollowSnapshot(pubkey, fresh, finish, isCurrentSession)).contacts;
  return resolveCachedFollowContacts(pubkey, contacts, paintCurrent);
}

/** Capture the account session before either cache read can pause the load. */
export async function reconcileCachedContactFollows(
  pubkey: string,
  relayUrls: string[],
  paint: (contacts: NostrContact[]) => void,
  finish: (contacts: NostrContact[]) => void,
) {
  const isCurrentSession = captureFollowSession();
  // The contact and profile caches are independent storage round-trips.
  const [{ value: cachedContactsRaw }, { value: cachedProfiles, ageMs: cacheAgeMs }] =
    await Promise.all([
      readCachedWithTtl<NostrContact[]>(
        perAccountKey(CONTACTS_CACHE_KEY_BASE, pubkey),
        perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, pubkey),
      ),
      readCachedWithTtl<Record<string, NostrProfile>>(
        perAccountKey(PROFILES_CACHE_KEY_BASE, pubkey),
        perAccountKey(CACHE_TIMESTAMP_KEY_BASE, pubkey),
      ),
    ]);
  const cachedProfileMap = cachedProfiles ?? {};
  const withCachedProfiles = (cs: NostrContact[]): NostrContact[] =>
    cs.map((c) => ({ ...c, profile: cachedProfileMap[c.pubkey] ?? c.profile }));
  const fetchedContacts = isCurrentSession()
    ? await reconcileContactFollows(
        pubkey,
        relayUrls,
        cachedContactsRaw ? sanitizeContacts(cachedContactsRaw) : null,
        (cs) => paint(withCachedProfiles(cs)),
        (cs) => finish(withCachedProfiles(cs)),
        isCurrentSession,
      )
    : [];
  return { fetchedContacts, cachedProfileMap, cacheAgeMs };
}
