import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { fetchMarketCollections } from './marketCollectionsService';
import { queryQuorum, verifiedOwnEvents } from './marketSellerService';
jest.mock('./marketSellerService', () => ({
  queryQuorum: jest.fn(),
  verifiedOwnEvents: jest.fn(),
}));
const pubkey = 'a'.repeat(64);
const collection = {
  kind: 30405,
  pubkey,
  id: 'first',
  created_at: 100,
  content: '',
  sig: '',
  tags: [
    ['d', 'art'],
    ['title', 'Art'],
  ],
} as Event;
const product = (author = pubkey) => ({ listing: { event: { pubkey: author } } }) as MarketProduct;
beforeEach(() => {
  jest.clearAllMocks();
  (verifiedOwnEvents as jest.Mock).mockImplementation(
    async (events: Event[], author: string, kinds: number[]) =>
      events.filter((e) => e.pubkey === author && kinds.includes(e.kind)),
  );
});
it('queries bounded collection batches and targeted NIP-09 deletes and suppresses deleted collections', async () => {
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) =>
    filter.kinds[0] === 30405
      ? [collection]
      : [{ kind: 5, pubkey, created_at: 101, tags: [['a', `30405:${pubkey}:art`]] }],
  );
  expect(await fetchMarketCollections([product()], ['wss://example.com'])).toEqual([]);
  const filters = (queryQuorum as jest.Mock).mock.calls.map((c) => c[1]);
  expect(filters).toEqual([
    { kinds: [30405], authors: [pubkey], limit: 100 },
    { kinds: [5], authors: [pubkey], '#a': [`30405:${pubkey}:art`], limit: 200 },
    { kinds: [5], authors: [pubkey], '#e': ['first'], limit: 200 },
  ]);
  expect(verifiedOwnEvents).toHaveBeenCalledWith([collection], pubkey, [30405], undefined);
});
it('caps authors and relays while grouping author filters', async () => {
  (queryQuorum as jest.Mock).mockResolvedValue([]);
  const products = Array.from({ length: 200 }, (_, i) => product(i.toString(16).padStart(64, '0')));
  await fetchMarketCollections(
    products,
    Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example`),
  );
  expect(queryQuorum).toHaveBeenCalledTimes(4);
  for (const [relays, filter] of (queryQuorum as jest.Mock).mock.calls) {
    expect(relays.length).toBeLessThanOrEqual(8);
    expect(filter.authors.length).toBeLessThanOrEqual(32);
    expect(filter.limit).toBe(100);
  }
});
it('does not query when there are no signed listings or the request is aborted', async () => {
  await fetchMarketCollections([], []);
  const controller = new AbortController();
  controller.abort();
  await fetchMarketCollections([product()], [], controller.signal);
  expect(queryQuorum).not.toHaveBeenCalled();
});

it.each(['a', 'e'])(
  'checks %s deletions beyond the first 100 relay-union collections',
  async (tag) => {
    const events = Array.from({ length: 101 }, (_, i) => ({
      ...collection,
      id: `event${i}`,
      tags: [
        ['d', `c${i}`],
        ['title', `Collection ${i}`],
      ],
    }));
    const target = tag === 'a' ? `30405:${pubkey}:c100` : 'event100';
    (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) =>
      filter.kinds[0] === 30405
        ? events
        : filter[`#${tag}`]?.includes(target)
          ? [{ kind: 5, pubkey, created_at: 101, tags: [[tag, target]] }]
          : [],
    );
    const result = await fetchMarketCollections([product()], []);
    expect(result).toHaveLength(100);
    expect(result.some((e) => e.id === 'event100')).toBe(false);
    for (const [, filter] of (queryQuorum as jest.Mock).mock.calls) {
      expect(filter['#a']?.length ?? 0).toBeLessThanOrEqual(100);
      expect(filter['#e']?.length ?? 0).toBeLessThanOrEqual(100);
    }
  },
);
it('discovers exact collection references created by another author', async () => {
  const foreign = 'b'.repeat(64);
  const referenced = {
    ...collection,
    pubkey: foreign,
    tags: [
      ['d', 'art:prints'],
      ['title', 'Prints'],
    ],
  };
  const listing = {
    listing: { event: { pubkey, tags: [['a', `30405:${foreign}:art:prints`]] } },
  } as MarketProduct;
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) =>
    filter.kinds[0] === 30405 &&
    filter.authors.includes(foreign) &&
    filter['#d']?.includes('art:prints')
      ? [referenced]
      : [],
  );
  expect(await fetchMarketCollections([listing], [])).toEqual([referenced]);
  expect(queryQuorum).toHaveBeenCalledWith(
    expect.any(Array),
    { kinds: [30405], authors: [foreign], '#d': ['art:prints'], limit: 5 },
    undefined,
  );
});
