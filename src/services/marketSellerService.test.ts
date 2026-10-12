import { resolveCurrentRevision, StaleRevisionError } from '../utils/marketSellerRevision';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import {
  fetchSellerEvents,
  fetchLatestRevision,
  queryQuorum,
  verifiedOwnEvents,
  loadHiddenListings,
  loadSellerCache,
  persistSellerSnapshot,
  publishSellerEvent,
  saveHiddenListings,
  sellerRelays,
} from './marketSellerService';
import {
  addSellerEvents,
  forgetSellerAccount,
  resetSellerStore,
  restoreSellerAccount,
  reviveSellerAccount,
  sellerStoreState,
  setSellerHidden,
} from './sellerEventStore';
import { querySyncAbortable } from './relayQuery';
import { publishSignedEvent } from './nostrService';
import { pool } from './nostrPool';
import {
  buildDeletionTemplate,
  buildListingTemplate,
  buildShippingZoneTemplate,
  buildShopTemplate,
  coordinateOf,
  type EventTemplate,
} from '../utils/marketSellerEvents';

jest.mock('./nostrService', () => ({
  pool: {},
  trackRelays: jest.fn(),
  DEFAULT_RELAYS: ['wss://default.example'],
  publishSignedEvent: jest.fn((...args: unknown[]) =>
    jest.requireActual('./nostrEventPublish').publishSignedEvent(...args),
  ),
}));
jest.mock('./nostrPool', () => ({ pool: { publish: jest.fn() }, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));

const key = new Uint8Array(32).fill(9);
const pubkey = getPublicKey(key);
const sign = (t: EventTemplate, created_at = 100): Event =>
  finalizeEvent({ ...t, created_at }, key);
const listing = (d: string, created_at = 100) =>
  sign(
    buildListingTemplate({
      draft: {
        dTag: d,
        title: `TEST ${d}`,
        description: '',
        images: [],
        price: '1',
        currency: 'GBP',
        quantity: '',
        categories: [],
        shipping: [],
      },
      pubkey,
      nowSeconds: created_at,
    }),
    created_at,
  );

beforeEach(async () => {
  resetSellerStore();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('sellerRelays', () => {
  it('uses the write relays (wss only, deduped, capped) and falls back to defaults', () => {
    const relays = Array.from({ length: 10 }, (_, i) => ({
      url: `wss://r${i}.example`,
      read: true,
      write: true,
    }));
    expect(sellerRelays(relays)).toHaveLength(8);
    expect(
      sellerRelays([
        { url: 'wss://w.example', read: false, write: true },
        { url: 'wss://w.example', read: false, write: true },
        { url: 'ws://insecure.example', read: false, write: true },
        { url: 'wss://read-only.example', read: true, write: false },
      ]),
    ).toEqual(['wss://w.example']);
    expect(sellerRelays([])).toEqual(['wss://default.example']);
  });
});

describe('fetchSellerEvents', () => {
  it('runs bounded, fail-closed queries and keeps only verified own events', async () => {
    const mine = listing('a');
    const theirs = finalizeEvent(
      { kind: 30402, created_at: 1, content: '', tags: [['d', 'x']] },
      new Uint8Array(32).fill(1),
    );
    const note = sign({ kind: 1, content: 'gm', tags: [] });
    (querySyncAbortable as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mine, theirs, note])
      .mockResolvedValueOnce([]);
    await expect(fetchSellerEvents({ pubkey, relays: ['wss://r.example'] })).resolves.toEqual([
      mine,
    ]);
    const calls = (querySyncAbortable as jest.Mock).mock.calls;
    // Kind 5 is shared with other features: market deletions are their own
    // `#k`-filtered query so they can't crowd the shop or listings out.
    expect(calls.map((c) => c[2])).toEqual([
      { kinds: [30405, 30406], authors: [pubkey], limit: 100 },
      { kinds: [30402], authors: [pubkey], limit: 300 },
      { kinds: [5], authors: [pubkey], '#k': ['30402', '30406', '30405'], limit: 200 },
    ]);
    for (const call of calls)
      expect(call[3]).toEqual(
        expect.objectContaining({
          maxWait: 8000,
          rejectOnAllRelaysFailure: true,
          rejectOnTimeout: true,
        }),
      );
  });

  it('fails on a relay timeout instead of returning an empty "no shop"', async () => {
    (querySyncAbortable as jest.Mock)
      .mockRejectedValueOnce(new Error('Relay query timed out before EOSE'))
      .mockResolvedValue([]);
    await expect(fetchSellerEvents({ pubkey, relays: ['wss://r.example'] })).rejects.toThrow(
      'Only 0 of 1 relays answered',
    );
  });
});

describe('queryQuorum', () => {
  const filter = { kinds: [30405], authors: ['a'.repeat(64)], limit: 5 };
  it('counts an answer only when at least half the relays complete', async () => {
    const shop = listing('s');
    (querySyncAbortable as jest.Mock)
      .mockResolvedValueOnce([shop])
      .mockRejectedValueOnce(new Error('Relay query timed out before EOSE'))
      .mockResolvedValueOnce([]);
    await expect(queryQuorum(['wss://a', 'wss://b', 'wss://c'], filter)).resolves.toEqual([shop]);
    // One relay per query, each failing closed on its own timeout.
    expect((querySyncAbortable as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      ['wss://a'],
      ['wss://b'],
      ['wss://c'],
    ]);
  });
  it('is "unknown" (rejects) when most relays time out, even if one says empty', async () => {
    (querySyncAbortable as jest.Mock)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('timed out'))
      .mockRejectedValueOnce(new Error('timed out'));
    await expect(queryQuorum(['wss://a', 'wss://b', 'wss://c'], filter)).rejects.toThrow(
      'Only 1 of 3',
    );
  });
});

describe('verifiedOwnEvents', () => {
  it('drops a forged "own" event (bad signature) and other authors', async () => {
    const real = listing('a', 100);
    const forged = { ...listing('a', 200), content: 'PAY ME ELSEWHERE' };
    const foreign = finalizeEvent(
      { kind: 30402, created_at: 300, content: '', tags: [['d', 'a']] },
      new Uint8Array(32).fill(1),
    );
    await expect(verifiedOwnEvents([real, forged, foreign], pubkey, [30402])).resolves.toEqual([
      real,
    ]);
  });
});

describe('verifiedOwnEvents dedupe', () => {
  it('a forged copy reusing a real id first does not hide the genuine copy', async () => {
    const real = listing('a', 100);
    const forgedSameId = { ...real, content: 'tampered' };
    await expect(verifiedOwnEvents([forgedSameId, real], pubkey, [30402])).resolves.toEqual([real]);
  });
});

describe('fetchLatestRevision', () => {
  it('returns the newest verified revision of exactly that coordinate, failing closed', async () => {
    const v1 = listing('a', 100);
    const v2 = listing('a', 200);
    const forged = { ...listing('a', 300), sig: 'f'.repeat(128) };
    const other = listing('b', 400);
    (querySyncAbortable as jest.Mock).mockResolvedValue([v1, forged, v2, other]);
    await expect(
      fetchLatestRevision({ pubkey, kind: 30402, dTag: 'a', relays: ['wss://r.example'] }),
    ).resolves.toMatchObject({ event: v2 });
    expect((querySyncAbortable as jest.Mock).mock.calls[0][2]).toEqual({
      kinds: [30402],
      authors: [pubkey],
      '#d': ['a'],
      limit: 5,
    });
    expect((querySyncAbortable as jest.Mock).mock.calls[0][3]).toEqual(
      expect.objectContaining({ rejectOnTimeout: true }),
    );
  });

  it('ignores revisions deleted by NIP-09 (a deleted shop is not an existing shop)', async () => {
    const shop = sign(
      buildShopTemplate({
        shop: { name: 'TEST', description: '', currency: 'GBP' },
        pubkey,
        productCoordinates: [],
        zoneCoordinates: [],
      }),
      100,
    );
    const deletion = sign(
      buildDeletionTemplate([
        { kind: 30405, coordinate: coordinateOf(30405, pubkey, 'lightning-piggy-shop') },
      ]),
      150,
    );
    (querySyncAbortable as jest.Mock).mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(filter.kinds[0] === 5 ? [deletion] : [shop]),
    );
    await expect(
      fetchLatestRevision({
        pubkey,
        kind: 30405,
        dTag: 'lightning-piggy-shop',
        relays: ['wss://r'],
      }),
    ).resolves.toMatchObject({ event: null });
  });

  it('is null only when relays completed with nothing', async () => {
    (querySyncAbortable as jest.Mock).mockResolvedValue([]);
    await expect(
      fetchLatestRevision({
        pubkey,
        kind: 30405,
        dTag: 'lightning-piggy-shop',
        relays: ['wss://r'],
      }),
    ).resolves.toMatchObject({ event: null });
  });
});

describe('publishSellerEvent', () => {
  it.each(['listing', 'deletion'])('rejects an unreachable %s publication', async (kind) => {
    (publishSignedEvent as jest.Mock).mockImplementation((...args: unknown[]) =>
      jest.requireActual('./nostrEventPublish').publishSignedEvent(...args),
    );
    (pool.publish as jest.Mock).mockReturnValue([
      Promise.resolve('connection failure: offline'),
      Promise.reject(new Error('blocked: refused')),
    ]);
    const event = kind === 'listing' ? listing('a') : sign(buildDeletionTemplate([]));
    await expect(publishSellerEvent(event, ['wss://a', 'wss://b'])).rejects.toThrow();
  });

  it('waits for an actual acknowledgement after a fast connection failure', async () => {
    (publishSignedEvent as jest.Mock).mockImplementation((...args: unknown[]) =>
      jest.requireActual('./nostrEventPublish').publishSignedEvent(...args),
    );
    let accept!: (message: string) => void;
    (pool.publish as jest.Mock).mockReturnValue([
      Promise.resolve('connection failure: offline'),
      new Promise<string>((resolve) => (accept = resolve)),
    ]);
    let published = false;
    const pending = publishSellerEvent(listing('a'), ['wss://a', 'wss://b']).then(() => {
      published = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(published).toBe(false);
    accept(''); // An empty OK message is a valid positive acknowledgement.
    await pending;
    expect(published).toBe(true);
  });

  it('publishes to at most eight relays', async () => {
    (publishSignedEvent as jest.Mock).mockResolvedValue(undefined);
    const relays = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example`);
    await publishSellerEvent(listing('a'), relays);
    expect((publishSignedEvent as jest.Mock).mock.calls[0][1]).toHaveLength(8);
  });
  it('rejects when no relay accepts in time', async () => {
    jest.useFakeTimers();
    (publishSignedEvent as jest.Mock).mockReturnValue(new Promise(() => {}));
    const pending = publishSellerEvent(listing('a'), ['wss://r.example']);
    jest.advanceTimersByTime(12_000);
    await expect(pending).rejects.toThrow('timed out');
    jest.useRealTimers();
  });
});

describe('hidden listings and the persisted snapshot', () => {
  it('round-trips the hidden set and ignores corrupt storage', async () => {
    const hidden = new Map([[coordinateOf(30402, pubkey, 'a'), 5]]);
    await saveHiddenListings(pubkey, hidden);
    await expect(loadHiddenListings(pubkey)).resolves.toEqual(hidden);
    await AsyncStorage.setItem(`market-seller-hidden:${pubkey}`, '{nope');
    await expect(loadHiddenListings(pubkey)).resolves.toEqual(new Map());
  });

  it('persists only the winning revisions plus deletions, and restores them', async () => {
    const zone = sign(
      buildShippingZoneTemplate({
        dTag: 'z',
        name: 'UK',
        countries: ['GB'],
        cost: '3',
        currency: 'GBP',
      }),
    );
    const shop = sign(
      buildShopTemplate({
        shop: { name: 'TEST shop', description: '', currency: 'GBP' },
        pubkey,
        productCoordinates: [],
        zoneCoordinates: [coordinateOf(30406, pubkey, 'z')],
      }),
    );
    const v1 = listing('a', 100);
    const v2 = listing('a', 200);
    const gone = listing('b', 100);
    const deletion = sign(
      buildDeletionTemplate([{ kind: 30402, coordinate: coordinateOf(30402, pubkey, 'b') }]),
      150,
    );
    addSellerEvents(pubkey, [zone, shop, v1, v2, gone, deletion]);
    await persistSellerSnapshot(pubkey);

    const cached = await loadSellerCache(pubkey);
    expect(cached.map((e) => e.id).sort()).toEqual([zone.id, shop.id, v2.id, deletion.id].sort());

    resetSellerStore();
    restoreSellerAccount(pubkey, cached, new Map([[coordinateOf(30402, pubkey, 'c'), 9]]));
    const state = sellerStoreState(pubkey);
    expect(state.events.size).toBe(4);
    expect(state.hidden.get(coordinateOf(30402, pubkey, 'c'))).toBe(9);
    // A second restore in the same session is a no-op.
    restoreSellerAccount(pubkey, [v1], new Map());
    expect(sellerStoreState(pubkey).events.has(v1.id)).toBe(false);
  });

  it("rejects cached rows that aren't this account's events", async () => {
    await AsyncStorage.setItem(
      `market-seller-events:${pubkey}`,
      JSON.stringify([{ id: 'x' }, { ...listing('a'), pubkey: 'f'.repeat(64) }, listing('ok')]),
    );
    const cached = await loadSellerCache(pubkey);
    expect(cached.map((e) => e.tags[0][1])).toEqual(['ok']);
  });
});

describe('sellerEventStore', () => {
  it('only accepts the account’s own events, and forgets an account on sign-out', () => {
    const foreign = finalizeEvent(
      { kind: 30402, created_at: 1, content: '', tags: [['d', 'x']] },
      new Uint8Array(32).fill(2),
    );
    addSellerEvents(pubkey, [listing('a'), foreign], true);
    expect(sellerStoreState(pubkey).events.size).toBe(1);
    expect(sellerStoreState(pubkey).fetchedAt).toBeGreaterThan(0);
    setSellerHidden(pubkey, new Map([['c', 1]]));
    expect(sellerStoreState(pubkey).hidden.get('c')).toBe(1);
    forgetSellerAccount(pubkey);
    expect(sellerStoreState(pubkey).events.size).toBe(0);
  });

  it('ignores late writes for a signed-out account until it is active again', () => {
    forgetSellerAccount(pubkey);
    addSellerEvents(pubkey, [listing('late')]);
    expect(sellerStoreState(pubkey).events.size).toBe(0);
    reviveSellerAccount(pubkey);
    addSellerEvents(pubkey, [listing('back')]);
    expect(sellerStoreState(pubkey).events.size).toBe(1);
  });

  it('compacts superseded revisions past the cap instead of refusing new events', () => {
    const revisions = Array.from({ length: 1100 }, (_, i) => listing('same', i + 1));
    addSellerEvents(pubkey, revisions);
    const fresh = listing('new', 5000);
    addSellerEvents(pubkey, [fresh]);
    const events = sellerStoreState(pubkey).events;
    expect(events.has(fresh.id)).toBe(true);
    expect(events.has(revisions[1099].id)).toBe(true);
    expect(events.size).toBeLessThan(1000);
  });
});

it.each(['a', 'e'])(
  'rejects saving a stale listing deleted by %s through the real revision lookup',
  async (target) => {
    const base = listing('deleted', 100);
    const deletion = sign(
      {
        kind: 5,
        content: '',
        tags: [[target, target === 'a' ? coordinateOf(30402, pubkey, 'deleted') : base.id]],
      },
      200,
    );
    (querySyncAbortable as jest.Mock).mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(filter.kinds[0] === 5 ? [deletion] : [base]),
    );
    const fetchLatest = () =>
      fetchLatestRevision({
        pubkey,
        kind: 30402,
        dTag: 'deleted',
        baseId: base.id,
        relays: ['wss://r'],
      });
    await expect(resolveCurrentRevision({ fetchLatest, base })).rejects.toBeInstanceOf(
      StaleRevisionError,
    );
    await expect(resolveCurrentRevision({ fetchLatest, base, force: true })).resolves.toBeNull();
  },
);
