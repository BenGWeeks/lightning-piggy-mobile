import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadNativeCryptoEnabled,
  saveNativeCryptoEnabled,
  __resetForTests,
} from './nativeCryptoPreference';

const KEY = 'native_crypto_enabled_v1';

beforeEach(async () => {
  __resetForTests();
  await AsyncStorage.clear();
});

describe('nativeCryptoPreference', () => {
  it('defaults to false when unset', async () => {
    expect(await loadNativeCryptoEnabled()).toBe(false);
  });

  it('persists and reads back true', async () => {
    await saveNativeCryptoEnabled(true);
    expect(await AsyncStorage.getItem(KEY)).toBe('true');
    __resetForTests();
    expect(await loadNativeCryptoEnabled()).toBe(true);
  });

  it('persists and reads back false', async () => {
    await saveNativeCryptoEnabled(true);
    await saveNativeCryptoEnabled(false);
    __resetForTests();
    expect(await loadNativeCryptoEnabled()).toBe(false);
  });

  it('serves the in-memory cache without re-reading storage', async () => {
    await saveNativeCryptoEnabled(true);
    // Corrupt storage behind the cache — cached value should still win.
    await AsyncStorage.setItem(KEY, 'false');
    expect(await loadNativeCryptoEnabled()).toBe(true);
  });
});
