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

function useSecureStore(entries: [string, string][]) {
  const store = new Map(entries);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (k) => store.get(k) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (k, v) => void store.set(k, v));
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (k) => void store.delete(k));
  return store;
}

it('leaves the legacy credential in place while no identity owns it', async () => {
  await AsyncStorage.clear();
  const store = useSecureStore([['nwc_connection_url', 'fixture-nwc']]);
  await migrateLegacy(null);
  expect(store.get('nwc_connection_url')).toBe('fixture-nwc');
  expect(await AsyncStorage.getItem('wallet_list')).toBeNull();
  await migrateLegacy('bob');
  const [wallet] = JSON.parse((await AsyncStorage.getItem('wallet_list_bob'))!);
  expect(store.get(`nwc_url_${wallet.id}`)).toBe('fixture-nwc');
  expect(store.has('nwc_connection_url')).toBe(false);
});

it('gives the legacy wallet to only the first of two identities published back to back', async () => {
  await AsyncStorage.clear();
  useSecureStore([['nwc_connection_url', 'fixture-nwc']]);
  await Promise.all([migrateLegacy('bob'), migrateLegacy('carol')]);
  expect(JSON.parse((await AsyncStorage.getItem('wallet_list_bob'))!)).toHaveLength(1);
  expect(await AsyncStorage.getItem('wallet_list_carol')).toBeNull();
});
