import AsyncStorage from '@react-native-async-storage/async-storage';
import * as cache from './zapSenderProfileStorage';
import { perAccountKey } from './perAccountStorage';
import { OWN_PROFILE_CACHE_KEY_BASE } from '../contexts/nostrCacheKeys';
import type { NostrProfile } from '../types/nostr';

/** Reuse resolved Messages peers and locally cached identity profiles as well as
 * the shared avatar cache. These public display fields need no relay request. */
export async function readOrderCounterpartyProfiles(owner: string, authors: string[]) {
  const profiles = await cache.getMany(authors);
  const keys = [
    `nonfollow_profiles_${owner}`,
    ...authors.map((pk) => perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, pk)),
  ];
  const entries = await AsyncStorage.multiGet(keys);
  const parse = (raw: string | null): unknown => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const peers = parse(entries[0]?.[1]) as Record<string, NostrProfile> | null;
  for (let i = 0; i < authors.length; i++) {
    const pk = authors[i];
    const own = parse(entries[i + 1]?.[1]) as NostrProfile | null;
    const p = own?.pubkey === pk ? own : peers?.[pk];
    if (!p || typeof p.npub !== 'string') continue;
    profiles.set(pk, {
      npub: p.npub,
      name: typeof p.name === 'string' ? p.name : null,
      displayName: typeof p.displayName === 'string' ? p.displayName : null,
      picture: typeof p.picture === 'string' ? p.picture : null,
      nip05: null,
    });
  }
  return profiles;
}
