import { act, renderHook, waitFor } from '@testing-library/react-native';
import { __resetListingBtcPricesForTests, useListingBtcPrice } from './useListingBtcPrice';
import { getBtcPrice } from '../services/fiatService';

jest.mock('../services/fiatService', () => ({ getBtcPrice: jest.fn() }));

const mockGetBtcPrice = jest.mocked(getBtcPrice);

beforeEach(() => {
  __resetListingBtcPricesForTests();
  mockGetBtcPrice.mockReset();
});

it('shares one fetch per currency across every consumer', async () => {
  mockGetBtcPrice.mockResolvedValue(100000);
  const a = renderHook(() => useListingBtcPrice('USD'));
  const b = renderHook(() => useListingBtcPrice('USD'));
  expect(a.result.current).toBeNull();
  await waitFor(() => expect(a.result.current).toBe(100000));
  expect(b.result.current).toBe(100000);
  expect(mockGetBtcPrice).toHaveBeenCalledTimes(1);
  // A later mount reads the fresh cached value without refetching.
  const c = renderHook(() => useListingBtcPrice('USD'));
  expect(c.result.current).toBe(100000);
  expect(mockGetBtcPrice).toHaveBeenCalledTimes(1);
});

it('neither fetches nor subscribes when no rate is needed', async () => {
  const { result } = renderHook(() => useListingBtcPrice(null));
  await act(async () => {});
  expect(result.current).toBeNull();
  expect(mockGetBtcPrice).not.toHaveBeenCalled();
});

it('stays null when the lookup fails', async () => {
  mockGetBtcPrice.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useListingBtcPrice('EUR'));
  await waitFor(() => expect(mockGetBtcPrice).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(result.current).toBeNull();
});

describe('refreshing mounted consumers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function expectTimers(count: number) {
    // React's async act also queues microtasks, which Jest counts as timers.
    jest.runAllTicks();
    expect(jest.getTimerCount()).toBe(count);
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it.each(['null', 'rejection'])(
    'recovers from an initial %s failure without remounting',
    async (failure) => {
      if (failure === 'null') mockGetBtcPrice.mockResolvedValueOnce(null);
      else mockGetBtcPrice.mockRejectedValueOnce(new Error('offline'));
      mockGetBtcPrice.mockResolvedValue(90000);
      const a = renderHook(() => useListingBtcPrice('EUR'));
      const b = renderHook(() => useListingBtcPrice('EUR'));
      await advance(0);
      expect(a.result.current).toBeNull();
      await advance(59999);
      expect(mockGetBtcPrice).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(mockGetBtcPrice).toHaveBeenCalledTimes(2);
      expect(a.result.current).toBe(90000);
      expect(b.result.current).toBe(90000);
      a.unmount();
      b.unmount();
      expectTimers(0);
    },
  );

  it('shares refreshes at cache expiry and stops after the last consumer leaves', async () => {
    mockGetBtcPrice.mockResolvedValueOnce(100000).mockResolvedValue(110000);
    const a = renderHook(() => useListingBtcPrice('USD'));
    const b = renderHook(() => useListingBtcPrice('USD'));
    await advance(0);
    expectTimers(1);
    await advance(299999);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(2);
    expect(a.result.current).toBe(110000);
    expect(b.result.current).toBe(110000);
    a.unmount();
    await advance(300000);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(3);
    b.unmount();
    expectTimers(0);
    await advance(600000);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(3);
  });

  it('keeps the last good price during a failed refresh but retries after a minute', async () => {
    mockGetBtcPrice
      .mockResolvedValueOnce(100000)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(120000);
    const { result, unmount } = renderHook(() => useListingBtcPrice('USD'));
    await advance(0);
    await advance(300000);
    expect(result.current).toBe(100000);
    expect(mockGetBtcPrice).toHaveBeenLastCalledWith('USD', { allowStale: false });
    await advance(59999);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(result.current).toBe(120000);
    unmount();
  });

  it('does not schedule more work when a pending fetch completes after unmount', async () => {
    let resolve!: (price: number) => void;
    mockGetBtcPrice.mockReturnValue(new Promise<number>((done) => (resolve = done)));
    const { unmount } = renderHook(() => useListingBtcPrice('EUR'));
    unmount();
    await act(async () => resolve(90000));
    expectTimers(0);
    await advance(600000);
    expect(mockGetBtcPrice).toHaveBeenCalledTimes(1);
  });

  it('cancels the old currency timer when the consumer changes currency or needs no rate', async () => {
    mockGetBtcPrice.mockResolvedValue(100000);
    const { rerender, unmount } = renderHook(
      ({ currency }: { currency: string | null }) => useListingBtcPrice(currency),
      { initialProps: { currency: 'USD' as string | null } },
    );
    await advance(0);
    rerender({ currency: 'EUR' });
    await advance(0);
    expectTimers(1);
    await advance(300000);
    expect(mockGetBtcPrice.mock.calls.map(([currency]) => currency)).toEqual(['USD', 'EUR', 'EUR']);
    rerender({ currency: null });
    expectTimers(0);
    unmount();
  });
});
