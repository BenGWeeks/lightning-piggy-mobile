import { act, renderHook } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import { useLatestListing } from './useLatestListing';
import { fetchListingRevision } from '../services/marketListingsService';
import type { MarketProduct } from '../data/marketProducts';

jest.mock('../services/marketListingsService', () => ({ fetchListingRevision: jest.fn() }));
jest.mock('../services/nostrService', () => ({ DEFAULT_RELAYS: ['wss://default.example'] }));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://read.example', read: true, write: true }] }),
}));

const fetchRevision = fetchListingRevision as jest.Mock;

const live = (eventId: string, createdAt: number, title: string, seller: string): MarketProduct => {
  const event = { id: eventId, created_at: createdAt, pubkey: 'a'.repeat(64) } as Event;
  return {
    id: 'nostr-30402-seller-book',
    title,
    description: '',
    priceSats: 21,
    priceFiatLabel: '21 SAT',
    image: '',
    sellerName: seller,
    url: 'https://example.com',
    featured: false,
    listing: {
      event,
      currency: 'SAT',
      priceLabel: '21 SAT',
      vendor: {
        name: seller,
        country: '',
        shippingRegions: [],
        shopType: 'online',
        description: '',
        url: 'https://example.com',
        logo: '',
        nostrUrl: '',
        xUrl: '',
        featured: false,
      },
    },
  };
};

const signal = () => new AbortController().signal;
beforeEach(() => fetchRevision.mockReset());

it('shows a newer revision but keeps the contact-resolved seller name', async () => {
  const shown = live('1', 100, 'Old', 'Friend');
  fetchRevision.mockResolvedValue(live('2', 200, 'New', 'abcd…1234'));
  const h = renderHook(() => useLatestListing(shown));
  await act(() => h.result.current.refresh(signal()));
  expect(fetchRevision.mock.calls[0][1]).toEqual(['wss://read.example']);
  expect(h.result.current.product?.title).toBe('New');
  expect(h.result.current.product?.sellerName).toBe('Friend');
  expect(h.result.current.product?.listing?.vendor.name).toBe('Friend');
  expect(h.result.current.withdrawn).toBe(false);
});

it('marks the listing withdrawn when a refresh finds it gone, and keeps it withdrawn', async () => {
  const shown = live('1', 100, 'Old', 'Friend');
  fetchRevision.mockResolvedValue(null);
  const h = renderHook(() => useLatestListing(shown));
  await act(() => h.result.current.refresh(signal()));
  expect(h.result.current.withdrawn).toBe(true);
  expect(h.result.current.product).toBe(shown);

  // A lagging relay still serving the old active revision can't undo it.
  fetchRevision.mockResolvedValue(live('1', 100, 'Old', 'x'));
  await act(() => h.result.current.refresh(signal()));
  expect(h.result.current.withdrawn).toBe(true);
});

it('shows a same-second revision that wins the lower-id tie-break', async () => {
  const shown = live('5', 100, 'Old', 'Friend');
  fetchRevision.mockResolvedValue(live('3', 100, 'Tie winner', 'x'));
  const h = renderHook(() => useLatestListing(shown));
  await act(() => h.result.current.refresh(signal()));
  expect(h.result.current.product?.title).toBe('Tie winner');
});

it('ignores a result that arrives after the refresh was aborted', async () => {
  const shown = live('1', 100, 'Old', 'Friend');
  const controller = new AbortController();
  fetchRevision.mockImplementation(async () => {
    controller.abort();
    return null;
  });
  const h = renderHook(() => useLatestListing(shown));
  await act(() => h.result.current.refresh(controller.signal));
  expect(h.result.current.withdrawn).toBe(false);
});

it('does no relay work for a curated product', async () => {
  const curated = { ...live('1', 100, 'Curated', 'Shop'), listing: undefined };
  const h = renderHook(() => useLatestListing(curated));
  await act(() => h.result.current.refresh(signal()));
  expect(fetchRevision).not.toHaveBeenCalled();
  expect(h.result.current.product).toBe(curated);
});
