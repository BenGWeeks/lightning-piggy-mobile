import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getWalletList,
  saveWalletList,
  setActivePubkeyForWalletStorage,
  updateWalletList,
} from './walletStorageService';
import type { WalletMetadata } from '../types/wallet';

const wallet: WalletMetadata = {
  id: 'seed',
  alias: 'original',
  theme: 'lightning-piggy',
  order: 0,
  walletType: 'onchain',
  lightningAddress: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  setActivePubkeyForWalletStorage(null);
});

it('pins queued edits to the captured owner without blocking another account', async () => {
  await saveWalletList([wallet], 'A');
  await saveWalletList([wallet], 'B');
  setActivePubkeyForWalletStorage('A');
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setItem = jest.mocked(AsyncStorage.setItem);
  const original = setItem.getMockImplementation()!;
  setItem.mockImplementationOnce(async (key, value) => {
    started();
    await paused;
    return original(key, value);
  });
  const first = updateWalletList((list) => list.map((w) => ({ ...w, hideBalance: true })));
  await writing;
  const queued = updateWalletList((list) => list.map((w) => ({ ...w, alias: 'renamed A' })));
  setActivePubkeyForWalletStorage('B');
  await updateWalletList((list) => list.map((w) => ({ ...w, alias: 'renamed B' })));
  release();
  await Promise.all([first, queued]);
  expect(await getWalletList('A')).toEqual([{ ...wallet, hideBalance: true, alias: 'renamed A' }]);
  expect(await getWalletList('B')).toEqual([{ ...wallet, alias: 'renamed B' }]);
});

it('propagates a failed write and allows the next queued edit to use persisted metadata', async () => {
  await saveWalletList([wallet], 'A');
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk unavailable'));
  const failing = updateWalletList((list) => list.map((w) => ({ ...w, hideBalance: true })), 'A');
  const next = updateWalletList((list) => list.map((w) => ({ ...w, alias: 'renamed' })), 'A');
  await expect(failing).rejects.toThrow('disk unavailable');
  await next;
  expect(await getWalletList('A')).toEqual([{ ...wallet, alias: 'renamed' }]);
});
