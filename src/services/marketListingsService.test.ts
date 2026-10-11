import { finalizeEvent, getEventHash, getPublicKey, type Filter } from 'nostr-tools';
import { fetchMarketListings, listingsCutMattered } from './marketListingsService';
import { LISTING_LIMIT } from '../utils/marketListingsQuery';
import { nostrVerifyEvent } from './nostrCrypto';
import { __resetVerifiedEventCache } from './nostrVerifyCache';
jest.mock('./nostrPool', () => ({ pool: { ensureRelay: jest.fn() }, trackRelays: jest.fn() }));
jest.mock('./marketListingsPool', () => {
  const ensureRelay = jest.fn();
  const release = jest.fn();
  return {
    acquireMarketListingsPool: () => ({ pool: { ensureRelay }, release }),
    __mocks: { ensureRelay, release },
  };
});
const poolMocks = (
  jest.requireMock('./marketListingsPool') as {
    __mocks: { ensureRelay: jest.Mock; release: jest.Mock };
  }
).__mocks;
jest.mock('./nostrCrypto', () => {
  const actual = jest.requireActual('./nostrCrypto');
  return { ...actual, nostrVerifyEvent: jest.fn(actual.nostrVerifyEvent) };
});
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
type Ev = typeof event;
interface Callbacks {
  onevent: (e: Ev) => void;
  oneose: () => void;
  onclose: (reason: string) => void;
  receivedEvent?: () => void;
  alreadyHaveEvent?: (id: string) => boolean;
  eoseTimeout: number;
}
interface Sub {
  url: string;
  filters: Filter[];
  c: Callbacks;
}
const ensureRelay = poolMocks.ensureRelay;
const verify = nostrVerifyEvent as unknown as jest.Mock;
let subs: Sub[];
let close: jest.Mock;
/** Relays that accept connections; market relays are offline unless listed. */
let up: Set<string>;
/** Let mocked connections settle and subscriptions open. */
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
/** Deliver like the relay layer: count, skip known ids, then hand over. */
const deliver = (s: Sub, e: Ev) => {
  s.c.receivedEvent?.();
  if (!s.c.alreadyHaveEvent?.(e.id)) s.c.onevent(e);
};
const pass = (kind: 'listings' | 'deletions', url = 'wss://example.com') =>
  subs.filter((s) => s.url === url && (kind === 'deletions') === (s.filters[0].kinds?.[0] === 5));
const start = (relays = ['wss://example.com']) =>
  fetchMarketListings([author], relays, new AbortController().signal);
/** EOSE every open listing sub on `url`, then every deletion sub it triggers. */
const answer = async (url = 'wss://example.com') => {
  pass('listings', url).forEach((s) => s.c.oneose());
  await flush();
  pass('deletions', url).forEach((s) => s.c.oneose());
  await flush();
};
beforeEach(() => {
  jest.useFakeTimers();
  subs = [];
  close = jest.fn();
  up = new Set(['wss://example.com', 'wss://a.example', 'wss://b.example']);
  verify.mockClear();
  poolMocks.release.mockClear();
  __resetVerifiedEventCache();
  ensureRelay.mockReset();
  ensureRelay.mockImplementation((url: string) =>
    up.has(url)
      ? Promise.resolve({
          subscribe: (filters: Filter[], c: Callbacks) => {
            subs.push({ url, filters, c });
            return { close };
          },
        })
      : Promise.reject(new Error('offline')),
  );
});
afterEach(() => jest.useRealTimers());

it('asks for listings only, author-scoped, and rejects forged or unsolicited events', async () => {
  const pending = start();
  await flush();
  const [listings] = pass('listings');
  expect(listings.filters[0]).toEqual({
    kinds: [30018, 30402],
    authors: [author],
    limit: LISTING_LIMIT,
  });
  deliver(
    listings,
    JSON.parse(JSON.stringify({ ...event, id: '0'.repeat(64), sig: '0'.repeat(128) })),
  );
  deliver(
    listings,
    finalizeEvent(
      { kind: 30402, created_at: 100, content: 'Book', tags: event.tags },
      new Uint8Array(32).fill(8),
    ),
  );
  deliver(listings, event);
  await answer();
  expect((await pending).products).toHaveLength(1);
});

it('asks for deletions of the found listings only, on the relays that answered', async () => {
  up.add('wss://slow.example');
  const pending = start(['wss://example.com', 'wss://slow.example']);
  await flush();
  deliver(pass('listings')[0], event);
  pass('listings')[0].c.oneose();
  await flush();
  // Pass 2 starts once the grace for the silent relay has run out.
  jest.advanceTimersByTime(2000);
  await flush();
  const deletions = pass('deletions');
  expect(deletions.map((s) => s.filters[0])).toEqual([
    { kinds: [5], authors: [author], '#a': [`30402:${author}:book`], limit: 500 },
    { kinds: [5], authors: [author], '#e': [event.id], limit: 500 },
  ]);
  expect(pass('deletions', 'wss://slow.example')).toHaveLength(0);
  const del = finalizeEvent(
    { kind: 5, created_at: 300, content: '', tags: [['a', `30402:${author}:book`]] },
    key,
  );
  deliver(deletions[0], del);
  deletions.forEach((s) => s.c.oneose());
  expect(await pending).toEqual({ products: [], incomplete: false });
});

it('skips the deletion pass when no listings were found', async () => {
  const pending = start();
  await flush();
  pass('listings')[0].c.oneose();
  expect(await pending).toEqual({ products: [], incomplete: false });
  expect(pass('deletions')).toHaveLength(0);
});

it('does not wait for a dead relay once another relay has answered', async () => {
  ensureRelay.mockImplementation(
    (url: string) =>
      url === 'wss://example.com'
        ? Promise.resolve({
            subscribe: (filters: Filter[], c: Callbacks) => {
              subs.push({ url, filters, c });
              return { close };
            },
          })
        : new Promise(() => {}), // never connects
  );
  const pending = start(['wss://example.com', 'wss://dead.example']);
  await flush();
  deliver(pass('listings')[0], event);
  pass('listings')[0].c.oneose();
  await flush();
  jest.advanceTimersByTime(2000);
  await flush();
  pass('deletions').forEach((s) => s.c.oneose());
  const result = await pending;
  expect(result).toMatchObject({ incomplete: false, products: [expect.anything()] });
  expect(jest.getTimerCount()).toBe(0);
});

it('treats an unreachable relay as harmless when another relay answered', async () => {
  const pending = start(['wss://example.com', 'wss://down.example']);
  await flush();
  deliver(pass('listings')[0], event);
  await answer();
  expect(await pending).toMatchObject({ incomplete: false, products: [expect.anything()] });
});

it('reports incomplete when no relay answers at all', async () => {
  up.clear();
  expect(await start()).toEqual({ products: [], incomplete: true });
});

it('verifies each unique event once, and not again on a refetch', async () => {
  const run = async () => {
    const pending = start(['wss://a.example', 'wss://b.example']);
    await flush();
    for (const url of ['wss://a.example', 'wss://b.example']) {
      // Fresh objects each time, like a real relay delivery.
      deliver(pass('listings', url).at(-1)!, JSON.parse(JSON.stringify(event)));
    }
    await Promise.all([answer('wss://a.example'), answer('wss://b.example')]);
    return pending;
  };
  expect((await run()).products).toHaveLength(1);
  // One schnorr for the one unique event; the duplicate is skipped unparsed.
  expect(verify).toHaveBeenCalledTimes(1);
  expect((await run()).products).toHaveLength(1);
  expect(verify).toHaveBeenCalledTimes(1);
});

it('verifies only the winning revision, falling back past a forged newer one', async () => {
  const older = finalizeEvent(
    { kind: 30402, created_at: 50, content: 'Book', tags: event.tags },
    key,
  );
  // Correct id for its payload, but a signature that doesn't verify.
  const unsigned = { ...event, created_at: 900, content: 'Scam' };
  const forgedNewer = JSON.parse(
    JSON.stringify({ ...unsigned, id: getEventHash(unsigned), sig: '0'.repeat(128) }),
  );
  const pending = start();
  await flush();
  deliver(pass('listings')[0], older);
  deliver(pass('listings')[0], event);
  deliver(pass('listings')[0], forgedNewer);
  await answer();
  const result = await pending;
  expect(result.products.map((p) => p.listing?.event.id)).toEqual([event.id]);
  // forged (fails) + real winner (passes); the superseded older one is never checked.
  expect(verify).toHaveBeenCalledTimes(2);
});

it("doesn't let a forged copy carrying a real listing's id squat it", async () => {
  const squatter = JSON.parse(JSON.stringify({ ...event, content: 'Scam' })); // real id, wrong payload
  const pending = start(['wss://a.example', 'wss://b.example']);
  await flush();
  deliver(pass('listings', 'wss://a.example')[0], squatter);
  deliver(pass('listings', 'wss://b.example')[0], JSON.parse(JSON.stringify(event)));
  await Promise.all([answer('wss://a.example'), answer('wss://b.example')]);
  const result = await pending;
  expect(result.products.map((p) => p.listing?.event.content)).toEqual(['Book']);
});

it('keeps the genuine copy when a bad-signature copy of the same payload arrives first', async () => {
  const badSig = JSON.parse(JSON.stringify({ ...event, sig: '0'.repeat(128) })); // same id, bad sig
  const pending = start(['wss://a.example', 'wss://b.example']);
  await flush();
  deliver(pass('listings', 'wss://a.example')[0], badSig);
  deliver(pass('listings', 'wss://b.example')[0], JSON.parse(JSON.stringify(event)));
  await Promise.all([answer('wss://a.example'), answer('wss://b.example')]);
  expect((await pending).products.map((p) => p.listing?.event.sig)).toEqual([event.sig]);
});

it('asks for deletions on every relay that responded, not only those that finished', async () => {
  const pending = start(['wss://a.example', 'wss://b.example']);
  await flush();
  deliver(pass('listings', 'wss://b.example')[0], event); // b serves a listing but never EOSEs
  pass('listings', 'wss://a.example')[0].c.oneose();
  await flush();
  jest.advanceTimersByTime(2000);
  await flush();
  expect(pass('deletions', 'wss://b.example').length).toBeGreaterThan(0);
  const del = finalizeEvent(
    { kind: 5, created_at: 300, content: '', tags: [['e', event.id]] },
    key,
  );
  deliver(pass('deletions', 'wss://b.example')[1], del);
  pass('deletions', 'wss://a.example').forEach((s) => s.c.oneose());
  await flush();
  jest.advanceTimersByTime(2000);
  expect((await pending).products).toEqual([]);
});

it('honours deletions even when the listing budget is full', async () => {
  jest.useRealTimers();
  const pending = start();
  await flush();
  const [listings] = pass('listings');
  for (let i = 0; i < 1200; i++) {
    deliver(
      listings,
      finalizeEvent(
        {
          kind: 30402,
          created_at: 1000 + i,
          content: `Item ${i}`,
          tags: [
            ['d', `item-${i}`],
            ['title', `Item ${i}`],
            ['price', '1', 'SAT'],
          ],
        },
        key,
      ),
    );
  }
  listings.c.oneose();
  await flush();
  // The newest listing is withdrawn; its deletion arrives after the budget filled.
  const del = finalizeEvent(
    { kind: 5, created_at: 5000, content: '', tags: [['a', `30402:${author}:item-1199`]] },
    key,
  );
  deliver(pass('deletions')[0], del);
  pass('deletions').forEach((s) => s.c.oneose());
  const result = await pending;
  expect(result.products.some((p) => p.listing?.event.tags.some((t) => t[1] === 'item-1199'))).toBe(
    false,
  );
}, 60000);

it('gives up on a flood of forged signatures and flags the snapshot incomplete', async () => {
  jest.useRealTimers();
  const pending = start();
  await flush();
  for (let i = 0; i < 100; i++) {
    const unsigned = {
      ...event,
      created_at: 2000 + i,
      tags: [
        ['d', `fake-${i}`],
        ['title', 'Fake'],
        ['price', '1', 'SAT'],
      ],
    };
    deliver(
      pass('listings')[0],
      JSON.parse(JSON.stringify({ ...unsigned, id: getEventHash(unsigned), sig: '0'.repeat(128) })),
    );
  }
  deliver(pass('listings')[0], event);
  await answer();
  const result = await pending;
  expect(result.incomplete).toBe(true);
  expect(verify.mock.calls.length).toBeLessThanOrEqual(64);
}, 30000);

it('returns its dedicated relay pool lease when done, and on abort', async () => {
  const done = start();
  await flush();
  await answer();
  await done;
  expect(poolMocks.release).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const aborted = fetchMarketListings([author], ['wss://example.com'], controller.signal);
  await flush();
  controller.abort();
  await aborted;
  expect(poolMocks.release).toHaveBeenCalledTimes(2);
});

it('closes subscriptions on abort and ignores late relay events', async () => {
  const controller = new AbortController();
  const pending = fetchMarketListings([author], ['wss://example.com'], controller.signal);
  await flush();
  const [listings] = pass('listings');
  controller.abort();
  deliver(listings, event);
  listings.c.oneose();
  expect((await pending).products).toEqual([]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('returns explicit partial status on the deadline', async () => {
  const pending = start();
  await flush();
  deliver(pass('listings')[0], event);
  jest.advanceTimersByTime(10000);
  expect(await pending).toMatchObject({ incomplete: true, products: [expect.anything()] });
  expect(close).toHaveBeenCalledTimes(1);
});

it('does not issue unscoped queries for an empty follow list', async () => {
  expect(
    await fetchMarketListings([], ['wss://example.com'], new AbortController().signal),
  ).toEqual({ products: [], incomplete: false });
  expect(ensureRelay).not.toHaveBeenCalled();
});

it('also queries the marketplace relays where sellers publish', async () => {
  const pending = start();
  await flush();
  expect(ensureRelay.mock.calls.map((c) => c[0])).toEqual([
    'wss://relay.plebeian.market',
    'wss://nostr.mom',
    'wss://example.com',
  ]);
  await answer();
  await pending;
});

it('reports a relay that closes before EOSE as incomplete', async () => {
  const pending = start();
  await flush();
  pass('listings')[0].c.onclose('rate-limited');
  expect(await pending).toMatchObject({ incomplete: true });
});

it("keeps the relay's own EOSE timeout past the deadline so it can't fake a load", async () => {
  const pending = start();
  await flush();
  expect(pass('listings')[0].c.eoseTimeout).toBeGreaterThan(10000);
  await answer();
  expect(await pending).toMatchObject({ incomplete: false });
});

it('flags a reply that hit the listing limit even when results were duplicates', async () => {
  const pending = start(['wss://a.example', 'wss://b.example']);
  await flush();
  Array.from({ length: 60 }, () => event).forEach((e) =>
    deliver(pass('listings', 'wss://a.example')[0], e),
  );
  Array.from({ length: LISTING_LIMIT }, () => event).forEach((e) =>
    deliver(pass('listings', 'wss://b.example')[0], e),
  );
  await Promise.all([answer('wss://a.example'), answer('wss://b.example')]);
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
  const pending = start();
  await flush();
  deliver(pass('listings')[0], older);
  deliver(pass('listings')[0], newer);
  await answer();
  expect(await pending).toEqual({ products: [], incomplete: true });
});

it('bounds oversized-revision markers by the shared event budget', async () => {
  // Real timers: the trusted stand-ins pass through the yielding selection.
  jest.useRealTimers();
  const pending = start();
  await flush();
  const [listings] = pass('listings');
  // Repeated oversized revisions of ONE listing keep a single marker.
  for (let i = 0; i < 5; i++) {
    deliver(
      listings,
      finalizeEvent(
        { kind: 30402, created_at: 200 + i, content: 'x'.repeat(33000), tags: event.tags },
        key,
      ),
    );
  }
  // Oversized revisions of many DISTINCT listings stop at the shared budget
  // (MAX_EVENTS = 1200), so a noisy relay can't grow memory without bound.
  for (let i = 0; i < 1300; i++) {
    deliver(
      listings,
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
  deliver(listings, other);
  await answer();
  expect(await pending).toEqual({ products: [], incomplete: true });
}, 60000);

it('honours a bulk deletion with more tags than the per-event limit', async () => {
  const pending = start();
  await flush();
  deliver(pass('listings')[0], event);
  pass('listings')[0].c.oneose();
  await flush();
  const filler = Array.from({ length: 299 }, (_, i) => ['e', i.toString(16).padStart(64, '0')]);
  const bulkDelete = finalizeEvent(
    { kind: 5, created_at: 300, content: '', tags: [...filler, ['e', event.id]] },
    key,
  );
  deliver(pass('deletions')[1], bulkDelete);
  pass('deletions').forEach((s) => s.c.oneose());
  expect(await pending).toMatchObject({ products: [], incomplete: true });
});

it('hides an older listing behind a verified revision larger than 256 KB', async () => {
  const older = finalizeEvent(
    { kind: 30402, created_at: 100, content: 'Book', tags: event.tags },
    key,
  );
  const huge = finalizeEvent(
    { kind: 30402, created_at: 200, content: 'x'.repeat(300000), tags: event.tags },
    key,
  );
  const pending = start();
  await flush();
  deliver(pass('listings')[0], older);
  deliver(pass('listings')[0], huge);
  await answer();
  expect(await pending).toEqual({ products: [], incomplete: true });
});

it('keeps revision tie-breaking: a renderable revision with the lower id still wins', async () => {
  // Same address + timestamp; the reducer keeps the lowest id on a tie.
  let small = event;
  let big = event;
  for (let i = 0; ; i++) {
    small = finalizeEvent(
      { kind: 30402, created_at: 500, content: `Book ${i}`, tags: event.tags },
      key,
    );
    big = finalizeEvent(
      { kind: 30402, created_at: 500, content: 'x'.repeat(40000 + i), tags: event.tags },
      key,
    );
    if (small.id < big.id) break;
  }
  const pending = start();
  await flush();
  deliver(pass('listings')[0], big);
  deliver(pass('listings')[0], small);
  await answer();
  const result = await pending;
  expect(result.products.map((p) => p.listing?.event.id)).toEqual([small.id]);
});

it('paints a first page early and treats the display cap as complete', async () => {
  jest.useRealTimers();
  const listings = Array.from({ length: 251 }, (_, i) =>
    finalizeEvent(
      {
        kind: 30402,
        created_at: 1000 - i,
        content: `Item ${i}`,
        tags: [
          ['d', `item-${i}`],
          ['title', `Item ${i}`],
          ['price', '21', 'SAT'],
        ],
      },
      key,
    ),
  );
  const firstPage = jest.fn();
  const pending = fetchMarketListings(
    [author],
    ['wss://example.com'],
    new AbortController().signal,
    firstPage,
  );
  await flush();
  listings.forEach((e) => deliver(pass('listings')[0], e));
  await answer();
  const result = await pending;
  expect(firstPage).toHaveBeenCalledTimes(1);
  expect(firstPage.mock.calls[0][0][0].id).toBe(result.products[0].id);
  expect(result.products).toHaveLength(250);
  expect(result.incomplete).toBe(false);
}, 30000);

describe('listingsCutMattered', () => {
  const shown = (n: number, oldest: number) =>
    Array.from({ length: n }, (_, i) => ({
      listing: { event: { created_at: i === n - 1 ? oldest : oldest + 1000 } },
    })) as unknown as Parameters<typeof listingsCutMattered>[1];

  it('is false when nothing was cut off', () => {
    expect(listingsCutMattered(null, shown(3, 10), false)).toBe(false);
  });

  it('matters while the display still has room for older listings', () => {
    expect(listingsCutMattered(100, shown(3, 500), false)).toBe(true);
  });

  it("doesn't matter once the full display is newer than what was cut", () => {
    expect(listingsCutMattered(100, shown(250, 100), true)).toBe(false);
  });

  it('matters when the cut-off listings would have made the display', () => {
    expect(listingsCutMattered(100, shown(250, 99), true)).toBe(true);
  });
});
