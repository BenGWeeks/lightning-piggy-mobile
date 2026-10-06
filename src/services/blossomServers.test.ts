import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_BLOSSOM_SERVER,
  getBlossomServer,
  getBlossomServers,
  getSavedBlossomServers,
  setBlossomServer,
  setBlossomServers,
} from './walletStorageService';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('defaults to the single default server when nothing is saved', async () => {
  expect(await getSavedBlossomServers()).toBeNull();
  expect(await getBlossomServers()).toEqual([DEFAULT_BLOSSOM_SERVER]);
});

it('makes an existing single server the primary until a list is saved (#1149)', async () => {
  await setBlossomServer('https://my.server');
  expect(await getBlossomServers()).toEqual(['https://my.server']);
});

it('saves an ordered, de-duplicated list and keeps the legacy key on the primary', async () => {
  await setBlossomServers([' https://a.example ', 'https://b.example', 'https://a.example', '']);
  expect(await getBlossomServers()).toEqual(['https://a.example', 'https://b.example']);
  expect(await getBlossomServer()).toBe('https://a.example');
});
