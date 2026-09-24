import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as nwcService from '../services/nwcService';
import * as nostrService from '../services/nostrService';
import * as zapResolverFingerprintStorage from '../services/zapResolverFingerprintStorage';
import * as walletStorage from '../services/walletStorageService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { WalletProvider, useWallet } from './WalletContext';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});
jest.mock('../services/nwcService', () => ({
  connect: jest.fn(async () => ({ success: false })),
  getBalance: jest.fn(async () => null),
  listTransactions: jest.fn(async () => []),
  disconnect: jest.fn(),
  getInfo: jest.fn(async () => null),
  isWalletConnected: jest.fn(() => true),
  isSocketConnected: jest.fn(() => true),
  isRelayInCooldown: jest.fn(() => false),
  isConnectionInProgress: jest.fn(() => false),
  getWalletHealth: jest.fn(() => 'connected'),
}));
jest.mock('../services/swapRecoveryService', () => ({
  recoverPendingSwaps: jest.fn(async () => {}),
  ensureSwapMetaLoaded: jest.fn(async () => {}),
  getSwapMeta: jest.fn(() => undefined),
}));
jest.mock('../services/onchainService', () => ({}));
jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: [],
  getCurrentUserPubkey: jest.fn(() => null),
  getCurrentUserReadRelays: jest.fn(() => []),
  onCurrentUserPubkeyChange: jest.fn(() => () => {}),
  fetchZapReceiptsForRecipient: jest.fn(async () => []),
  parseZapReceipt: jest.fn(() => ({ senderPubkey: 'alice', comment: 'hi', anonymous: false })),
  fetchProfiles: jest.fn(async () => new Map()),
}));
jest.mock('../services/sendThresholdService', () => ({
  initialiseSendThresholdForNewInstall: jest.fn(async () => {}),
}));
jest.mock('../services/fiatService', () => ({
  ...jest.requireActual('../services/fiatService'),
  getBtcPrice: jest.fn(async () => null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let latest: ReturnType<typeof useWallet> | undefined;
function Probe() {
  latest = useWallet();
  return null;
}

afterEach(() => jest.restoreAllMocks());

it('still recovers swaps and re-checks onboarding when auto-login lands mid-startup', async () => {
  // NostrContext's mount publishes null (opening the hydration gate) and
  // auto-login publishes the real pubkey later — here, while migrating.
  walletStorage.setActivePubkeyForWalletStorage(null);
  const migrating = deferred<void>();
  jest.spyOn(walletStorage, 'migrateLegacy').mockImplementation(() => migrating.promise);
  jest.spyOn(walletStorage, 'isOnboarded').mockResolvedValueOnce(false).mockResolvedValue(true);
  const readWalletList = jest.spyOn(walletStorage, 'getWalletList');
  const view = render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  await waitFor(() => expect(walletStorage.migrateLegacy).toHaveBeenCalled());
  await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
  await act(async () => migrating.resolve());

  await waitFor(() => expect(swapRecoveryService.recoverPendingSwaps).toHaveBeenCalledTimes(1));
  expect(latest?.isOnboarded).toBe(true);
  // Startup bailed on the stale identity; the identity hydration's
  // completion is what ends the boot spinner.
  await waitFor(() => expect(latest?.isLoading).toBe(false));
  expect(latest?.walletsHydrated).toBe(true);
  // Only the identity hydration read the wallet list — startup's stale read
  // was skipped.
  expect(readWalletList).toHaveBeenCalledTimes(1);
  view.unmount();
});

function renderProvider() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
}
async function flushStartup() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('migrates a legacy wallet into the identity that lands while its credential read waits', async () => {
  const LEGACY_URL = 'nostr+walletconnect://legacy-fixture';
  walletStorage.setActivePubkeyForWalletStorage(null);
  await AsyncStorage.clear();
  await SecureStore.setItemAsync('nwc_connection_url', LEGACY_URL);
  // Hold every read of the legacy credential until identity B has landed.
  const legacyRead = deferred<void>();
  const readSecure = jest.mocked(SecureStore.getItemAsync).getMockImplementation()!;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key, options) => {
    if (key === 'nwc_connection_url') await legacyRead.promise;
    return readSecure(key, options);
  });
  const view = renderProvider();
  await flushStartup(); // startup runs its migration under the bootstrap null identity
  await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
  await act(async () => legacyRead.resolve());

  await waitFor(() => expect(latest?.wallets).toHaveLength(1));
  const [wallet] = latest!.wallets;
  expect(wallet.alias).toBe('My Wallet');
  expect(JSON.parse((await AsyncStorage.getItem('wallet_list_B'))!)).toEqual([
    expect.objectContaining({ id: wallet.id, walletType: 'nwc' }),
  ]);
  expect(await AsyncStorage.getItem('wallet_list')).toBeNull();
  expect(await readSecure(`nwc_url_${wallet.id}`)).toBe(LEGACY_URL);
  expect(await readSecure('nwc_connection_url')).toBeNull();
  expect(latest?.isOnboarded).toBe(true);
  view.unmount();
  walletStorage.setActivePubkeyForWalletStorage(null);
});

it('drops balance and transaction reads that finish after a B → C → B round trip', async () => {
  walletStorage.setActivePubkeyForWalletStorage(null);
  await AsyncStorage.clear();
  const metadata = { id: 'W', alias: 'W', theme: 'lightning-piggy', order: 0 };
  await AsyncStorage.multiSet([
    ['wallet_list_B', JSON.stringify([{ ...metadata, walletType: 'nwc', lightningAddress: null }])],
    ['balance_W', '42'],
  ]);
  const lateTxs = deferred<unknown[]>();
  const lateBalance = deferred<number | null>();
  jest.mocked(nwcService.listTransactions).mockImplementationOnce(() => lateTxs.promise);
  jest.mocked(nwcService.getBalance).mockImplementationOnce(() => lateBalance.promise);
  const view = renderProvider();
  await flushStartup();
  await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
  // W hydrates with no cached history, which kicks off its first tx fetch.
  await waitFor(() => expect(nwcService.listTransactions).toHaveBeenCalledWith('W'));
  const refreshing = latest!.refreshActiveBalance();
  expect(nwcService.getBalance).toHaveBeenCalledWith('W');

  await act(async () => walletStorage.setActivePubkeyForWalletStorage('C'));
  await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
  await waitFor(() => expect(latest?.wallets[0]?.id).toBe('W'));
  await act(async () => {
    lateBalance.resolve(999);
    lateTxs.resolve([{ type: 'incoming', amount: 5000, payment_hash: 'h', settled_at: 1 }]);
    await refreshing;
  });
  await flushStartup();

  expect(latest?.wallets[0]).toMatchObject({ balance: 42, transactions: [] });
  expect(await AsyncStorage.getItem('balance_W')).toBe('42');
  expect(await AsyncStorage.getItem('txs_W')).toBeNull();
  view.unmount();
  walletStorage.setActivePubkeyForWalletStorage(null);
});

describe('deferred zap attribution after a transaction fetch', () => {
  // One unattributed incoming tx (no bolt11, so it's matched by amount + time)
  // and a relay receipt that pairs with it.
  const zapped = { type: 'incoming', amount: 5000, settled_at: 1000, paymentHash: 'h0' };
  const other = { type: 'incoming', amount: 2100, settled_at: 2000, paymentHash: 'h1' };
  const receipt = {
    id: 'r0',
    created_at: 1000,
    tags: [['description', JSON.stringify({ tags: [['amount', '5000000']] })]],
  };

  // Hydrates B with W's cached history, fetches it, and holds the relay
  // receipt query that the deferred resolver pass issues.
  async function startResolvingUnderB() {
    walletStorage.setActivePubkeyForWalletStorage(null);
    await AsyncStorage.clear();
    zapResolverFingerprintStorage.__resetForTests();
    const metadata = { id: 'W', alias: 'W', theme: 'lightning-piggy', order: 0 };
    await AsyncStorage.multiSet([
      [
        'wallet_list_B',
        JSON.stringify([{ ...metadata, walletType: 'nwc', lightningAddress: null }]),
      ],
      ['txs_W', JSON.stringify([zapped])],
    ]);
    // Jest 29's restoreAllMocks strips the factory defaults, so re-arm them.
    jest.mocked(nostrService.getCurrentUserPubkey).mockReturnValue('pkB');
    jest.mocked(nostrService.getCurrentUserReadRelays).mockReturnValue([]);
    jest.mocked(nostrService.fetchProfiles).mockResolvedValue(new Map());
    jest
      .mocked(nostrService.parseZapReceipt)
      .mockReturnValue({ senderPubkey: 'alice', comment: 'hi', anonymous: false } as never);
    jest
      .mocked(nwcService.listTransactions)
      .mockResolvedValueOnce([
        { type: 'incoming', amount: 5000, settled_at: 1000, payment_hash: 'h0' },
      ]);
    const receipts = deferred<(typeof receipt)[]>();
    jest.mocked(nostrService.fetchZapReceiptsForRecipient).mockReturnValueOnce(receipts.promise);
    const view = renderProvider();
    await flushStartup();
    await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
    await waitFor(() => expect(latest?.wallets[0]?.transactions).toHaveLength(1));
    await flushStartup();
    await act(async () => latest!.fetchTransactionsForWallet('W'));
    await flushStartup();
    await waitFor(() =>
      expect(nostrService.fetchZapReceiptsForRecipient).toHaveBeenCalledWith(['pkB'], [], {
        limit: 500,
      }),
    );
    return { view, receipts };
  }
  afterEach(() => {
    jest.mocked(nostrService.getCurrentUserPubkey).mockReturnValue(null);
    walletStorage.setActivePubkeyForWalletStorage(null);
  });

  it('attributes the zap when the identity is unchanged', async () => {
    const { view, receipts } = await startResolvingUnderB();
    await act(async () => receipts.resolve([receipt]));

    await waitFor(() =>
      expect(latest?.wallets[0]?.transactions[0]?.zapCounterparty).toMatchObject({
        pubkey: 'alice',
      }),
    );
    await waitFor(async () => expect(await zapResolverFingerprintStorage.get('W')).not.toBeNull());
    view.unmount();
  });

  it('drops receipts that land after B → C → B instead of merging them by index', async () => {
    const { view, receipts } = await startResolvingUnderB();
    await act(async () => walletStorage.setActivePubkeyForWalletStorage('C'));
    // B's history gained a newer row meanwhile, so index 0 is now `other`.
    const rehydrated = JSON.stringify([other, zapped]);
    await AsyncStorage.setItem('txs_W', rehydrated);
    await act(async () => walletStorage.setActivePubkeyForWalletStorage('B'));
    await waitFor(() => expect(latest?.wallets[0]?.transactions).toHaveLength(2));

    await act(async () => receipts.resolve([receipt]));
    await flushStartup();

    const [first, second] = latest!.wallets[0].transactions;
    expect(first.zapCounterparty).toBeUndefined();
    expect(second.zapCounterparty).toBeUndefined();
    expect(await AsyncStorage.getItem('txs_W')).toBe(rehydrated);
    zapResolverFingerprintStorage.__resetForTests();
    expect(await zapResolverFingerprintStorage.get('W')).toBeNull();
    view.unmount();
  });
});
