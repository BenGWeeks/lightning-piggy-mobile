import { act, renderHook } from '@testing-library/react-native';
import { usePreferredMarketListings } from './usePreferredMarketListings';
import {
  fetchPreferredSellers,
  PREFERRED_SELLERS_ACCOUNT,
} from '../services/marketPreferredSellers';
import { useMarketListings } from './useMarketListings';
import { MARKET_PRODUCTS } from '../data/marketProducts';
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://example.com', read: true }] }),
}));
jest.mock('../services/marketPreferredSellers', () => ({
  fetchPreferredSellers: jest.fn(),
  getPreferredSellers: () => undefined,
  PREFERRED_SELLERS_ACCOUNT: 'preferred',
}));
jest.mock('./useMarketListings', () => ({ useMarketListings: jest.fn() }));
const live = useMarketListings as jest.Mock;
const follows = fetchPreferredSellers as jest.Mock;
const refresh = jest.fn();
beforeEach(() => {
  follows.mockReset();
  live.mockReturnValue({
    products: [],
    hasSnapshot: false,
    completed: false,
    incomplete: false,
    loading: false,
    refresh,
  });
});
it('scopes the shared verified pipeline to the Lightning Piggy follows', async () => {
  const authors = ['b'.repeat(64)];
  follows.mockResolvedValue(authors);
  renderHook(() => usePreferredMarketListings());
  await act(async () => {});
  expect(live).toHaveBeenLastCalledWith(true, { account: PREFERRED_SELLERS_ACCOUNT, authors });
});
it('falls back to the catalogue when relays fail without a snapshot', async () => {
  follows.mockRejectedValue(new Error('offline'));
  const h = renderHook(() => usePreferredMarketListings());
  await act(async () => {});
  expect(h.result.current.products).toBe(MARKET_PRODUCTS);
  expect(h.result.current.loading).toBe(false);
});
it('preserves cached listings on failure and respects a successful empty snapshot', async () => {
  follows.mockResolvedValue([]);
  const cached = [{ ...MARKET_PRODUCTS[0], id: 'cached-live' }];
  live.mockReturnValue({
    products: cached,
    hasSnapshot: true,
    incomplete: true,
    completed: true,
    refresh,
  });
  const h = renderHook(() => usePreferredMarketListings());
  await act(async () => {});
  expect(h.result.current.products).toBe(cached);
  live.mockReturnValue({
    products: [],
    hasSnapshot: true,
    incomplete: false,
    completed: true,
    refresh,
  });
  h.rerender({});
  expect(h.result.current.products).toEqual([]);
});
