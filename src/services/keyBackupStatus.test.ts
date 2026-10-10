import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearKeyBackedUp,
  isKeyBackedUp,
  keyBackedUpKey,
  markKeyBackedUp,
} from './keyBackupStatus';

const BIG = 'a'.repeat(64);
const MIDDLE = 'b'.repeat(64);

describe('keyBackupStatus', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is per account', async () => {
    expect(keyBackedUpKey(BIG)).toBe(`nostr_key_backed_up_${BIG}`);
    await markKeyBackedUp(BIG);
    expect(await isKeyBackedUp(BIG)).toBe(true);
    expect(await isKeyBackedUp(MIDDLE)).toBe(false);
  });

  it('defaults to not backed up, including with no account', async () => {
    expect(await isKeyBackedUp(BIG)).toBe(false);
    expect(await isKeyBackedUp(null)).toBe(false);
    expect(await isKeyBackedUp(undefined)).toBe(false);
  });

  it('clears the flag', async () => {
    await markKeyBackedUp(BIG);
    await clearKeyBackedUp(BIG);
    expect(await isKeyBackedUp(BIG)).toBe(false);
  });

  it('treats a storage read failure as not backed up', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    expect(await isKeyBackedUp(BIG)).toBe(false);
    spy.mockRestore();
  });
});
