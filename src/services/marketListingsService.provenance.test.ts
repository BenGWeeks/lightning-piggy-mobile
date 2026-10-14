// Relay provenance for the stale-while-revalidate merge: which relays served
// each listing, which answered, and which carried-over listings a deletion
// now withdraws.
import { finalizeEvent, getPublicKey, type Event, type Filter } from 'nostr-tools';
import { fetchMarketListings } from './marketListingsService';
import { collectRelaySnapshot } from './relaySnapshot';
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

const key = new Uint8Array(32).fill(7);
const author = getPublicKey(key);
const SHOP = 'wss://relay.plebeian.market';
const FAMILY = 'wss://relay.weeksfamily.me';
const listing = (d: string, createdAt = 100): Event =>
  finalizeEvent(
    {
      kind: 30402,
      created_at: createdAt,
      content: d,
      tags: [
        ['d', d],
        ['title', d],
        ['price', '21', 'SAT'],
      ],
    },
    key,
  );
const snapshot = collectRelaySnapshot as jest.Mock;
const copy = (event: Event): Event => JSON.parse(JSON.stringify(event));

/** Each relay serves its listings (pass 1) and deletions (pass 2) and answers. */
function relays(served: Record<string, { listings?: Event[]; deletions?: Event[] }>) {
  const filters: Filter[][] = [];
  snapshot.mockImplementation(async (opts: Parameters<typeof collectRelaySnapshot>[0]) => {
    filters.push([...opts.filters]);
    const deletionPass = opts.filters[0]?.kinds?.[0] === 5;
    for (const url of opts.urls)
      for (const event of (deletionPass ? served[url]?.deletions : served[url]?.listings) ?? [])
        opts.onEvent(copy(event), url);
    const answered = opts.urls.filter((url) => url in served);
    return { answered, responded: answered, truncated: false, truncatedSince: null };
  });
  return filters;
}

beforeEach(() => {
  __resetVerifiedEventCache();
  snapshot.mockReset();
});

it('records which relays served each listing, and which relays answered', async () => {
  const book = listing('book');
  relays({ [SHOP]: { listings: [book] }, [FAMILY]: { listings: [book] } });
  const result = await fetchMarketListings([author], [SHOP, FAMILY], new AbortController().signal);
  expect(result.answeredRelays?.sort()).toEqual([SHOP, FAMILY].sort());
  expect(result.products[0].listing?.seenOn?.sort()).toEqual([SHOP, FAMILY].sort());
  expect(result.withdrawn).toEqual([]);
});

it('reports a served-but-hidden listing as withdrawn so a merge cannot keep it', async () => {
  const scarf = listing('scarf');
  const deletion = finalizeEvent(
    { kind: 5, created_at: 300, content: '', tags: [['a', `30402:${author}:scarf`]] },
    key,
  );
  relays({ [FAMILY]: { listings: [scarf], deletions: [deletion] } });
  const result = await fetchMarketListings([author], [FAMILY], new AbortController().signal);
  expect(result.products).toEqual([]);
  expect(result.withdrawn).toEqual([`nostr-30402-${author}-scarf`]);
});

it('looks up deletions for carried-over listings and reports them withdrawn', async () => {
  const book = listing('book');
  const mug = listing('mug', 90);
  const deletion = finalizeEvent(
    { kind: 5, created_at: 300, content: '', tags: [['a', `30402:${author}:mug`]] },
    key,
  );
  // The mug's own relay is silent; its deletion turns up on another relay.
  const filters = relays({ [SHOP]: { listings: [book], deletions: [deletion] } });
  const result = await fetchMarketListings(
    [author],
    [SHOP, FAMILY],
    new AbortController().signal,
    undefined,
    { carried: [mug] },
  );
  expect(filters[1][0]['#a']).toEqual(
    expect.arrayContaining([`30402:${author}:book`, `30402:${author}:mug`]),
  );
  expect(result.products.map((p) => p.title)).toEqual(['book']);
  expect(result.withdrawn).toEqual([`nostr-30402-${author}-mug`]);
});

it('ignores carried listings outside the current follow scope', async () => {
  const stranger = finalizeEvent(
    { kind: 30402, created_at: 1, content: '', tags: [['d', 'x']] },
    new Uint8Array(32).fill(9),
  );
  const filters = relays({ [SHOP]: {} });
  await fetchMarketListings([author], [SHOP], new AbortController().signal, undefined, {
    carried: [stranger],
  });
  // No listings and no in-scope carried events: pass 2 never runs.
  expect(filters).toHaveLength(1);
});
