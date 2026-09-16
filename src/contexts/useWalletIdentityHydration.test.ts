import { useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as walletStorage from '../services/walletStorageService';
import * as nwcService from '../services/nwcService';
import type { WalletMetadata, WalletState } from '../types/wallet';
import { useWalletIdentityHydration } from './useWalletIdentityHydration';

jest.mock('../services/nwcService', () => ({ connect: jest.fn(), disconnect: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function metadata(id: string): WalletMetadata {
  return {
    id,
    alias: id,
    theme: 'lightning-piggy',
    order: 0,
    walletType: 'nwc',
    lightningAddress: null,
  };
}
const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const hydrateSeenReceipts = jest.fn(async () => {});
function mount() {
  return renderHook(() => {
    const [wallets, setWallets] = useState<WalletState[]>([]);
    const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
    const walletsRef = useRef(wallets);
    walletsRef.current = wallets;
    const lastTxsJsonRef = useRef(new Map<string, string>());
    useWalletIdentityHydration({
      walletsRef,
      lastTxsJsonRef,
      hydrateSeenReceipts,
      setWallets,
      setActiveWalletId,
    });
    return { wallets, activeWalletId, fingerprints: lastTxsJsonRef.current };
  });
}
async function switchTo(pubkey: string | null) {
  await act(async () => {
    walletStorage.setActivePubkeyForWalletStorage(pubkey);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
  await AsyncStorage.clear();
  walletStorage.setActivePubkeyForWalletStorage('A');
  await AsyncStorage.multiSet([
    ['wallet_list_B', JSON.stringify([metadata('B-wallet')])],
    ['wallet_list_C', JSON.stringify([metadata('C-wallet')])],
    ['balance_B-wallet', '42'],
  ]);
  jest.mocked(nwcService.connect).mockResolvedValue({ success: true, balance: 50 });
  jest.spyOn(walletStorage, 'getNwcUrl').mockResolvedValue('nostr+walletconnect://fixture');
});
afterEach(() => jest.restoreAllMocks());

it('hydrates the active identity, seeds receipts, and connects its wallets', async () => {
  const { result } = mount();
  await switchTo('B');
  await waitFor(() => expect(result.current.wallets[0]?.isConnected).toBe(true));
  expect(result.current.activeWalletId).toBe('B-wallet');
  expect(result.current.wallets[0].balance).toBe(50);
  expect(hydrateSeenReceipts).toHaveBeenCalledWith('B-wallet', []);
  await switchTo('C');
  expect(nwcService.disconnect).toHaveBeenCalledWith('B-wallet');
  await waitFor(() => expect(result.current.activeWalletId).toBe('C-wallet'));
});

it('drops an older wallet-list read that finishes after the next switch', async () => {
  const slow = deferred<WalletMetadata[]>();
  jest.spyOn(walletStorage, 'getWalletList').mockImplementationOnce(() => slow.promise);
  const { result } = mount();
  await switchTo('B');
  await switchTo('C');
  await waitFor(() => expect(result.current.activeWalletId).toBe('C-wallet'));
  await act(async () => slow.resolve([metadata('B-wallet')]));
  expect(result.current.wallets.map((w) => w.id)).toEqual(['C-wallet']);
  expect(nwcService.connect).not.toHaveBeenCalledWith(
    'B-wallet',
    expect.anything(),
    expect.anything(),
  );
});

it('drops delayed transaction caches without restoring stale fingerprints or receipts', async () => {
  const slow = deferred<string | null>();
  const read = readStorage;
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockImplementation((key) => (key === 'txs_B-wallet' ? slow.promise : read(key)));
  const { result } = mount();
  await switchTo('B');
  await switchTo('C');
  await waitFor(() => expect(result.current.activeWalletId).toBe('C-wallet'));
  await act(async () => slow.resolve('[]'));
  expect(result.current.activeWalletId).toBe('C-wallet');
  expect(result.current.fingerprints.has('B-wallet')).toBe(false);
  expect(hydrateSeenReceipts).not.toHaveBeenCalledWith('B-wallet', expect.anything());
});

it('uses a generation as well as pubkey for B → C → B', async () => {
  const slow = deferred<WalletMetadata[]>();
  jest.spyOn(walletStorage, 'getWalletList').mockImplementationOnce(() => slow.promise);
  const { result } = mount();
  await switchTo('B');
  await switchTo('C');
  await switchTo('B');
  await waitFor(() => expect(result.current.activeWalletId).toBe('B-wallet'));
  await act(async () => slow.resolve([metadata('B-stale-wallet')]));
  expect(result.current.wallets.map((w) => w.id)).toEqual(['B-wallet']);
});

it('does not start a connection after a delayed credential read crosses identities', async () => {
  const slow = deferred<string | null>();
  jest.mocked(walletStorage.getNwcUrl).mockImplementationOnce(() => slow.promise);
  const { result } = mount();
  await switchTo('B');
  await waitFor(() => expect(walletStorage.getNwcUrl).toHaveBeenCalledWith('B-wallet'));
  await switchTo('C');
  await act(async () => slow.resolve('old-url'));
  expect(nwcService.connect).not.toHaveBeenCalledWith(
    'B-wallet',
    expect.anything(),
    expect.anything(),
  );
  await waitFor(() => expect(result.current.activeWalletId).toBe('C-wallet'));
});

it('closes a late enabled connection and ignores its balance after switching away', async () => {
  const slow = deferred<{ success: boolean; balance: number }>();
  let enabled: (() => void) | undefined;
  jest.mocked(nwcService.connect).mockImplementationOnce((_id, _url, callback) => {
    enabled = callback;
    return slow.promise;
  });
  const { result } = mount();
  await switchTo('B');
  await waitFor(() => expect(enabled).toBeDefined());
  await switchTo('C');
  jest.mocked(nwcService.disconnect).mockClear();
  await act(async () => {
    enabled!();
    slow.resolve({ success: true, balance: 999 });
  });
  expect(nwcService.disconnect).toHaveBeenCalledWith('B-wallet');
  await waitFor(() => expect(result.current.activeWalletId).toBe('C-wallet'));
  expect(result.current.wallets[0].balance).not.toBe(999);
});

it('keeps wallets empty after logout even if a prior read completes', async () => {
  const slow = deferred<WalletMetadata[]>();
  jest.spyOn(walletStorage, 'getWalletList').mockImplementationOnce(() => slow.promise);
  const { result } = mount();
  await switchTo('B');
  await switchTo(null);
  await act(async () => slow.resolve([metadata('B-wallet')]));
  expect(result.current.wallets).toEqual([]);
  expect(result.current.activeWalletId).toBeNull();
});

it('unsubscribes and drops pending reads on unmount', async () => {
  const slow = deferred<WalletMetadata[]>();
  const read = jest
    .spyOn(walletStorage, 'getWalletList')
    .mockImplementationOnce(() => slow.promise);
  const { unmount } = mount();
  await switchTo('B');
  unmount();
  await act(async () => slow.resolve([metadata('B-wallet')]));
  await switchTo('C');
  expect(read).toHaveBeenCalledTimes(1);
  expect(nwcService.connect).not.toHaveBeenCalled();
});
