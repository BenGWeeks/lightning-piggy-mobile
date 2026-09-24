import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import * as walletStorage from '../services/walletStorageService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { WalletProvider, useWallet } from './WalletContext';

jest.mock('../services/nwcService', () => ({
  connect: jest.fn(async () => ({ success: false })),
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
}));
jest.mock('../services/onchainService', () => ({}));
jest.mock('../services/nostrService', () => ({
  getCurrentUserPubkey: jest.fn(() => null),
  onCurrentUserPubkeyChange: jest.fn(() => () => {}),
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
