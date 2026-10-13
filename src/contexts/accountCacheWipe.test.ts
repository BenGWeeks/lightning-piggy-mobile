import { initialiseNotificationDefaults } from '../services/notificationDefaults';
import * as marmotPush from '../services/marmotPushRegistration';
import { setActivePubkeyForWalletStorage } from '../services/walletStorageService';
import { loadWatcherState } from '../services/watcherPushStore';
import { wipeRemoteMediaForOwner } from '../services/remoteMediaCache';
import {
  readMarketPreferences,
  writeMarketPreferences,
  writeMarketSnapshot,
  getMarketSnapshot,
  readMarketSnapshot,
  MARKET_CACHE_KEY,
} from '../services/marketStorage';
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
import {
  appendGroupMessage,
  loadGroupMessages,
  reviveGroupHistoryOwner,
} from '../services/groupMessagesStorageService';
import { resetGroupMessagesMigrationForTests } from '../services/groupMessagesMigration';
import { groupMessagesKey, legacyGroupMessagesKey } from '../services/groupMessagesKeys';
import { wipeDecryptedMediaForOwner } from '../services/decryptedMediaCache';

jest.mock('../services/notificationService', () => ({
  ...jest.requireActual('../services/notificationService'),
  requestNotificationPermission: jest.fn(async () => true),
}));

jest.mock('../services/watcherPush', () => ({ scheduleWatcherReconciliation: jest.fn() }));

jest.mock('../services/remoteMediaCache', () => ({
  wipeRemoteMediaForOwner: jest.fn(async () => {}),
}));

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
  expect(wipeRemoteMediaForOwner).toHaveBeenCalledWith(PK);
});

// #1240: a family shares one phone — signing out the child's account must
// leave the parent's group chats (Marmot history can't be re-fetched).
it("wipes only the signed-out account's group history, migrating legacy blobs first", async () => {
  resetGroupMessagesMigrationForTests();
  const row = (id: string, text: string) => ({ id, senderPubkey: PK, text, createdAt: 1 });
  // A not-yet-migrated device-wide blob for a group BOTH accounts are in.
  await AsyncStorage.setItem(
    legacyGroupMessagesKey('g_family'),
    JSON.stringify([row('m1', 'shared before upgrade')]),
  );
  await AsyncStorage.setItem(`nostr_groups_${PK}`, JSON.stringify([{ id: 'g_family' }]));
  await AsyncStorage.setItem(`nostr_groups_${OTHER_PK}`, JSON.stringify([{ id: 'g_family' }]));

  await wipeAccountCaches(PK);

  expect(await AsyncStorage.getItem(groupMessagesKey(PK, 'g_family'))).toBeNull();
  expect((await loadGroupMessages(OTHER_PK, 'g_family')).map((m) => m.text)).toEqual([
    'shared before upgrade',
  ]);
  expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_family'))).toBeNull();

  // And after migration: the other account's own logs survive a later wipe.
  reviveGroupHistoryOwner(PK); // PK signs back in
  await appendGroupMessage(PK, 'g_kids', row('m2', 'child'));
  await appendGroupMessage(OTHER_PK, 'g_kids', row('m3', 'parent'));
  await wipeAccountCaches(PK);
  expect(await loadGroupMessages(PK, 'g_kids')).toEqual([]);
  expect((await loadGroupMessages(OTHER_PK, 'g_kids')).map((m) => m.text)).toEqual(['parent']);
});

it('wipes market filters and every follow scope only for the signed-out account', async () => {
  await readMarketPreferences(PK); // Account signs back in after earlier wipe tests.
  const preferences = {
    mode: 'wotFriends' as const,
    merchant: 'Seller',
    country: 'DE',
    currency: 'EUR',
  };
  await writeMarketPreferences(PK, preferences);
  await writeMarketPreferences(OTHER_PK, preferences);
  await writeMarketSnapshot(`${PK}|follows-one`, { products: [], incomplete: false });
  await writeMarketSnapshot(`${PK}|follows-two`, { products: [], incomplete: false });
  await writeMarketSnapshot(`${OTHER_PK}|follows`, { products: [], incomplete: false });
  await wipeAccountCaches(PK);
  expect(await AsyncStorage.getItem(perAccountKey('market_filters_v1', PK))).toBeNull();
  expect(await AsyncStorage.getItem(perAccountKey('market_filters_v1', OTHER_PK))).not.toBeNull();
  expect(getMarketSnapshot(`${PK}|follows-one`)).toBeUndefined();
  expect(getMarketSnapshot(`${PK}|follows-two`)).toBeUndefined();
  expect(await readMarketSnapshot(`${PK}|follows-one`)).toBeUndefined();
  expect(getMarketSnapshot(`${OTHER_PK}|follows`)).toBeDefined();
  expect(JSON.parse((await AsyncStorage.getItem(MARKET_CACHE_KEY))!)).toHaveLength(1);
});

it('wipes retry and exhausted kind-4 metadata only for the signed-out account', async () => {
  const keys = [`dm-kind4-retries:${PK}`, `dm-kind4-exhausted:${PK}`];
  const otherKeys = [`dm-kind4-retries:${OTHER_PK}`, `dm-kind4-exhausted:${OTHER_PK}`];
  await AsyncStorage.multiSet([...keys, ...otherKeys].map((key) => [key, '[]']));
  await wipeAccountCaches(PK);
  expect(await AsyncStorage.multiGet(keys)).toEqual(keys.map((key) => [key, null]));
  expect(await AsyncStorage.multiGet(otherKeys)).toEqual(otherKeys.map((key) => [key, '[]']));
});

it.each([PK, 'c'.repeat(64)])(
  'removes notification decision markers so %s can initialise',
  async (nextAccount) => {
    await AsyncStorage.clear();
    marmotPush.__resetMarmotPushForTests();
    const marker = (pk: string) => `notification_preference_explicit_v1_${pk}`;
    await AsyncStorage.multiSet([
      [marker(PK), '1'],
      [marker(OTHER_PK), '0'],
    ]);
    await wipeAccountCaches(PK);
    expect(await AsyncStorage.getItem(marker(PK))).toBeNull();
    expect(await AsyncStorage.getItem(marker(OTHER_PK))).toBe('0');
    await wipeAccountCaches(OTHER_PK);
    const enable = jest
      .spyOn(marmotPush, 'enableMarmotPush')
      .mockResolvedValue({ status: 'enabled', sync: null });
    try {
      // Cover both re-login and a new identity after all earlier accounts were removed.
      setActivePubkeyForWalletStorage(nextAccount);
      await initialiseNotificationDefaults(nextAccount);
      expect((await loadWatcherState(nextAccount)).categories.dm).toBe(true);
      expect(enable).toHaveBeenCalledWith(nextAccount, {
        interactive: false,
        stillActive: expect.any(Function),
      });
    } finally {
      enable.mockRestore();
    }
  },
);

it.each(['watcher', 'push-off', 'decision'])(
  'drains cancelled defaults during %s persistence before wiping the account',
  async (stage) => {
    await AsyncStorage.clear();
    marmotPush.__resetMarmotPushForTests();
    const pushKey = `marmot_push_enabled_v1_${PK}`;
    const watcherKey = `watcher_push_v1_${PK}`;
    const decisionKey = `notification_preference_explicit_v1_${PK}`;
    await AsyncStorage.setItem(`marmot_push_enabled_v1_${OTHER_PK}`, '0');
    const pausedKey = { watcher: watcherKey, 'push-off': pushKey, decision: decisionKey }[stage];
    let started!: () => void;
    let release!: () => void;
    const persisting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation()!;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === pausedKey) {
        started();
        await resume;
      }
      return original(key, value);
    });
    try {
      setActivePubkeyForWalletStorage(PK);
      const setup = initialiseNotificationDefaults(PK);
      await persisting;
      // Sign-out wipes while PK is still the live identity: the wipe itself
      // must abort the task — nothing else will before the keys are deleted.
      let wiped = false;
      const wipe = wipeAccountCaches(PK).then(() => {
        wiped = true;
      });
      // Give cleanup a full event-loop turn while the native write is paused.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const wipedBeforePersistence = wiped;
      // Cleanup must not delete preferences until the pending native write lands.
      release();
      await Promise.all([setup, wipe]);
      expect(wipedBeforePersistence).toBe(false);
      expect(await AsyncStorage.multiGet([pushKey, watcherKey, decisionKey])).toEqual([
        [pushKey, null],
        [watcherKey, null],
        [decisionKey, null],
      ]);
      expect(await AsyncStorage.getItem(`marmot_push_enabled_v1_${OTHER_PK}`)).toBe('0');
      setItem.mockImplementation(original);
      await initialiseNotificationDefaults(PK);
      expect(await AsyncStorage.getItem(decisionKey)).not.toBeNull();
      expect(await AsyncStorage.getItem(watcherKey)).not.toBeNull();
    } finally {
      setItem.mockImplementation(original);
    }
  },
);
