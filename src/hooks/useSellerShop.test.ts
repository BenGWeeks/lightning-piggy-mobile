import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { useSellerShop } from './useSellerShop';
import { fetchSellerEvents } from '../services/marketSellerService';
import { resetSellerStore } from '../services/sellerEventStore';
import { buildShopTemplate } from '../utils/marketSellerTestFixtures';

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: mockPubkey, relays: [], isLoggedIn: true, signerType: 'nsec' }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../services/marketSellerService', () => ({
  fetchSellerEvents: jest.fn(),
  loadSellerCache: async () => [],
  loadHiddenListings: async () => new Map(),
  persistSellerSnapshot: jest.fn(),
  sellerRelays: () => ['wss://example.com'],
}));
const secret = new Uint8Array(32).fill(8);
const mockPubkey = getPublicKey(secret);
const legacy = finalizeEvent(
  {
    ...buildShopTemplate({
      shop: { name: 'GBP merchant', description: '', currency: 'GBP' },
      pubkey: mockPubkey,
      productCoordinates: [],
      zoneCoordinates: [],
    }),
    created_at: 100,
  },
  secret,
);
beforeEach(async () => {
  resetSellerStore();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
it('waits for GBP migration before offering ready seller forms', async () => {
  let resolve!: (events: Event[]) => void;
  (fetchSellerEvents as jest.Mock).mockReturnValue(new Promise<Event[]>((r) => (resolve = r)));
  const readyCurrencies: (string | undefined)[] = [];
  const { result } = renderHook(() => {
    const shop = useSellerShop();
    if (shop.status === 'ready') readyCurrencies.push(shop.defaultCurrency);
    return shop;
  });
  await act(async () => {});
  expect(result.current.status).toBe('loading');
  await act(async () => resolve([legacy]));
  expect(result.current.status).toBe('ready');
  expect(result.current.defaultCurrency).toBe('GBP');
  expect(readyCurrencies.length).toBeGreaterThan(0);
  expect(readyCurrencies.every((currency) => currency === 'GBP')).toBe(true);
  expect(await AsyncStorage.getItem(`market-seller-currency:${mockPubkey}`)).toBe('GBP');
});
