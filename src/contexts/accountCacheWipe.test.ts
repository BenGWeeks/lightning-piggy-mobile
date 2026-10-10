import AsyncStorage from '@react-native-async-storage/async-storage';
import { wipeAccountCaches } from './accountCacheWipe';
import { perAccountKey } from '../services/perAccountStorage';
import {
  DM_INBOX_CREATED_AT_KEY_BASE,
  DM_INBOX_RELAYS_CACHE_KEY_BASE,
  RELAY_LIST_CREATED_AT_KEY_BASE,
} from './nostrCacheKeys';
import { NOTIFICATION_HISTORY_KEY_BASE } from '../services/notificationHistory';
import { isKeyBackedUp, markKeyBackedUp } from '../services/keyBackupStatus';
import { appendGroupMessage, loadGroupMessages } from '../services/groupMessagesStorageService';
import { resetGroupMessagesMigrationForTests } from '../services/groupMessagesMigration';
import { groupMessagesKey, legacyGroupMessagesKey } from '../services/groupMessagesKeys';
import { wipeDecryptedMediaForOwner } from '../services/decryptedMediaCache';

jest.mock('../services/decryptedMediaCache', () => ({
  wipeDecryptedMediaForOwner: jest.fn(async () => {}),
}));

const PK = 'a'.repeat(64);
const OTHER_PK = 'b'.repeat(64);

it("removes the signed-out account's relay-list caches and baselines", async () => {
  const keys = [
    DM_INBOX_RELAYS_CACHE_KEY_BASE,
    DM_INBOX_CREATED_AT_KEY_BASE,
    RELAY_LIST_CREATED_AT_KEY_BASE,
    NOTIFICATION_HISTORY_KEY_BASE,
  ].map((base) => perAccountKey(base, PK));
  await AsyncStorage.multiSet(keys.map((k) => [k, '1']));
  await wipeAccountCaches(PK);
  const left = await AsyncStorage.multiGet(keys);
  expect(left.map(([, v]) => v)).toEqual([null, null, null, null]);
});

it("drops the signed-out account's key-backup flag but keeps other accounts' (#1223)", async () => {
  const other = 'b'.repeat(64);
  await markKeyBackedUp(PK);
  await markKeyBackedUp(other);
  await wipeAccountCaches(PK);
  expect(await isKeyBackedUp(PK)).toBe(false);
  expect(await isKeyBackedUp(other)).toBe(true);
});

it("deletes the signed-out account's decrypted voice notes and photos (#1241)", async () => {
  await wipeAccountCaches(PK);
  expect(wipeDecryptedMediaForOwner).toHaveBeenCalledWith(PK);
});

// #1240: a family shares one phone — signing out the child's account must
// leave the parent's group chats (Marmot history can't be re-fetched).
it("wipes only the signed-out account's group history, migrating legacy blobs first", async () => {
  resetGroupMessagesMigrationForTests();
  const row = (id: string, text: string) => ({ id, senderPubkey: PK, text, createdAt: 1 });
  // A not-yet-migrated device-wide blob for a group BOTH accounts are in.
  await AsyncStorage.setItem(
    legacyGroupMessagesKey('s_family'),
    JSON.stringify([row('m1', 'shared before upgrade')]),
  );
  await AsyncStorage.setItem(`nostr_groups_${PK}`, JSON.stringify([{ id: 's_family' }]));
  await AsyncStorage.setItem(`nostr_groups_${OTHER_PK}`, JSON.stringify([{ id: 's_family' }]));

  await wipeAccountCaches(PK);

  expect(await AsyncStorage.getItem(groupMessagesKey(PK, 's_family'))).toBeNull();
  expect((await loadGroupMessages(OTHER_PK, 's_family')).map((m) => m.text)).toEqual([
    'shared before upgrade',
  ]);
  expect(await AsyncStorage.getItem(legacyGroupMessagesKey('s_family'))).toBeNull();

  // And after migration: the other account's own logs survive a later wipe.
  await appendGroupMessage(PK, 'g_kids', row('m2', 'child'));
  await appendGroupMessage(OTHER_PK, 'g_kids', row('m3', 'parent'));
  await wipeAccountCaches(PK);
  expect(await loadGroupMessages(PK, 'g_kids')).toEqual([]);
  expect((await loadGroupMessages(OTHER_PK, 'g_kids')).map((m) => m.text)).toEqual(['parent']);
});
