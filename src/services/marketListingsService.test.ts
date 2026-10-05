import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { fetchMarketListings } from './marketListingsService';
import { pool } from './nostrPool';
jest.mock('./nostrPool', () => ({ pool: { subscribeMany: jest.fn() }, trackRelays: jest.fn() }));
const key = new Uint8Array(32).fill(7);
const author = getPublicKey(key);
const event = finalizeEvent(
  {
    kind: 30402,
    created_at: 100,
    content: 'Book',
    tags: [
      ['d', 'book'],
      ['title', 'Book'],
      ['price', '21', 'SAT'],
    ],
  },
  key,
);
const subscribe = pool.subscribeMany as jest.Mock;
let callbacks: { onevent: (e: typeof event) => void; oneose: () => void };
let close: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  subscribe.mockReset();
  close = jest.fn();
  subscribe.mockImplementation((_urls, _filter, c) => {
    callbacks = c;
    return { close };
  });
});
afterEach(() => jest.useRealTimers());
it('author scopes relay queries and rejects forged signatures and unsolicited authors', async () => {
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  expect(subscribe.mock.calls[0][1]).toMatchObject({ authors: [author], kinds: [30018, 30402, 5] });
  callbacks.onevent(
    JSON.parse(JSON.stringify({ ...event, id: '0'.repeat(64), sig: '0'.repeat(128) })),
  );
  callbacks.onevent(
    finalizeEvent(
      { kind: 30402, created_at: 100, content: 'Book', tags: event.tags },
      new Uint8Array(32).fill(8),
    ),
  );
  callbacks.onevent(event);
  callbacks.oneose();
  expect((await pending).products).toHaveLength(1);
  expect(close).toHaveBeenCalledTimes(1);
});
it('closes subscriptions on abort and ignores late relay events', async () => {
  const controller = new AbortController();
  const pending = fetchMarketListings([author], ['wss://example.com'], controller.signal);
  controller.abort();
  callbacks.onevent(event);
  callbacks.oneose();
  expect((await pending).products).toEqual([]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('returns explicit partial status on deadline and when no usable relay exists', async () => {
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  callbacks.onevent(event);
  jest.advanceTimersByTime(12000);
  expect(await pending).toMatchObject({ incomplete: true, products: [expect.anything()] });
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fetchMarketListings([author], [], new AbortController().signal)).toEqual({
    products: [],
    incomplete: true,
  });
});
it('does not issue unscoped queries for an empty follow list', async () => {
  expect(
    await fetchMarketListings([], ['wss://example.com'], new AbortController().signal),
  ).toEqual({ products: [], incomplete: false });
  expect(subscribe).not.toHaveBeenCalled();
});
