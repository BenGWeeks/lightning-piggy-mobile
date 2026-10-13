import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getLockScreenContentEnabled,
  resetLockScreenContentPreference,
  setLockScreenContentEnabled,
} from './notificationContentPreference';

beforeEach(async () => {
  jest.restoreAllMocks();
  resetLockScreenContentPreference();
  await AsyncStorage.clear();
});

it('reports a failed user write and restores the confirmed cached preference', async () => {
  await setLockScreenContentEnabled(false);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(setLockScreenContentEnabled(true, true)).rejects.toThrow('Storage unavailable');
  expect(await getLockScreenContentEnabled()).toBe(false);
});

it('keeps best-effort writes for existing non-interactive callers', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(setLockScreenContentEnabled(true)).resolves.toBeUndefined();
  expect(await getLockScreenContentEnabled()).toBe(true);
});
