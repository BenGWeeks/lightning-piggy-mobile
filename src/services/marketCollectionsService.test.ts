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
    expect.any(AbortSignal),
  );
});

const referencedProducts = (count: number): MarketProduct[] =>
  Array.from({ length: count }, (_, i) => ({
    listing: { event: { pubkey, tags: [['a', `30405:${pubkey}:c${i}`]] } },
  })) as MarketProduct[];

it('runs discovery concurrently with at most four active queries and validates exact coordinates', async () => {
  jest.useFakeTimers();
  let active = 0;
  let peak = 0;
  (queryQuorum as jest.Mock).mockImplementation((_relays, filter) => {
    active++;
    peak = Math.max(peak, active);
    return new Promise<Event[]>((resolve) => {
      setTimeout(() => {
        active--;
        resolve(filter['#d'] ? [collection] : []);
      }, 100);
    });
  });
  try {
    const result = fetchMarketCollections(referencedProducts(12), []);
    await jest.advanceTimersByTimeAsync(400);
    expect(await result).toEqual([]); // Relay returned "art", never the requested c0…c11.
    expect(peak).toBe(4);
    expect(queryQuorum).toHaveBeenCalledTimes(13);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('bounds the whole discovery, cancels active queries and never starts queued queries after timeout', async () => {
  jest.useFakeTimers();
  (queryQuorum as jest.Mock).mockImplementation(() => new Promise(() => {}));
  try {
    const result = fetchMarketCollections(referencedProducts(128), []);
    const rejection = expect(result).rejects.toThrow('Collection discovery timed out');
    await jest.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(queryQuorum).toHaveBeenCalledTimes(4);
    for (const [, , signal] of (queryQuorum as jest.Mock).mock.calls) {
      expect(signal.aborted).toBe(true);
    }
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('includes deletion checks in the overall deadline and discards unverified deletion state', async () => {
  jest.useFakeTimers();
  (queryQuorum as jest.Mock).mockImplementation(async (_relays, filter) => {
    if (filter.kinds[0] === 30405) return [collection];
    return new Promise(() => {});
  });
  try {
    const result = fetchMarketCollections([product()], []);
    const rejection = expect(result).rejects.toThrow('Collection discovery timed out');
    await jest.advanceTimersByTimeAsync(20_000);
    await rejection;
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
  expect(await result).toEqual([]);
  expect(queryQuorum).toHaveBeenCalledTimes(4);
  for (const [, , signal] of (queryQuorum as jest.Mock).mock.calls) {
    expect(signal.aborted).toBe(true);
  }
});
