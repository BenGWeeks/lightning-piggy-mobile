import AsyncStorage from '@react-native-async-storage/async-storage';
import { wipeAccountCaches } from './accountCacheWipe';
import { perAccountKey } from '../services/perAccountStorage';
import {
  DM_INBOX_CREATED_AT_KEY_BASE,
  DM_INBOX_RELAYS_CACHE_KEY_BASE,
  RELAY_LIST_CREATED_AT_KEY_BASE,
} from './nostrCacheKeys';
import { NOTIFICATION_HISTORY_KEY_BASE } from '../services/notificationHistory';

const PK = 'a'.repeat(64);

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
