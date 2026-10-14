import { renderHook, waitFor } from '@testing-library/react-native';
import { useLikedListings } from './useLikedListings';
import { fetchLikedListings } from '../services/marketLikesService';
import type { MarketProduct } from '../data/marketProducts';

let mockPubkey: string | null = 'a'.repeat(64);

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: mockPubkey, relays: [] }),
}));
jest.mock('../services/nostrService', () => ({ DEFAULT_RELAYS: ['wss://default.example'] }));
jest.mock('../services/marketLikesService', () => ({ fetchLikedListings: jest.fn() }));

const fetchLiked = fetchLikedListings as jest.Mock;
const product = { id: 'widget' } as unknown as MarketProduct;

it("never shows the previous account's liked items after a switch, even if the new fetch fails", async () => {
  fetchLiked.mockResolvedValue([product]);
  const { result, rerender } = renderHook(() => useLikedListings());
  await waitFor(() => expect(result.current.products).toEqual([product]));

  fetchLiked.mockRejectedValue(new Error('relays down'));
  mockPubkey = 'b'.repeat(64);
  rerender({});

  expect(result.current.products).toEqual([]);
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.products).toEqual([]);
});
