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
