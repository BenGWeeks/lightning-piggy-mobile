/**
 * Unit tests for the on-chain incoming-payment poll (#134).
 *
 * The hook drives a gentle background sweep of every on-chain wallet so
 * a mempool credit trips WalletContext's balance-diff receive detector.
 * Its lifecycle is non-trivial (AppState start/stop, an in-flight sweep
 * guard, sequential per-wallet syncs), so the contract is pinned here:
 *
 *   1. On foreground it sweeps only on-chain wallets and commits a
 *      refreshed balance — but skips the write when nothing changed.
 *   2. With no on-chain wallets it does no work at all.
 *   3. A background→active transition re-triggers a sweep; leaving the
 *      foreground does not.
 *   4. Overlapping triggers can't start a second concurrent sweep while
 *      one is still in flight (the shared Electrum connection guard).
 *   5. Unmounting removes the AppState subscription.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { MutableRefObject } from 'react';

import { useOnchainIncomingPoll } from './useOnchainIncomingPoll';
import * as onchainService from '../services/onchainService';
import type { WalletState } from '../types/wallet';

jest.mock('../services/onchainService', () => ({
  __esModule: true,
  getBalance: jest.fn(),
}));

const mockedGetBalance = onchainService.getBalance as jest.MockedFunction<
  typeof onchainService.getBalance
>;

// Captures the 'change' handler the hook registers so tests can drive
// AppState transitions without a real native event.
let latestChangeHandler: ((next: string) => void) | null = null;
const removeSub = jest.fn();

function wallet(id: string, walletType: WalletState['walletType'], balance: number): WalletState {
  return { id, walletType, balance } as WalletState;
}

function refOf(wallets: WalletState[]): MutableRefObject<WalletState[]> {
  return { current: wallets };
}

beforeEach(() => {
  jest.clearAllMocks();
  latestChangeHandler = null;
  (AppState as unknown as { currentState: string }).currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') latestChangeHandler = handler as (next: string) => void;
    return { remove: removeSub } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  (AppState.addEventListener as jest.Mock).mockRestore?.();
});

describe('useOnchainIncomingPoll', () => {
  it('sweeps only on-chain wallets on foreground and commits changed balances', async () => {
    mockedGetBalance.mockResolvedValue(500);
    const updateWalletInState = jest.fn();
    const wallets = [wallet('oc', 'onchain', 100), wallet('ln', 'nwc', 0)];

    renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    await waitFor(() => expect(updateWalletInState).toHaveBeenCalledWith('oc', { balance: 500 }));
    // Lightning wallet is never synced.
    expect(mockedGetBalance).toHaveBeenCalledTimes(1);
    expect(mockedGetBalance).toHaveBeenCalledWith('oc');
  });

  it('skips the state write when the balance is unchanged', async () => {
    mockedGetBalance.mockResolvedValue(100);
    const updateWalletInState = jest.fn();
    const wallets = [wallet('oc', 'onchain', 100)];

    renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(1));
    expect(updateWalletInState).not.toHaveBeenCalled();
  });

  it('does no work and registers no polling when there are no on-chain wallets', async () => {
    const updateWalletInState = jest.fn();
    const wallets = [wallet('ln', 'nwc', 0)];

    renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    // Give any stray microtasks a chance to run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGetBalance).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it('re-sweeps on background→active and ignores leaving the foreground', async () => {
    mockedGetBalance.mockResolvedValue(500);
    const updateWalletInState = jest.fn();
    const wallets = [wallet('oc', 'onchain', 100)];

    renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(1));

    // Leaving the foreground must not sweep.
    await act(async () => {
      latestChangeHandler?.('background');
      await Promise.resolve();
    });
    expect(mockedGetBalance).toHaveBeenCalledTimes(1);

    // Returning to the foreground triggers a fresh sweep.
    await act(async () => {
      latestChangeHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(2));
  });

  it('does not start a second concurrent sweep while one is in flight', async () => {
    let resolveBalance: (n: number) => void = () => {};
    mockedGetBalance.mockReturnValue(
      new Promise<number>((res) => {
        resolveBalance = res;
      }),
    );
    const updateWalletInState = jest.fn();
    const wallets = [wallet('oc', 'onchain', 100)];

    renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    // Mount sweep is now awaiting getBalance.
    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(1));

    // A resume that lands mid-sweep must be dropped by the in-flight guard.
    await act(async () => {
      latestChangeHandler?.('active');
      await Promise.resolve();
    });
    expect(mockedGetBalance).toHaveBeenCalledTimes(1);

    // Once the first sweep settles, later triggers proceed normally.
    await act(async () => {
      resolveBalance(500);
      await Promise.resolve();
    });
    await act(async () => {
      latestChangeHandler?.('active');
      await Promise.resolve();
    });
    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(2));
  });

  it('removes the AppState subscription on unmount', async () => {
    mockedGetBalance.mockResolvedValue(100);
    const updateWalletInState = jest.fn();
    const wallets = [wallet('oc', 'onchain', 100)];

    const { unmount } = renderHook(() =>
      useOnchainIncomingPoll({ wallets, walletsRef: refOf(wallets), updateWalletInState }),
    );

    await waitFor(() => expect(mockedGetBalance).toHaveBeenCalledTimes(1));
    unmount();
    expect(removeSub).toHaveBeenCalled();
  });
});
