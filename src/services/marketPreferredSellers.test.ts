import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent } from 'nostr-tools';
import { collectRelaySnapshot } from './relaySnapshot';
import {
  clearPreferredSellersMemory,
  fetchPreferredSellers,
  PREFERRED_SELLERS_ACCOUNT,
  PREFERRED_FOLLOWS_CACHE_KEY,
} from './marketPreferredSellers';
import { verifyEventCached } from './nostrVerifyCache';
jest.mock('./marketListingsPool', () => ({
  acquireMarketListingsPool: () => ({ pool: {}, release: jest.fn() }),
}));
jest.mock('./relaySnapshot', () => ({ collectRelaySnapshot: jest.fn() }));
jest.mock('./nostrVerifyCache', () => ({ verifyEventCached: jest.fn(() => true) }));
const snapshot = collectRelaySnapshot as jest.Mock;
const authors = ['a'.repeat(64), 'b'.repeat(64)];
beforeEach(() => {
  clearPreferredSellersMemory();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});
const follow = () => ({
  ...finalizeEvent(
    { kind: 3, created_at: 10, content: '', tags: authors.map((author) => ['p', author]) },
    new Uint8Array(32).fill(7),
  ),
  pubkey: PREFERRED_SELLERS_ACCOUNT,
});
it('loads only Lightning Piggy kind-3 follows with a bounded query and caches the verified scope', async () => {
  snapshot.mockImplementation(async (opts) => {
    opts.onEvent(follow());
    return { answered: opts.urls };
  });
  const signal = new AbortController().signal;
  expect(await fetchPreferredSellers(['wss://example.com'], signal)).toEqual(authors);
  expect(snapshot.mock.calls[0][0].filters).toEqual([
    { kinds: [3], authors: [PREFERRED_SELLERS_ACCOUNT], limit: 1 },
  ]);
  expect(verifyEventCached).toHaveBeenCalled();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    PREFERRED_FOLLOWS_CACHE_KEY,
    expect.any(String),
  );
  await fetchPreferredSellers(['wss://example.com'], signal);
  expect(snapshot).toHaveBeenCalledTimes(1);
});
it('hydrates stale follows immediately and retains them on relay failure', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
    JSON.stringify({ authors, at: Date.now() - 180000 }),
  );
  snapshot.mockRejectedValue(new Error('offline'));
  const cached = jest.fn();
  // Failed transport must retain the cached follow scope in the hook.
  await expect(
    fetchPreferredSellers(['wss://example.com'], new AbortController().signal, cached),
  ).rejects.toThrow('offline');
  expect(cached).toHaveBeenCalledWith(authors);
});
it('rejects forged follow lists instead of turning them into a successful empty catalogue', async () => {
  (verifyEventCached as jest.Mock).mockReturnValueOnce(false);
  snapshot.mockImplementation(async (opts) => {
    opts.onEvent(follow());
    return { answered: opts.urls };
  });
  await expect(
    fetchPreferredSellers(['wss://example.com'], new AbortController().signal),
  ).rejects.toThrow('No verified');
});
