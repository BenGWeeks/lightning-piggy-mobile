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
});
