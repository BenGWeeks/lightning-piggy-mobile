import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MarmotDeletion } from './marmotDeletions';

// One immutable key per authorization. No read/modify/write race, no eviction,
// and no message bodies. The session ledger is only a bounded fast-path cache.
const key = (scope: string, id: string, author: string) =>
  `marmot_deleted:${scope}:${id.toLowerCase()}:${author.toLowerCase()}`;

export async function rememberMarmotDeletions(
  scope: string,
  deletions: readonly MarmotDeletion[],
): Promise<void> {
  const keys = new Set<string>();
  for (const deletion of deletions) {
    for (const id of deletion.targets) {
      keys.add(key(scope, id, deletion.anyAuthor ? '*' : deletion.deleter));
    }
  }
  if (keys.size) await AsyncStorage.multiSet([...keys].map((k) => [k, '1']));
}

export async function isMarmotDeleted(scope: string, id: string, sender: string): Promise<boolean> {
  const values = await AsyncStorage.multiGet([key(scope, id, '*'), key(scope, id, sender)]);
  return values.some(([, value]) => value === '1');
}
