import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { migrateLegacyOnchainWallets } from './migrateLegacyOnchainWallets';
import { getWalletList, saveWalletList } from './walletStorageService';
import { isSendableWallet } from '../utils/walletCapabilities';
import { getTransferSourceWallets } from '../utils/transferSourceWallets';
import type { WalletMetadata, WalletState } from '../types/wallet';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(),
}));
const owner = 'legacy-onchain';
const current = () => true;
function wallet(
  id: string,
  onchainImportMethod?: WalletMetadata['onchainImportMethod'],
): WalletMetadata {
  return {
    id,
    onchainImportMethod,
    alias: id,
    theme: 'lightning-piggy',
    order: 0,
    walletType: 'onchain',
    lightningAddress: null,
  };
}
function state(metadata: WalletMetadata): WalletState {
  return { ...metadata, isConnected: false, balance: 100, walletAlias: null, transactions: [] };
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(SecureStore.getItemAsync).mockReset().mockResolvedValue(null);
});

it('classifies stored signing material and makes a legacy seed wallet a Move source', async () => {
  await saveWalletList([wallet('seed'), wallet('watch')], owner);
  // Existence only, including a non-null empty value: never parse a secret.
  jest
    .mocked(SecureStore.getItemAsync)
    .mockImplementation(async (key) => (key === 'onchain_mnemonic_seed' ? '' : null));
  await migrateLegacyOnchainWallets(owner, current);
  const wallets = (await getWalletList(owner)).map(state);
  expect(wallets.map((w) => w.onchainImportMethod)).toEqual(['mnemonic', 'xpub']);
  expect(isSendableWallet(wallets[0])).toBe(true);
  expect(isSendableWallet(wallets[1])).toBe(false);
  expect(getTransferSourceWallets(wallets).map((w) => w.id)).toEqual(['seed']);
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith('onchain_mnemonic_seed');
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith('onchain_mnemonic_watch');
  // Reload is a no-op, including no further secure reads or metadata writes.
  jest.mocked(SecureStore.getItemAsync).mockClear();
  const write = jest.mocked(AsyncStorage.setItem);
  write.mockClear();
  await migrateLegacyOnchainWallets(owner, current);
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect((await getWalletList(owner)).map(state)).toEqual(wallets);
});

it('leaves all explicit methods and NWC metadata untouched', async () => {
  const wallets = [
    wallet('x', 'xpub'),
    wallet('m', 'mnemonic'),
    wallet('g', 'generated'),
    { ...wallet('n'), walletType: 'nwc' as const },
  ];
  await saveWalletList(wallets, owner);
  await migrateLegacyOnchainWallets(owner, current);
  expect(await getWalletList(owner)).toEqual(wallets);
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});

it('does not classify a failed secure read as watch-only', async () => {
  await saveWalletList([wallet('locked')], owner);
  jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('unavailable'));
  await expect(migrateLegacyOnchainWallets(owner, current)).rejects.toThrow('unavailable');
  expect((await getWalletList(owner))[0].onchainImportMethod).toBeUndefined();
});

it('preserves edits, removed wallets and newly explicit methods during secure reads', async () => {
  await saveWalletList([wallet('edit'), wallet('removed'), wallet('explicit')], owner);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async () => {
    await saveWalletList(
      [
        { ...wallet('edit'), alias: 'renamed' },
        wallet('explicit', 'generated'),
        wallet('new', 'xpub'),
      ],
      owner,
    );
    return null;
  });
  await migrateLegacyOnchainWallets(owner, current);
  expect(await getWalletList(owner)).toEqual([
    { ...wallet('edit', 'xpub'), alias: 'renamed' },
    wallet('explicit', 'generated'),
    wallet('new', 'xpub'),
  ]);
});

it('drops classification when the hydration generation changes during a read', async () => {
  await saveWalletList([wallet('seed')], owner);
  let active = true;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async () => {
    active = false;
    return '';
  });
  expect(await migrateLegacyOnchainWallets(owner, () => active)).toEqual(new Map());
  expect((await getWalletList(owner))[0].onchainImportMethod).toBeUndefined();
});

it('keeps the existing Move connection requirement for NWC wallets', () => {
  const nwc = { ...state(wallet('n')), walletType: 'nwc' as const };
  expect(getTransferSourceWallets([nwc])).toEqual([]);
  expect(getTransferSourceWallets([{ ...nwc, isConnected: true }])).toHaveLength(1);
});
