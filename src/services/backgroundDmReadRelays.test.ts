import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveReadRelays } from './backgroundDmReadRelays';
import { getUserRelays } from './nostrRelayStorage';
import { perAccountKey } from './perAccountStorage';
import {
  DM_INBOX_RELAYS_CACHE_KEY_BASE,
  RELAY_LIST_CACHE_KEY_BASE,
} from '../contexts/nostrCacheKeys';

jest.mock('./nostrRelayStorage', () => ({
  getUserRelays: jest.fn(),
  mergeRelays: jest.requireActual('./nostrRelayStorage').mergeRelays,
}));
jest.mock('./nostrService', () => ({ DEFAULT_RELAYS: ['wss://default.example'] }));
const ME = 'a'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
  (getUserRelays as jest.Mock).mockResolvedValue([]);
});

it("watches the user's own DM inbox relays as well as their read relays", async () => {
  await AsyncStorage.setItem(
    perAccountKey(RELAY_LIST_CACHE_KEY_BASE, ME),
    JSON.stringify([{ url: 'wss://nip65-read.example', read: true, write: false }]),
  );
  await AsyncStorage.setItem(
    perAccountKey(DM_INBOX_RELAYS_CACHE_KEY_BASE, ME),
    JSON.stringify(['wss://inbox.example']),
  );
  expect(await resolveReadRelays(ME)).toEqual(
    expect.arrayContaining([
      'wss://default.example',
      'wss://nip65-read.example',
      'wss://inbox.example',
    ]),
  );
});

it('still resolves read relays when the inbox cache is missing or corrupt', async () => {
  await AsyncStorage.setItem(perAccountKey(DM_INBOX_RELAYS_CACHE_KEY_BASE, ME), '{not json');
  expect(await resolveReadRelays(ME)).toEqual(['wss://default.example']);
});
