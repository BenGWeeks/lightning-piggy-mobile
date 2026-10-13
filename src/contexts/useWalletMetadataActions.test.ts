import { act, renderHook } from '@testing-library/react-native';
import type { Dispatch, SetStateAction } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WalletMetadata, WalletState } from '../types/wallet';
import {
  getWalletList,
  saveWalletList,
  setActivePubkeyForWalletStorage,
} from '../services/walletStorageService';
import { useWalletMetadataActions } from './useWalletMetadataActions';

it('persists settings and order deltas without overwriting classification from a newer stored list', async () => {
  await AsyncStorage.clear();
  setActivePubkeyForWalletStorage('metadata-actions');
  const metadata: WalletMetadata[] = ['first', 'second'].map((id, order) => ({
    id,
    order,
    alias: id,
    theme: 'lightning-piggy',
    walletType: 'onchain',
    lightningAddress: null,
  }));
  // UI snapshot predates the background migration and another metadata edit.
  let state: WalletState[] = metadata.map((w) => ({
    ...w,
    isConnected: false,
    balance: 0,
    walletAlias: null,
    transactions: [],
  }));
  const setWallets: Dispatch<SetStateAction<WalletState[]>> = (update) => {
    state = typeof update === 'function' ? update(state) : update;
  };
  await saveWalletList(
    metadata.map((w) => ({ ...w, onchainImportMethod: 'mnemonic', hideBalance: true })),
  );
  const { result } = renderHook(() => useWalletMetadataActions(setWallets));
  await act(async () => {
    await result.current.updateWalletSettings('first', { alias: 'renamed' });
  });
  await act(async () => {
    await result.current.reorderWallet('first', 'down');
  });
  const stored = await getWalletList();
  expect(stored.map((w) => w.order)).toEqual([1, 0]);
  expect(stored[0].alias).toBe('renamed');
  expect(stored.every((w) => w.onchainImportMethod === 'mnemonic' && w.hideBalance)).toBe(true);
  expect(state.find((w) => w.id === 'first')?.alias).toBe('renamed');
});
