import type { Event } from 'nostr-tools';
import {
  __resetEmbedCacheForTests,
  peekEmbed,
  resolveEmbed,
  type EmbedRef,
} from './nostrEmbedCache';

const mockQuery = jest.fn();
const mockRevision = jest.fn();
const mockValid = jest.fn((e: Event) => e.sig !== 'bad');

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({
  querySyncAbortable: (...args: unknown[]) => mockQuery(...args),
}));
jest.mock('./marketListingsService', () => ({
  fetchListingRevision: (...args: unknown[]) => mockRevision(...args),
}));
jest.mock('../utils/eventSignature', () => ({
  hasValidSignature: (e: Event) => mockValid(e),
}));
jest.mock('../utils/marketListings', () => ({
  parseMarketListing: (e: Event) => ({ id: `p-${e.id}`, listing: { event: e } }),
}));

const PK = 'a'.repeat(64);
const id = (c: string) => c.repeat(64);
const ev = (over: Partial<Event>): Event => ({
  id: id('1'),
  pubkey: PK,
  kind: 1,
  created_at: 100,
  content: 'hi',
  tags: [],
  sig: 'ok',
  ...over,
});
const eventRef = (eid: string, relays: string[] = []): EmbedRef => ({
  type: 'event',
  id: eid,
  relays,
  raw: '',
});
const addrRef = (kind: number, identifier: string): EmbedRef => ({
  type: 'address',
  kind,
  pubkey: PK,
  identifier,
  relays: [],
  raw: '',
});

beforeEach(() => {
  jest.useFakeTimers();
  __resetEmbedCacheForTests();
  mockQuery.mockReset();
  mockRevision.mockReset();
  mockValid.mockClear();
});
afterEach(() => jest.useRealTimers());

async function settle<T>(p: Promise<T>): Promise<T> {
  await jest.advanceTimersByTimeAsync(100);
  return p;
}

it('batches concurrent event refs into one bounded ids query', async () => {
  mockQuery.mockResolvedValue([ev({ id: id('1') }), ev({ id: id('2') })]);
  const a = resolveEmbed(eventRef(id('1')), ['wss://read']);
  const b = resolveEmbed(eventRef(id('2'), ['wss://hint']), ['wss://read']);
  const [ra, rb] = await settle(Promise.all([a, b]));
  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [, relays, filter, opts] = mockQuery.mock.calls[0];
  expect(relays).toEqual(['wss://read', 'wss://hint']);
  expect(filter).toEqual({ ids: [id('1'), id('2')], limit: 2 });
  expect(opts.maxWait).toBeGreaterThan(0);
  expect(ra.event?.id).toBe(id('1'));
  expect(rb.event?.id).toBe(id('2'));
});

it('serves repeats from the cache and de-dupes in-flight requests', async () => {
  mockQuery.mockResolvedValue([ev({ id: id('1') })]);
  const first = resolveEmbed(eventRef(id('1')), ['wss://read']);
  const again = resolveEmbed(eventRef(id('1')), ['wss://read']);
  expect(again).toBe(first);
  await settle(first);
  expect(peekEmbed(`e:${id('1')}`)?.event?.id).toBe(id('1'));
  await settle(resolveEmbed(eventRef(id('1')), ['wss://read']));
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

it('rejects bad signatures and events that do not match the ref', async () => {
  mockQuery.mockResolvedValue([ev({ id: id('1'), sig: 'bad' }), ev({ id: id('9') })]);
  const r = await settle(resolveEmbed(eventRef(id('1')), ['wss://read']));
  expect(r.event).toBeNull();
});

it('caches misses only briefly', async () => {
  mockQuery.mockResolvedValue([]);
  await settle(resolveEmbed(eventRef(id('3')), ['wss://read']));
  expect(peekEmbed(`e:${id('3')}`)).toEqual({ event: null });
  jest.setSystemTime(Date.now() + 3 * 60 * 1000);
  expect(peekEmbed(`e:${id('3')}`)).toBeUndefined();
});

it('re-fetches addressable events after a while but keeps notes', async () => {
  mockQuery.mockResolvedValueOnce([ev({ id: id('8') })]);
  await settle(resolveEmbed(eventRef(id('8')), ['wss://read']));
  mockQuery.mockResolvedValueOnce([ev({ id: id('9'), kind: 30023, tags: [['d', 'a']] })]);
  await settle(resolveEmbed(addrRef(30023, 'a'), ['wss://read']));
  jest.setSystemTime(Date.now() + 11 * 60 * 1000);
  expect(peekEmbed(`e:${id('8')}`)?.event?.id).toBe(id('8'));
  expect(peekEmbed(`a:30023:${PK}:a`)).toBeUndefined();
});

it('picks the newest revision of an addressed article', async () => {
  const d = (v: string) => [['d', v]];
  mockQuery.mockResolvedValue([
    ev({ id: id('4'), kind: 30023, created_at: 100, tags: d('post') }),
    ev({ id: id('5'), kind: 30023, created_at: 200, tags: d('post') }),
    ev({ id: id('6'), kind: 30023, created_at: 300, tags: d('other') }),
  ]);
  const r = await settle(resolveEmbed(addrRef(30023, 'post'), ['wss://read']));
  expect(mockQuery.mock.calls[0][2]).toEqual({
    kinds: [30023],
    authors: [PK],
    '#d': ['post'],
    limit: 3,
  });
  expect(r.event?.id).toBe(id('5'));
});

it('applies the seller deletions to an embedded product', async () => {
  const listing = ev({ id: id('7'), kind: 30402, tags: [['d', 'mug']] });
  mockQuery.mockResolvedValue([listing]);
  mockRevision.mockResolvedValue(null); // withdrawn
  const r = await settle(resolveEmbed(addrRef(30402, 'mug'), ['wss://read']));
  expect(mockRevision).toHaveBeenCalledWith(listing, ['wss://read'], expect.anything(), 5000);
  expect(r.product).toBeNull();
});
