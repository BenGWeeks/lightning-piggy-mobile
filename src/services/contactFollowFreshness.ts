import { captureFollowSession, publishFollowSet } from './followSetEvents';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchLatestContactList } from './contactListSync';
import { PROFILE_RELAYS } from './nostrRelayDefaults';
import { perAccountKey } from './perAccountStorage';
import { sanitizeContacts, tagsToContacts } from '../utils/contacts';
import type { NostrContact } from '../types/nostr';

export const FOLLOW_SNAPSHOT_KEY = 'nostr_follow_snapshot_v1';
export interface FollowSnapshot {
  contacts: NostrContact[];
  createdAt: number;
  id?: string;
}

export function newestFollowSnapshot(
  current: FollowSnapshot | null,
  candidate: FollowSnapshot,
): FollowSnapshot {
  if (!current || candidate.createdAt > current.createdAt) return candidate;
  if (
    candidate.createdAt === current.createdAt &&
    candidate.id &&
    (!current.id || candidate.id < current.id)
  )
    return candidate;
  return current;
}

export async function readFollowSnapshot(pubkey: string): Promise<FollowSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(perAccountKey(FOLLOW_SNAPSHOT_KEY, pubkey));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as FollowSnapshot;
    if (!Number.isFinite(snapshot.createdAt)) return null;
    return { ...snapshot, contacts: sanitizeContacts(snapshot.contacts) };
  } catch {
    return null;
  }
}

// Serialize selection + disk writes, including local follow/unfollow publishes.
// A slower refresh must not clobber a newer list adopted in another request.
let writes: Promise<unknown> = Promise.resolve();
function serializeFollowWrite<T>(run: () => Promise<T>): Promise<T> {
  const next = writes.then(run, run);
  writes = next.catch(() => {});
  return next;
}

/** Failed reads repaint the latest cache without declaring relay hydration. */
export function resolveCachedFollowContacts(
  pubkey: string,
  cached: NostrContact[],
  paint: (contacts: NostrContact[]) => void,
): Promise<NostrContact[]> {
  return serializeFollowWrite(async () => {
    const contacts = (await readFollowSnapshot(pubkey))?.contacts ?? cached;
    paint(contacts);
    return contacts;
  });
}

export function adoptFollowSnapshot(
  pubkey: string,
  candidate: FollowSnapshot,
  onAdopt?: (contacts: NostrContact[]) => void,
  isCurrentSession = captureFollowSession(),
): Promise<FollowSnapshot> {
  const run = async () => {
    const best = newestFollowSnapshot(await readFollowSnapshot(pubkey), candidate);
    if (!isCurrentSession()) return best;
    await AsyncStorage.setItem(perAccountKey(FOLLOW_SNAPSHOT_KEY, pubkey), JSON.stringify(best));
    if (!isCurrentSession()) return best;
    publishFollowSet(pubkey, best.contacts, best.createdAt);
    onAdopt?.(best.contacts);
    return best;
  };
  return serializeFollowWrite(run);
}

/** Bounded per-relay reads; wait for all EOSEs (or the cap), including indexers. */
export async function fetchFollowSnapshot(
  pubkey: string,
  readRelays: string[],
): Promise<FollowSnapshot | null> {
  const result = await fetchLatestContactList(pubkey, [...readRelays, ...PROFILE_RELAYS], {
    includeParked: true,
  });
  if (result.status === 'failed') return null;
  if (result.status === 'empty') return { contacts: [], createdAt: 0 };
  return {
    contacts: tagsToContacts(result.base.tags),
    createdAt: result.base.createdAt,
    id: result.base.id,
  };
}
