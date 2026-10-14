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
