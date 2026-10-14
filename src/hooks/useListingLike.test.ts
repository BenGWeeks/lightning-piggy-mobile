import { act, renderHook } from '@testing-library/react-native';
import { useListingLike } from './useListingLike';
import { fetchListingLikes } from '../services/marketLikesService';
import { MARKET_PRODUCTS } from '../data/marketProducts';

const mockPublish = jest.fn();
const mockDelete = jest.fn();
let mockPubkey: string | null = 'viewer';
let mockRelays = [{ url: 'wss://relay.example', read: true }];
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: mockPubkey,
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

type Likes = Awaited<ReturnType<typeof fetchListingLikes>>;
const likes = (ids: string[] = []): Likes => ({
  count: ids.length ? 1 : 0,
  myReactionIds: ids,
  myReactionId: ids[0] ?? null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockPubkey = 'viewer';
  mockRelays = [{ url: 'wss://relay.example', read: true }];
  mockPublish.mockResolvedValue('new-reaction');
  mockDelete.mockResolvedValue(true);
});

it('waits for the initial lookup and retracts every existing like on the first tap', async () => {
  const lookup = deferred<Likes>();
  jest.mocked(fetchListingLikes).mockReturnValue(lookup.promise);
  const hook = renderHook(() => useListingLike(product, jest.fn()));
  expect(hook.result.current.busy).toBe(true);
  await act(() => hook.result.current.toggle());
  expect(mockPublish).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
  await act(async () => lookup.resolve(likes(['original', 'duplicate'])));
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.liked).toBe(true);
  await act(() => hook.result.current.toggle());
  expect(mockDelete).toHaveBeenCalledWith('original', expect.any(Array));
  expect(mockDelete).toHaveBeenCalledWith('duplicate', expect.any(Array));
  expect(mockPublish).not.toHaveBeenCalled();
  expect(hook.result.current.liked).toBe(false);
  expect(hook.result.current.count).toBe(0);
});

it('ignores a pre-toggle refresh result after publish', async () => {
  const refresh = deferred<Likes>();
  jest
    .mocked(fetchListingLikes)
    .mockResolvedValueOnce(likes())
    .mockReturnValueOnce(refresh.promise);
  const hook = renderHook(() => useListingLike(product, jest.fn()));
  await act(async () => {});
  // A changed read-relay list triggers another focus lookup.
  mockRelays = [{ url: 'wss://other.example', read: true }];
  hook.rerender({});
  await act(() => hook.result.current.toggle());
  await act(async () => refresh.resolve(likes()));
  expect(hook.result.current.liked).toBe(true);
  expect(hook.result.current.count).toBe(1);
  await act(() => hook.result.current.toggle());
  expect(mockDelete).toHaveBeenCalledWith('new-reaction', expect.any(Array));
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(hook.result.current.liked).toBe(false);
});

it.each(['account', 'listing'])(
  'clears prior reaction ids on a %s change even if lookup fails',
  async (change) => {
    jest
      .mocked(fetchListingLikes)
      .mockResolvedValueOnce(likes(['old-reaction']))
      .mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(
      ({ item }: { item: typeof product }) => useListingLike(item, jest.fn()),
      { initialProps: { item: product } },
    );
    await act(async () => {});
    expect(hook.result.current.liked).toBe(true);
    if (change === 'account') mockPubkey = 'other-viewer';
    const item =
      change === 'listing'
        ? {
            ...product,
            listing: {
              ...product.listing!,
              event: { ...product.listing!.event, tags: [['d', 'other']] },
            },
          }
        : product;
    hook.rerender({ item });
    await act(async () => {});
    expect(hook.result.current.count).toBeNull();
    expect(hook.result.current.liked).toBe(false);
    await act(() => hook.result.current.toggle());
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  },
);

it('does not apply an old account mutation to the new account', async () => {
  const publish = deferred<string>();
  const lookup = deferred<Likes>();
  jest.mocked(fetchListingLikes).mockResolvedValueOnce(likes()).mockReturnValueOnce(lookup.promise);
  mockPublish.mockReturnValue(publish.promise);
  const hook = renderHook(() => useListingLike(product, jest.fn()));
  await act(async () => {});
  let mutation!: Promise<void>;
  act(() => {
    mutation = hook.result.current.toggle();
  });
  mockPubkey = 'other-viewer';
  hook.rerender({});
  await act(async () => {
    publish.resolve('old-account-reaction');
    await mutation;
  });
  expect(hook.result.current.count).toBeNull();
  expect(hook.result.current.liked).toBe(false);
  expect(hook.result.current.busy).toBe(true);
  await act(async () => lookup.resolve(likes(['new-account-reaction'])));
  await act(() => hook.result.current.toggle());
  expect(mockDelete).toHaveBeenCalledWith('new-account-reaction', expect.any(Array));
  expect(mockDelete).not.toHaveBeenCalledWith('old-account-reaction', expect.any(Array));
});

it('still requests sign-in before the lookup resolves', async () => {
  mockPubkey = null;
  jest.mocked(fetchListingLikes).mockReturnValue(deferred<Likes>().promise);
  const signIn = jest.fn();
  const hook = renderHook(() => useListingLike(product, signIn));
  expect(hook.result.current.busy).toBe(false);
  await act(() => hook.result.current.toggle());
  expect(signIn).toHaveBeenCalledTimes(1);
});
