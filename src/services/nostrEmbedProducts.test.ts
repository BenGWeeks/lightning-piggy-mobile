import { finalizeEvent, getPublicKey, type Event, type Filter } from 'nostr-tools';
import { reconcileEmbedProducts } from './nostrEmbedProducts';
import { querySyncAbortable } from './relayQuery';
import { acquireMarketListingsPool } from './marketListingsPool';

const mockRelease = jest.fn();
const mockYield = jest.fn(async () => {});
const mockDispose = jest.fn();
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('./marketListingsPool', () => ({
  acquireMarketListingsPool: jest.fn(() => ({ pool: {}, release: mockRelease })),
}));
jest.mock('../contexts/nostrDecryptPacing', () => ({
  createYieldScheduler: () => ({ maybeYield: mockYield, dispose: mockDispose }),
}));
const query = jest.mocked(querySyncAbortable);
const key = new Uint8Array(32).fill(7);
const seller = getPublicKey(key);
const listing = (d: string, at = 100) =>
  finalizeEvent(
    {
      kind: 30402,
      created_at: at,
      content: 'Product',
      tags: [
        ['d', d],
        ['title', d],
        ['price', '21', 'SAT'],
      ],
    },
    key,
  );
const deletion = (tags: string[][]) =>
  finalizeEvent({ kind: 5, created_at: 300, content: '', tags }, key);
const relays = ['wss://read'];
beforeEach(() => jest.clearAllMocks());

it('reconciles twenty seller products in three bounded queries, including address and revision-id deletions', async () => {
  const current = Array.from({ length: 20 }, (_, i) => listing(`item-${i}`));
  const newer = listing('item-1', 200);
  const deleted = [deletion([['a', `30402:${seller}:item-0`]]), deletion([['e', newer.id]])];
  query.mockImplementation(async (_pool, _relays, filter: Filter) =>
    filter.kinds?.includes(5) ? deleted : [newer],
  );
  const result = await reconcileEmbedProducts(current, relays, 5000);
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls[0][2]).toEqual({
    kinds: [30402],
    authors: [seller],
    '#d': current.map((_, i) => `item-${i}`),
    limit: 200,
  });
  expect(query.mock.calls[2][2]['#e']).toContain(newer.id);
  expect(result.get(current[0].id)).toBeNull();
  expect(result.get(current[1].id)).toBeNull();
  expect(result.get(current[2].id)?.listing?.event.id).toBe(current[2].id);
  expect(mockYield).toHaveBeenCalled();
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(acquireMarketListingsPool).toHaveBeenCalledWith(relays);
});

it('ignores unsolicited and forged revisions and deletions', async () => {
  const current = listing('book');
  const forged = (event: Event): Event => ({
    ...JSON.parse(JSON.stringify(event)),
    sig: '0'.repeat(128),
  });
  query.mockImplementation(async (_pool, _relays, filter) =>
    filter.kinds?.includes(5)
      ? [forged(deletion([['e', current.id]]))]
      : [forged(listing('book', 200)), listing('other', 300)],
  );
  const result = await reconcileEmbedProducts([current], relays, 5000);
  expect(result.get(current.id)?.listing?.event.id).toBe(current.id);
});

it('releases transient sockets even on query failure', async () => {
  query.mockRejectedValue(new Error('offline'));
  const current = listing('book');
  const result = await reconcileEmbedProducts([current], relays, 5000);
  expect(result.get(current.id)?.listing?.event.id).toBe(current.id);
  expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(mockDispose).toHaveBeenCalledTimes(1);
});

it('keeps a successfully withdrawn product hidden when another seller fails', async () => {
  const current = listing('book');
  const otherKey = new Uint8Array(32).fill(8);
  const other = finalizeEvent(
    {
      kind: 30402,
      created_at: 100,
      content: 'Product',
      tags: [
        ['d', 'other'],
        ['title', 'Other'],
        ['price', '21', 'SAT'],
      ],
    },
    otherKey,
  );
  const del = deletion([['e', current.id]]);
  query.mockImplementation(async (_pool, _relays, filter) => {
    if (filter.authors?.includes(other.pubkey)) throw new Error('offline');
    return filter.kinds?.includes(5) ? [del] : [];
  });
  const result = await reconcileEmbedProducts([current, other], relays, 5000);
  expect(result.get(current.id)).toBeNull();
  expect(result.get(other.id)?.listing?.event.id).toBe(other.id);
});
