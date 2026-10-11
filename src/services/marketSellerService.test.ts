import AsyncStorage from '@react-native-async-storage/async-storage';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import {
  fetchSellerEvents,
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
  sellerStoreState,
  setSellerHidden,
} from './sellerEventStore';
import { querySyncAbortable } from './relayQuery';
import { publishSignedEvent } from './nostrService';
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
  publishSignedEvent: jest.fn(),
}));
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
  it('runs one bounded query and drops events a relay sent for another author or kind', async () => {
    const mine = listing('a');
    const theirs = finalizeEvent(
      { kind: 30402, created_at: 1, content: '', tags: [['d', 'x']] },
      new Uint8Array(32).fill(1),
    );
    const note = sign({ kind: 1, content: 'gm', tags: [] });
    (querySyncAbortable as jest.Mock).mockResolvedValue([mine, theirs, note]);
    await expect(fetchSellerEvents({ pubkey, relays: ['wss://r.example'] })).resolves.toEqual([
      mine,
    ]);
    expect(querySyncAbortable).toHaveBeenCalledWith(
      expect.anything(),
      ['wss://r.example'],
      { kinds: [30402, 30405, 30406, 5], authors: [pubkey], limit: 300 },
      expect.objectContaining({ maxWait: 8000, rejectOnAllRelaysFailure: true }),
    );
  });
});

describe('publishSellerEvent', () => {
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
      buildShippingZoneTemplate({ dTag: 'z', name: 'UK', countries: ['GB'], cost: '3' }, 'GBP'),
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
});
