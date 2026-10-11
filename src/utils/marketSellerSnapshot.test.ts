import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import { reduceSellerSnapshot } from './marketSellerSnapshot';
import {
  SHOP_COLLECTION_D,
  buildDeletionTemplate,
  buildShippingZoneTemplate,
  buildShopTemplate,
  coordinateOf,
  type EventTemplate,
} from './marketSellerEvents';

const key = new Uint8Array(32).fill(4);
const pubkey = getPublicKey(key);
const stranger = new Uint8Array(32).fill(5);
const sign = (t: EventTemplate, created_at: number, secret = key): Event =>
  finalizeEvent({ ...t, created_at }, secret);
const listing = (d: string, title: string, created_at: number, secret = key) =>
  sign(
    {
      kind: 30402,
      content: '',
      tags: [
        ['d', d],
        ['title', title],
        ['price', '1', 'GBP'],
      ],
    },
    created_at,
    secret,
  );
const zone = (d: string, created_at: number) =>
  sign(
    buildShippingZoneTemplate({ dTag: d, name: d, countries: [], cost: '1' }, 'GBP'),
    created_at,
  );

describe('reduceSellerSnapshot', () => {
  it('keeps the newest revision per listing, newest listing first', () => {
    const snap = reduceSellerSnapshot(
      [listing('a', 'A v1', 10), listing('a', 'A v2', 20), listing('b', 'B', 15)],
      pubkey,
    );
    expect(snap.listings.map((e) => e.tags[1][1])).toEqual(['A v2', 'B']);
  });

  it("ignores another author's events", () => {
    const snap = reduceSellerSnapshot([listing('a', 'Theirs', 10, stranger)], pubkey);
    expect(snap.listings).toEqual([]);
  });

  it('drops listings deleted by address or id, but not later re-listings', () => {
    const a = listing('a', 'A', 10);
    const b = listing('b', 'B', 10);
    const del = sign(
      buildDeletionTemplate([
        { kind: 30402, coordinate: coordinateOf(30402, pubkey, 'a') },
        { kind: 30402, coordinate: 'x', eventId: b.id },
      ]),
      12,
    );
    expect(reduceSellerSnapshot([a, b, del], pubkey).listings).toEqual([]);
    const relisted = listing('a', 'A again', 13);
    expect(reduceSellerSnapshot([a, b, del, relisted], pubkey).listings).toEqual([relisted]);
  });

  it('honours locally hidden coordinates until a newer revision appears', () => {
    const a = listing('a', 'A', 10);
    const hidden = new Map([[coordinateOf(30402, pubkey, 'a'), 10]]);
    expect(reduceSellerSnapshot([a], pubkey, hidden).listings).toEqual([]);
    expect(reduceSellerSnapshot([listing('a', 'A2', 11)], pubkey, hidden).listings).toHaveLength(1);
  });

  it('finds the shop and orders zones as the shop lists them', () => {
    const z1 = zone('z1', 10);
    const z2 = zone('z2', 11);
    const shop = sign(
      buildShopTemplate({
        shop: { name: 'Shop', description: '', currency: 'GBP' },
        pubkey,
        productCoordinates: [],
        zoneCoordinates: [coordinateOf(30406, pubkey, 'z2'), coordinateOf(30406, pubkey, 'z1')],
      }),
      12,
    );
    const otherCollection = sign(
      {
        kind: 30405,
        content: '',
        tags: [
          ['d', 'not-the-shop'],
          ['title', 'x'],
        ],
      },
      13,
    );
    const snap = reduceSellerSnapshot([z1, z2, shop, otherCollection], pubkey);
    expect(snap.shop?.tags[0]).toEqual(['d', SHOP_COLLECTION_D]);
    expect(snap.zones.map((z) => z.dTag)).toEqual(['z2', 'z1']);
    expect(snap.zoneEvents.get(coordinateOf(30406, pubkey, 'z1'))).toBe(z1);
  });

  it('skips malformed zones rather than failing the snapshot', () => {
    const bad = sign(
      {
        kind: 30406,
        content: '',
        tags: [
          ['d', 'bad'],
          ['price', 'x', 'GBP'],
        ],
      },
      10,
    );
    expect(reduceSellerSnapshot([bad, zone('ok', 11)], pubkey).zones.map((z) => z.dTag)).toEqual([
      'ok',
    ]);
  });
});
