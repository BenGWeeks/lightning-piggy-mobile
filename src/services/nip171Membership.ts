import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';

// Per-account NIP-171 records kept outside the encrypted ticket table: none
// holds a secret. Each is one JSON blob per account; writes to a blob are
// serialised so concurrent updates (one per group) can't overwrite each other.

/**
 * What the user decided about a group. A group without a record is a pending
 * invitation. `at` is the newest ticket `created_at` the decision covers: a
 * later ticket for a declined or left group is a new invitation.
 */
export interface Nip171GroupStatus {
  status: 'accepted' | 'declined' | 'left';
  at: number;
}

export interface Nip171GroupMeta {
  name?: string;
  picture?: string;
  /** The group identity's kind-10050 DM relays: where its messages go. */
  relays?: string[];
}

function ownerJsonStore<T>(baseKey: string) {
  const chains = new Map<string, Promise<unknown>>();
  const read = async (owner: string): Promise<Record<string, T>> => {
    try {
      const raw = await AsyncStorage.getItem(perAccountKey(baseKey, owner));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
    } catch {
      return {};
    }
  };
  /** Read-modify-write, one at a time per account. Returns the new blob. */
  const update = (
    owner: string,
    change: (all: Record<string, T>) => void,
  ): Promise<Record<string, T>> => {
    const run = (chains.get(owner) ?? Promise.resolve()).then(async () => {
      const all = await read(owner);
      change(all);
      await AsyncStorage.setItem(perAccountKey(baseKey, owner), JSON.stringify(all)).catch(
        () => undefined,
      );
      return all;
    });
    chains.set(
      owner,
      run.catch(() => undefined),
    );
    return run;
  };
  const remove = (owner: string): Promise<void> => {
    const run = (chains.get(owner) ?? Promise.resolve()).then(() =>
      AsyncStorage.removeItem(perAccountKey(baseKey, owner)).catch(() => undefined),
    );
    chains.set(
      owner,
      run.catch(() => undefined),
    );
    return run;
  };
  return { read, update, remove };
}

export const nip171StatusStore = ownerJsonStore<Nip171GroupStatus>('nip171_group_status_v1');
export const nip171MetaStore = ownerJsonStore<Nip171GroupMeta>('nip171_group_meta_v1');
