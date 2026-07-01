// Unit test for the per-wallet cache cleanup performed by removeWallet.
// `deleteWalletCaches` must remove exactly the walletId-keyed AsyncStorage
// blobs (balance / txs / seenReceipts) so a deleted wallet leaves no balance
// or transaction residue behind — and must not touch other wallets' caches.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteWalletCaches } from './walletStorageService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('deleteWalletCaches', () => {
  it('removes the balance / txs / seenReceipts blobs for the given wallet only', async () => {
    await AsyncStorage.setItem('balance_w1', '1234');
    await AsyncStorage.setItem('txs_w1', '[]');
    await AsyncStorage.setItem('seenReceipts_w1', '[]');
    // A second wallet's caches must survive.
    await AsyncStorage.setItem('balance_w2', '99');
    await AsyncStorage.setItem('txs_w2', '[]');

    await deleteWalletCaches('w1');

    expect(await AsyncStorage.getItem('balance_w1')).toBeNull();
    expect(await AsyncStorage.getItem('txs_w1')).toBeNull();
    expect(await AsyncStorage.getItem('seenReceipts_w1')).toBeNull();
    expect(await AsyncStorage.getItem('balance_w2')).toBe('99');
    expect(await AsyncStorage.getItem('txs_w2')).toBe('[]');
  });

  it('is a no-op when the wallet has no cached blobs', async () => {
    await expect(deleteWalletCaches('absent')).resolves.toBeUndefined();
  });

  it('falls back to per-key removeItem when the batch multiRemove fails', async () => {
    // A privacy helper must not silently leave residue when the batch throws.
    await AsyncStorage.setItem('balance_w1', '1234');
    await AsyncStorage.setItem('txs_w1', '[]');
    await AsyncStorage.setItem('seenReceipts_w1', '[]');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const multiRemove = jest
      .spyOn(AsyncStorage, 'multiRemove')
      .mockRejectedValueOnce(new Error('transient storage error'));

    await deleteWalletCaches('w1');

    // Despite the batch failure, every target blob is gone via the per-key path.
    expect(await AsyncStorage.getItem('balance_w1')).toBeNull();
    expect(await AsyncStorage.getItem('txs_w1')).toBeNull();
    expect(await AsyncStorage.getItem('seenReceipts_w1')).toBeNull();
    expect(warn).toHaveBeenCalled();

    multiRemove.mockRestore();
    warn.mockRestore();
  });
});
