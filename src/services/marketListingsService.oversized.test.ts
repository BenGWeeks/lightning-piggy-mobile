import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { fetchMarketListings } from './marketListingsService';
import { collectRelaySnapshot } from './relaySnapshot';
import { nostrVerifyEvent } from './nostrCrypto';
import { __resetVerifiedEventCache } from './nostrVerifyCache';

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./marketListingsPool', () => ({
  acquireMarketListingsPool: () => ({ pool: {}, release: jest.fn() }),
}));
jest.mock('./relaySnapshot', () => ({ collectRelaySnapshot: jest.fn() }));
jest.mock('./nostrCrypto', () => {
  const pure = jest.requireActual('nostr-tools/pure');
  return { nostrGetEventHash: pure.getEventHash, nostrVerifyEvent: jest.fn(pure.verifyEvent) };
});

const sellerKey = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(8);
const seller = getPublicKey(sellerKey);
const other = getPublicKey(otherKey);
const listing = (d: string, oversized = false, key = sellerKey): Event =>
  finalizeEvent(
    {
      kind: 30402,
      created_at: oversized ? 200 : 100,
      content: oversized ? 'x'.repeat(33000) : 'Book',
      tags: [
        ['d', d],
        ['title', d],
        ['price', '21', 'SAT'],
      ],
    },
    key,
  );
const verify = nostrVerifyEvent as unknown as jest.Mock;
const snapshot = collectRelaySnapshot as jest.Mock;

beforeEach(() => {
  verify.mockClear();
  __resetVerifiedEventCache();
  snapshot.mockReset();
});

/** Separate JSON copies model the structure-only pool delivering from each relay. */
const relayListings = (events: Event[]) => {
  snapshot.mockImplementation(async (opts: Parameters<typeof collectRelaySnapshot>[0]) => {
    if (opts.filters[0]?.kinds?.[0] !== 5) {
      events.forEach((event) => opts.onEvent(JSON.parse(JSON.stringify(event))));
    }
    return { answered: opts.urls, responded: opts.urls, truncated: false, truncatedSince: null };
  });
};

it('withholds every listing of a seller exceeding 16 valid oversized checks, keeping other sellers', async () => {
  const safe = Array.from({ length: 12 }, (_, i) => listing(`other-book-${i}`, false, otherKey));
  const safeIds = safe.map((event) => event.id).sort();
  const firstPage = jest.fn();
  relayListings([
    listing('book'),
    ...safe,
    ...Array.from({ length: 17 }, (_, i) => listing(i === 16 ? 'book' : `big-${i}`, true)),
  ]);
  const result = await fetchMarketListings(
    [seller, other],
    ['wss://example.com'],
    new AbortController().signal,
    firstPage,
  );
  expect(result.products.map((product) => product.listing?.event.id).sort()).toEqual(safeIds);
  expect(result.incomplete).toBe(true);
  expect(verify.mock.calls.filter(([event]) => event.content.length > 32768)).toHaveLength(16);
  expect(
    verify.mock.calls.some(([event]) => event.pubkey === seller && event.content === 'Book'),
  ).toBe(false);
  expect(firstPage).toHaveBeenCalledTimes(1);
  expect(
    firstPage.mock.calls[0][0]
      .map((product: { listing?: { event: Event } }) => product.listing?.event.id)
      .sort(),
  ).toEqual(safeIds);
});

it('charges an oversized event delivered by three relays only once against the budget', async () => {
  const safe = listing('book');
  const duplicate = listing('big-duplicate', true);
  relayListings([
    safe,
    duplicate,
    duplicate,
    duplicate,
    ...Array.from({ length: 15 }, (_, i) => listing(`big-${i}`, true)),
  ]);
  const result = await fetchMarketListings(
    [seller],
    ['wss://a.example', 'wss://b.example', 'wss://c.example'],
    new AbortController().signal,
  );
  expect(result.products.map((product) => product.listing?.event.id)).toEqual([safe.id]);
  expect(verify.mock.calls.filter(([event]) => event.content.length > 32768)).toHaveLength(16);
  expect(result.incomplete).toBe(true);
});
