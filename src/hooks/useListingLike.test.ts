import { act, renderHook } from '@testing-library/react-native';
import { useListingLike } from './useListingLike';
import { fetchListingLikes } from '../services/marketLikesService';
import { MARKET_PRODUCTS } from '../data/marketProducts';

const mockPublish = jest.fn();
const mockDelete = jest.fn();
const mockRelays = [{ url: 'wss://relay.example', read: true }];
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: 'viewer',
    relays: mockRelays,
    publishReaction: mockPublish,
    deleteReaction: mockDelete,
  }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../services/nostrService', () => ({ DEFAULT_RELAYS: [] }));
jest.mock('../services/marketLikesService', () => ({ fetchListingLikes: jest.fn() }));
const product = {
  ...MARKET_PRODUCTS[0],
  listing: { event: { id: 'listing', pubkey: 'seller', kind: 30402, tags: [['d', 'widget']] } },
} as (typeof MARKET_PRODUCTS)[number];

it('ignores a pre-toggle focus result after publish and retracts the published id on the next tap', async () => {
  let resolveFetch!: (value: {
    count: number;
    myReactionIds: string[];
    myReactionId: string | null;
  }) => void;
  jest.mocked(fetchListingLikes).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  mockPublish.mockResolvedValue('new-reaction');
  mockDelete.mockResolvedValue(true);
  const hook = renderHook(() => useListingLike(product, jest.fn()));
  await act(() => hook.result.current.toggle());
  expect(hook.result.current.liked).toBe(true);
  await act(async () => resolveFetch({ count: 0, myReactionIds: [], myReactionId: null }));
  expect(hook.result.current.liked).toBe(true);
  expect(hook.result.current.count).toBe(1);
  await act(() => hook.result.current.toggle());
  expect(mockDelete).toHaveBeenCalledWith('new-reaction', expect.any(Array));
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(hook.result.current.liked).toBe(false);
});
