import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { migrateLegacy, setActivePubkeyForWalletStorage } from './walletStorageService';
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
it('does not migrate a legacy wallet into an identity selected during the read', async () => {
  await AsyncStorage.clear();
  const bobWallets = [{ id: 'bob-wallet', walletType: 'nwc', lightningAddress: null }];
  await AsyncStorage.setItem('wallet_list_bob', JSON.stringify(bobWallets));
  setActivePubkeyForWalletStorage('alice');
  jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(async () => {
    setActivePubkeyForWalletStorage('bob');
    return 'fixture-nwc';
  });
  await migrateLegacy();
  expect(JSON.parse((await AsyncStorage.getItem('wallet_list_bob'))!)).toEqual(bobWallets);
  expect(JSON.parse((await AsyncStorage.getItem('wallet_list_alice'))!)).toHaveLength(1);
  setActivePubkeyForWalletStorage(null);
});
