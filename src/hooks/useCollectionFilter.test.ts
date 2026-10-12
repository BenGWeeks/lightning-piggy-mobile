import { act, renderHook } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { useCollectionFilter } from './useCollectionFilter';
import { fetchMarketCollections } from '../services/marketCollectionsService';
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://read.example', read: true }] }),
}));
jest.mock('../services/marketCollectionsService', () => ({ fetchMarketCollections: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));
const pubkey = 'a'.repeat(64);
const collection = {
  kind: 30405,
  pubkey,
  id: 'art',
  tags: [
    ['d', 'art'],
    ['title', 'Art'],
  ],
} as Event;
const products = [
  {
    id: 'print',
    listing: {
      event: {
        kind: 30402,
        pubkey,
        id: 'print',
        tags: [
          ['d', 'print'],
          ['a', `30405:${pubkey}:art`],
        ],
      },
    },
  },
  { id: 'book', listing: { event: { kind: 30402, pubkey, id: 'book', tags: [['d', 'book']] } } },
] as MarketProduct[];
beforeEach(() => {
  jest.clearAllMocks();
  (fetchMarketCollections as jest.Mock).mockResolvedValue([collection]);
});
it('loads collection filters only when enabled and filters the signed product snapshot', async () => {
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) => useCollectionFilter(products, enabled),
    {
      initialProps: { enabled: false },
    },
  );
  expect(fetchMarketCollections).not.toHaveBeenCalled();
  await act(async () => rerender({ enabled: true }));
  expect(result.current.collections).toEqual([collection]);
  act(() => result.current.select(`30405:${pubkey}:art`));
  expect(result.current.products.map((p) => p.id)).toEqual(['print']);
  act(() => result.current.select(null));
  expect(result.current.products).toEqual(products);
});
it('aborts a blurred snapshot and ignores late collection results', async () => {
  let resolve!: (events: Event[]) => void;
  (fetchMarketCollections as jest.Mock).mockReturnValue(
    new Promise<Event[]>((r) => {
      resolve = r;
    }),
  );
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) => useCollectionFilter(products, enabled),
    {
      initialProps: { enabled: true },
    },
  );
  const signal = (fetchMarketCollections as jest.Mock).mock.calls[0][2] as AbortSignal;
  rerender({ enabled: false });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([collection]));
  expect(result.current.collections).toEqual([]);
});
it('does not retain a collection selection across seller/catalogue changes', async () => {
  const { result, rerender } = renderHook(
    ({ items }: { items: MarketProduct[] }) => useCollectionFilter(items, true),
    {
      initialProps: { items: products },
    },
  );
  await act(async () => {});
  act(() => result.current.select(`30405:${pubkey}:art`));
  const other = [
    {
      ...products[1],
      id: 'other',
      listing: { ...products[1].listing!, event: { ...products[1].listing!.event, id: 'other' } },
    },
  ];
  await act(async () => rerender({ items: other }));
  expect(result.current.selected).toBeNull();
  expect(result.current.products).toEqual(other);
});
