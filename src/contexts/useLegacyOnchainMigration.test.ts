import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { WalletState } from '../types/wallet';
import {
  getWalletList,
  saveWalletList,
  setActivePubkeyForWalletStorage,
  updateWalletList,
} from '../services/walletStorageService';
import { isSendableWallet } from '../utils/walletCapabilities';
import { getTransferSourceWallets } from '../utils/transferSourceWallets';
import { useLegacyOnchainMigration } from './useLegacyOnchainMigration';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(),
}));

it('reconciles persisted classifications after reordering cancels a pending final write', async () => {
  await AsyncStorage.clear();
  const owner = 'migration-reorder';
  setActivePubkeyForWalletStorage(owner);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('');
  const initial: WalletState[] = ['first', 'second'].map((id, order) => ({
    id,
    order,
    alias: id,
    theme: 'lightning-piggy',
    walletType: 'onchain',
    lightningAddress: null,
    isConnected: false,
    balance: 100,
    walletAlias: null,
    transactions: [],
  }));
  await saveWalletList(initial, owner);
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setItem = jest.mocked(AsyncStorage.setItem);
  const original = setItem.getMockImplementation()!;
  setItem.mockImplementationOnce(async (key, value) => {
    started();
    await pending;
    return original(key, value);
  });
  const { result } = renderHook(() => {
    const [wallets, setWallets] = useState(initial);
    useLegacyOnchainMigration(wallets, true, setWallets);
    return { wallets, setWallets };
  });
  try {
    await act(async () => {
      await writing;
    });
    act(() => {
      result.current.setWallets((wallets) =>
        [...wallets].reverse().map((wallet, order) => ({ ...wallet, order })),
      );
    });
    const reordering = updateWalletList(
      (wallets) => wallets.map((wallet) => ({ ...wallet, order: wallet.id === 'first' ? 1 : 0 })),
      owner,
    );
    await act(async () => {
      release();
      await reordering;
    });
    expect((await getWalletList(owner)).map((wallet) => wallet.onchainImportMethod)).toEqual([
      'mnemonic',
      'mnemonic',
    ]);
    await waitFor(() => {
      expect(result.current.wallets.map((wallet) => wallet.onchainImportMethod)).toEqual([
        'mnemonic',
        'mnemonic',
      ]);
    });
    expect(result.current.wallets.map((wallet) => wallet.id)).toEqual(['second', 'first']);
    expect(result.current.wallets.every(isSendableWallet)).toBe(true);
    expect(getTransferSourceWallets(result.current.wallets)).toHaveLength(2);
  } finally {
    release();
    setItem.mockImplementation(original);
    setActivePubkeyForWalletStorage(null);
  }
});
