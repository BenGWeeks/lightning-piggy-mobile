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
  expect(await fetchMarketCollections([product()], ['wss://example.com'])).toEqual({
    events: [],
    incomplete: false,
  });
  const filters = (queryQuorum as jest.Mock).mock.calls.map((c) => c[1]);
  expect(filters).toEqual([
    { kinds: [30405], authors: [pubkey], limit: 100 },
    { kinds: [5], authors: [pubkey], '#a': [`30405:${pubkey}:art`], limit: 200 },
    { kinds: [5], authors: [pubkey], '#e': ['first'], limit: 200 },
  ]);
  expect(verifiedOwnEvents).toHaveBeenCalledWith(
    [collection],
    pubkey,
    [30405],
    expect.any(AbortSignal),
  );
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
    expect(result.events).toHaveLength(100);
    expect(result.events.some((e) => e.id === 'event100')).toBe(false);
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
  expect(await fetchMarketCollections([listing], [])).toEqual({
    events: [referenced],
    incomplete: false,
  });
  expect(queryQuorum).toHaveBeenCalledWith(
    expect.any(Array),
    { kinds: [30405], authors: [foreign], '#d': ['art:prints'], limit: 5 },
    expect.any(AbortSignal),
  );
});

const referencedProducts = (count: number): MarketProduct[] =>
  Array.from({ length: count }, (_, i) => ({
    listing: { event: { pubkey, tags: [['a', `30405:${pubkey}:c${i}`]] } },
  })) as MarketProduct[];

it('does not re-query author-covered references on 7.5-second relays', async () => {
  jest.useFakeTimers();
  const events = Array.from({ length: 5 }, (_, i) => ({
    ...collection,
    id: `c${i}`,
    tags: [
      ['d', `c${i}`],
      ['title', `C${i}`],
    ],
  }));
  (queryQuorum as jest.Mock).mockImplementation(
    (_relays, filter) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(filter.kinds[0] === 30405 ? events : []), 7500),
      ),
  );
  try {
    const result = fetchMarketCollections(referencedProducts(5), []).catch(
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(20_000);
    expect(queryQuorum).toHaveBeenCalledTimes(3);
    expect(await result).toEqual({ events, incomplete: false });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('groups foreign references by author and validates exact identifiers', async () => {
  const foreign = 'b'.repeat(64);
  const listing = {
    listing: {
      event: {
        pubkey,
        tags: [
          ['a', `30405:${foreign}:c0`],
          ['a', `30405:${foreign}:c1`],
        ],
      },
    },
  } as MarketProduct;
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) =>
    filter['#d'] ? [collection, { ...collection, pubkey: foreign, tags: [['d', 'wrong']] }] : [],
  );
  const result = await fetchMarketCollections([listing], []);
  expect(queryQuorum).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ events: [], incomplete: false });
  expect(queryQuorum).toHaveBeenCalledWith(
    expect.any(Array),
    {
      kinds: [30405],
      authors: [foreign],
      '#d': ['c0', 'c1'],
      limit: 10,
    },
    expect.any(AbortSignal),
  );
});

it('retains deletion-checked batches when another batch hits the deadline', async () => {
  jest.useFakeTimers();
  const foreign = 'b'.repeat(64);
  const listing = {
    listing: { event: { pubkey, tags: [['a', `30405:${foreign}:slow`]] } },
  } as MarketProduct;
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) => {
    if (filter.authors.includes(foreign)) return new Promise(() => {});
    return filter.kinds[0] === 30405 ? [collection] : [];
  });
  try {
    const result = fetchMarketCollections([listing], []).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ events: [collection], incomplete: true });
    for (const [, , signal] of (queryQuorum as jest.Mock).mock.calls)
      expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('bounds the whole discovery and never starts queued queries after timeout', async () => {
  jest.useFakeTimers();
  const listings = Array.from({ length: 128 }, (_, i) => ({
    listing: {
      event: {
        pubkey,
        tags: [['a', `30405:${(i + 1).toString(16).padStart(64, '0')}:c`]],
      },
    },
  })) as MarketProduct[];
  (queryQuorum as jest.Mock).mockImplementation(() => new Promise(() => {}));
  try {
    const result = fetchMarketCollections(listings, []);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ events: [], incomplete: true });
    expect(queryQuorum).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('does not expose collections whose deletion checks miss the deadline', async () => {
  jest.useFakeTimers();
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) =>
    filter.kinds[0] === 30405 ? [collection] : new Promise(() => {}),
  );
  try {
    const result = fetchMarketCollections([product()], []);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ events: [], incomplete: true });
    expect(queryQuorum).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('cancels active discovery promptly on caller abort without starting queued work', async () => {
  const controller = new AbortController();
  (queryQuorum as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const result = fetchMarketCollections(referencedProducts(12), [], controller.signal);
  controller.abort();
  expect(await result).toEqual({ events: [], incomplete: true });
  expect(queryQuorum).toHaveBeenCalledTimes(1);
  for (const [, , signal] of (queryQuorum as jest.Mock).mock.calls) {
    expect(signal.aborted).toBe(true);
  }
});
