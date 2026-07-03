import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadBackgroundDmEnabled,
  setBackgroundDmEnabled,
  __resetForTests,
} from './backgroundDmPreference';

const KEY = 'bg_dm_watch_enabled_v1';

beforeEach(async () => {
  __resetForTests();
  await AsyncStorage.clear();
});

describe('backgroundDmPreference', () => {
  it('defaults to false when unset', async () => {
    expect(await loadBackgroundDmEnabled()).toBe(false);
  });

  it('persists and reads back true', async () => {
    await setBackgroundDmEnabled(true);
    expect(await AsyncStorage.getItem(KEY)).toBe('true');
    __resetForTests();
    expect(await loadBackgroundDmEnabled()).toBe(true);
  });

  it('persists and reads back false', async () => {
    await setBackgroundDmEnabled(true);
    await setBackgroundDmEnabled(false);
    __resetForTests();
    expect(await loadBackgroundDmEnabled()).toBe(false);
  });

  it('serves the in-memory cache without re-reading storage', async () => {
    await setBackgroundDmEnabled(true);
    // Corrupt storage behind the cache — cached value should still win.
    await AsyncStorage.setItem(KEY, 'false');
    expect(await loadBackgroundDmEnabled()).toBe(true);
  });
});
