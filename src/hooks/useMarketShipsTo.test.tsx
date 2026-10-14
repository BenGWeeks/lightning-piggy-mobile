import { act, renderHook } from '@testing-library/react-native';
import { useMarketShipsTo } from './useMarketShipsTo';
import { clearShippingOptionCache } from '../services/marketShippingCache';
import { fetchShippingOptionsForDisplay } from '../services/marketShippingService';
import type { MarketProduct } from '../data/marketProducts';
import type { ShippingOption } from '../utils/marketShipping';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest
      .requireActual<typeof import('react')>('react')
      .useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]),
}));
jest.mock('expo-localization', () => ({ useLocales: () => [{ regionCode: 'GB' }] }));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://relay.example', read: true }] }),
}));
jest.mock('../services/marketShippingService', () => ({
  fetchShippingOptionsForDisplay: jest.fn(),
}));

const seller = 'a'.repeat(64);
const coordinate = `30406:${seller}:shipping`;
const option: ShippingOption = {
  coordinate,
  pubkey: seller,
  dTag: 'shipping',
  title: 'Shipping',
  baseAmount: 5,
  currency: 'GBP',
  countries: ['GB'],
  createdAt: 1,
};
const products = [
  {
    id: 'book',
    listing: { event: { kind: 30402, tags: [['shipping_option', coordinate]] } },
  },
] as MarketProduct[];
const fetchMock = fetchShippingOptionsForDisplay as jest.Mock;

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  clearShippingOptionCache();
  fetchMock.mockReset();
});
afterEach(() => jest.useRealTimers());

test('retries transport failures on refocus and refresh with unchanged coordinates', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([option]);
  const { result, rerender } = renderHook(
    ({ generation }: { generation: number }) => useMarketShipsTo(products, true, generation),
    { initialProps: { generation: 0 } },
  );
  await settle();
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'unknown' });
  mockFocused = false;
  rerender({ generation: 0 });
  mockFocused = true;
  rerender({ generation: 0 });
  await settle();
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'countries', countries: ['GB'] });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  // A completed refresh reuses fresh answers without another relay query.
  rerender({ generation: 1 });
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a completed refresh retries a failed coordinate', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([option]);
  const { result, rerender } = renderHook(
    ({ generation }: { generation: number }) => useMarketShipsTo(products, true, generation),
    { initialProps: { generation: 0 } },
  );
  await settle();
  rerender({ generation: 1 });
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'countries', countries: ['GB'] });
});

test.each([
  { first: [], elapsed: 2 * 60_000 + 1 },
  { first: [option], elapsed: 10 * 60_000 + 1 },
])('rechecks expired shipping answers after $elapsed ms', async ({ first, elapsed }) => {
  fetchMock.mockResolvedValueOnce(first).mockResolvedValueOnce([{ ...option, countries: ['US'] }]);
  const { result, rerender } = renderHook(
    ({ generation }: { generation: number }) => useMarketShipsTo(products, true, generation),
    { initialProps: { generation: 0 } },
  );
  await settle();
  act(() => {
    jest.advanceTimersByTime(elapsed);
  });
  rerender({ generation: 1 });
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'countries', countries: ['US'] });
});

test('does not commit or cache a shipping batch after blur', async () => {
  let resolve!: (options: ShippingOption[]) => void;
  fetchMock.mockReturnValueOnce(
    new Promise<ShippingOption[]>((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = renderHook(() => useMarketShipsTo(products, true));
  await settle();
  mockFocused = false;
  rerender({});
  await act(async () => {
    resolve([option]);
  });
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'pending' });
  fetchMock.mockResolvedValueOnce([option]);
  mockFocused = true;
  rerender({});
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.byProduct.get('book')).toEqual({ kind: 'countries', countries: ['GB'] });
});
