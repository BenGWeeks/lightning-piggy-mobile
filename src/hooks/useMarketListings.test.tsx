import { act, renderHook } from '@testing-library/react-native';
import { useMarketListings } from './useMarketListings';
import { fetchMarketListings } from '../services/marketListingsService';
import type { MarketListingsResult } from '../services/marketListingsService';
jest.mock('../services/marketListingsService', () => ({ fetchMarketListings: jest.fn() }));
let mockViewer = 'mockViewer-a';
let mockFocused = true;
const mockContacts = [{ pubkey: 'a'.repeat(64), petname: 'Friend', profile: null }];
const mockRelays = [{ url: 'wss://example.com', read: true, write: true }];
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: mockViewer, relays: mockRelays }),
  useNostrContacts: () => ({ contacts: mockContacts }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
const fetch = fetchMarketListings as jest.Mock;
let finish: (result: MarketListingsResult) => void;
beforeEach(() => {
  mockViewer = 'mockViewer-a';
  mockFocused = true;
  fetch.mockReset();
  fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
});
it('does no relay work in preferred mode', () => {
  renderHook(() => useMarketListings(false));
  expect(fetch).not.toHaveBeenCalled();
});
it('aborts on blur and ignores a late result', async () => {
  const h = renderHook(() => useMarketListings(true));
  const signal = fetch.mock.calls[0][2];
  mockFocused = false;
  h.rerender({});
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ products: [], incomplete: true }));
  expect(h.result.current.incomplete).toBe(false);
});
it('aborts on account switch and never exposes the previous account snapshot', async () => {
  const h = renderHook(() => useMarketListings(true));
  const signal = fetch.mock.calls[0][2];
  const oldFinish = finish;
  mockViewer = 'mockViewer-b';
  h.rerender({});
  expect(signal.aborted).toBe(true);
  await act(async () => oldFinish({ products: [], incomplete: true }));
  expect(h.result.current.incomplete).toBe(false);
  expect(h.result.current.loading).toBe(true);
  await act(async () => finish({ products: [], incomplete: false }));
  expect(h.result.current.loading).toBe(false);
});
it('cleans up on unmount', () => {
  const h = renderHook(() => useMarketListings(true));
  const signal = fetch.mock.calls[0][2];
  h.unmount();
  expect(signal.aborted).toBe(true);
});
it('keeps the current listings on screen while refreshing the same scope', async () => {
  const product = {
    id: 'p1',
    sellerName: 'Seller',
  } as unknown as MarketListingsResult['products'][number];
  const h = renderHook(() => useMarketListings(true));
  await act(async () => finish({ products: [product], incomplete: false }));
  expect(h.result.current.products).toHaveLength(1);
  act(() => h.result.current.refresh());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(h.result.current.loading).toBe(true);
  expect(h.result.current.products).toHaveLength(1);
});
