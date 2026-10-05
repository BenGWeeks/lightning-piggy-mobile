import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { fetchMarketListings } from './marketListingsService';
import { pool } from './nostrPool';
jest.mock('./nostrPool', () => ({ pool: { ensureRelay: jest.fn() }, trackRelays: jest.fn() }));
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
const ensureRelay = pool.ensureRelay as jest.Mock;
const subscribe = jest.fn();
let callbacks: {
  onevent: (e: typeof event) => void;
  oneose: () => void;
  onclose: (reason: string) => void;
  eoseTimeout: number;
};
let close: jest.Mock;
/** Let the mocked relay connection resolve and its subscriptions open. */
const opened = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  jest.useFakeTimers();
  subscribe.mockReset();
  ensureRelay.mockReset();
  ensureRelay.mockResolvedValue({ subscribe });
  close = jest.fn();
  subscribe.mockImplementation((_filters, c) => {
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
  await opened();
  expect(subscribe.mock.calls[0][0][0]).toMatchObject({
    authors: [author],
    kinds: [30018, 30402, 5],
  });
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
  await opened();
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
  await opened();
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
it('reports a relay that fails to connect as incomplete, not loaded', async () => {
  ensureRelay.mockReset();
  ensureRelay.mockImplementation((url: string) =>
    url === 'wss://down.example'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ subscribe }),
  );
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com', 'wss://down.example'],
    new AbortController().signal,
  );
  await opened();
  callbacks.onevent(event);
  callbacks.oneose();
  expect(await pending).toMatchObject({ incomplete: true, products: [expect.anything()] });
});
it('reports a relay that closes before EOSE as incomplete', async () => {
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  await opened();
  callbacks.onclose('rate-limited');
  expect(await pending).toMatchObject({ incomplete: true });
});
it("keeps the relay's own EOSE timeout past the deadline so it can't fake a load", async () => {
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  await opened();
  expect(callbacks.eoseTimeout).toBeGreaterThan(12000);
  callbacks.oneose();
  expect(await pending).toMatchObject({ incomplete: false });
});
it('flags a relay that hit its 100-result limit even when some results were duplicates', async () => {
  const subs: (typeof callbacks)[] = [];
  subscribe.mockImplementation((_filters, c) => {
    subs.push(c);
    return { close };
  });
  const pending = fetchMarketListings(
    [author],
    ['wss://a.example', 'wss://b.example'],
    new AbortController().signal,
  );
  await opened();
  const same = Array.from({ length: 60 }, () => event);
  same.forEach((e) => subs[0].onevent(e)); // relay A: 60 (all the same listing)
  subs[0].oneose();
  Array.from({ length: 100 }, () => event).forEach((e) => subs[1].onevent(e)); // relay B: 100
  subs[1].oneose();
  expect(await pending).toMatchObject({ incomplete: true });
});
it('lets an oversized newer revision hide the older one instead of resurrecting it', async () => {
  const older = finalizeEvent(
    { kind: 30402, created_at: 100, content: 'Book', tags: event.tags },
    key,
  );
  const newer = finalizeEvent(
    { kind: 30402, created_at: 200, content: 'x'.repeat(40000), tags: event.tags },
    key,
  );
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  await opened();
  callbacks.onevent(older);
  callbacks.onevent(newer);
  callbacks.oneose();
  expect(await pending).toEqual({ products: [], incomplete: true });
});
it('bounds oversized-revision markers by the shared event budget', async () => {
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
  );
  await opened();
  // Repeated oversized revisions of ONE listing keep a single marker.
  for (let i = 0; i < 5; i++) {
    callbacks.onevent(
      finalizeEvent(
        { kind: 30402, created_at: 200 + i, content: 'x'.repeat(33000), tags: event.tags },
        key,
      ),
    );
  }
  // Oversized revisions of many DISTINCT listings stop at the shared budget
  // (MAX_EVENTS = 1200), so a noisy relay can't grow memory without bound.
  for (let i = 0; i < 1300; i++) {
    callbacks.onevent(
      finalizeEvent(
        {
          kind: 30402,
          created_at: 200,
          content: 'x'.repeat(33000),
          tags: [
            ['d', `big-${i}`],
            ['title', 'Big'],
          ],
        },
        key,
      ),
    );
  }
  // With the budget spent, a normal listing is dropped and the result is partial.
  const other = finalizeEvent(
    {
      kind: 30402,
      created_at: 100,
      content: 'Pen',
      tags: [
        ['d', 'pen'],
        ['title', 'Pen'],
        ['price', '5', 'SAT'],
      ],
    },
    key,
  );
  callbacks.onevent(other);
  callbacks.oneose();
  expect(await pending).toEqual({ products: [], incomplete: true });
}, 60000);
