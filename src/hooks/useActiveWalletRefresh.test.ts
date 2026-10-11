import { renderHook, act } from '@testing-library/react-native';
import { useActiveWalletRefresh } from './useActiveWalletRefresh';
import { WALLET_SWIPE_SETTLE_MS } from '../utils/walletRefreshScheduler';

type Props = { activeWalletId: string | null; available: boolean };

describe('useActiveWalletRefresh', () => {
  let fetchWallet: jest.Mock<Promise<boolean>, [string, { force: boolean }]>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchWallet = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const render = (initial: Props) =>
    renderHook((p: Props) => useActiveWalletRefresh({ ...p, fetchWallet }), {
      initialProps: initial,
    });

  it('loads the card that became active after it settles, with no pull-to-refresh', async () => {
    const { result, rerender } = render({ activeWalletId: 'a', available: true });
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet).toHaveBeenCalledWith('a', { force: false });

    rerender({ activeWalletId: 'b', available: true }); // swipe to the next card
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet).toHaveBeenLastCalledWith('b', { force: false });
    expect(result.current.isLoading).toBe(false);
  });

  it('retries a fetch that failed while disconnected once the wallet reconnects', async () => {
    fetchWallet.mockResolvedValueOnce(false);
    const { rerender } = render({ activeWalletId: 'nwc', available: false });
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet).toHaveBeenCalledTimes(1);

    rerender({ activeWalletId: 'nwc', available: true });
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet).toHaveBeenCalledTimes(2);
  });

  it('does not refetch on a reconnect when the wallet already loaded', async () => {
    const { rerender } = render({ activeWalletId: 'nwc', available: false });
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    rerender({ activeWalletId: 'nwc', available: true });
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet).toHaveBeenCalledTimes(1);
  });

  it('refreshNow forces a fetch through the latest fetcher', async () => {
    const { result } = render({ activeWalletId: 'a', available: true });
    await act(async () => {
      await result.current.refreshNow('a');
    });
    expect(fetchWallet).toHaveBeenCalledWith('a', { force: true });
  });

  it('cancels a pending fetch on unmount', () => {
    const { unmount } = render({ activeWalletId: 'a', available: true });
    unmount();
    jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    expect(fetchWallet).not.toHaveBeenCalled();
  });

  it('prefetches the neighbours it is given once the active card loads', async () => {
    renderHook(() =>
      useActiveWalletRefresh({
        activeWalletId: 'b',
        available: true,
        fetchWallet,
        getNeighbours: () => ['c'],
      }),
    );
    await act(async () => {
      jest.advanceTimersByTime(WALLET_SWIPE_SETTLE_MS);
    });
    expect(fetchWallet.mock.calls.map((c) => c[0])).toEqual(['b', 'c']);
  });
});
