import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { useDeferredSwapRefresh } from './useDeferredSwapRefresh';
import { completeReverseSwap, SWAP_REFRESH_DELAY_MS } from '../utils/swapCompletion';
import { setActivePubkeyForWalletStorage } from '../services/walletStorageService';

jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));
jest.mock('../utils/swapPendingMerge', () => ({ markSwapPlaceholdersResolved: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  setActivePubkeyForWalletStorage('A');
});
afterEach(() => jest.useRealTimers());

async function advanceRefresh() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SWAP_REFRESH_DELAY_MS);
  });
}

it('keeps the completion refresh alive after its sheet unmounts', async () => {
  const refresh = jest.fn(async () => {});
  let claim!: () => void;
  function Sheet({ deferRefresh }: { deferRefresh: (refresh: () => Promise<unknown>) => void }) {
    claim = () => {
      completeReverseSwap({
        swapId: 'swap',
        amount: '1',
        txId: 'tx',
        t: String,
        refresh,
        deferRefresh,
        followSettle: jest.fn(),
      });
    };
    return null;
  }
  function Provider({ sheetVisible }: { sheetVisible: boolean }) {
    const deferRefresh = useDeferredSwapRefresh();
    return sheetVisible ? React.createElement(Sheet, { deferRefresh }) : null;
  }
  const { rerender } = render(React.createElement(Provider, { sheetVisible: true }));
  claim();
  rerender(React.createElement(Provider, { sheetVisible: false }));
  expect(refresh).not.toHaveBeenCalled();
  await advanceRefresh();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['B', null])('cancels all pending timers on account switch to %s', async (next) => {
  const { result } = renderHook(() => useDeferredSwapRefresh());
  const refresh = jest.fn(async () => {});
  result.current(refresh);
  result.current(refresh);
  act(() => setActivePubkeyForWalletStorage(next));
  expect(jest.getTimerCount()).toBe(0);
  await advanceRefresh();
  expect(refresh).not.toHaveBeenCalled();
  // The replacement account can still schedule its own work.
  result.current(refresh);
  await advanceRefresh();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('rejects an old claim completion even after switching away and back', async () => {
  const { result } = renderHook(() => useDeferredSwapRefresh());
  const oldSchedule = result.current;
  const refresh = jest.fn(async () => {});
  act(() => setActivePubkeyForWalletStorage('B'));
  act(() => setActivePubkeyForWalletStorage('A'));
  oldSchedule(refresh);
  expect(jest.getTimerCount()).toBe(0);
  await advanceRefresh();
  expect(refresh).not.toHaveBeenCalled();
});

it('cancels timers on provider teardown and rejects late claim completion', async () => {
  const { result, unmount } = renderHook(() => useDeferredSwapRefresh());
  const schedule = result.current;
  const refresh = jest.fn(async () => {});
  schedule(refresh);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
  schedule(refresh);
  expect(jest.getTimerCount()).toBe(0);
  await advanceRefresh();
  expect(refresh).not.toHaveBeenCalled();
});
