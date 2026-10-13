import { MARKET_PRODUCTS } from '../data/marketProducts';
import {
  collapsedMerchants,
  marketMerchants,
  merchantLabel,
  merchantId,
  resolveMerchantSelection,
} from './marketMerchants';
import { parseMarketListing, reduceMarketListings } from './marketListings';
import { MARKET_VENDORS } from '../data/marketVendors';
import { vendorNostrPubkey } from './marketVendors';
import type { Event } from 'nostr-tools';
const pk = 'a'.repeat(64);
function listing(pubkey = pk, d = 'item', tags: string[][] = []) {
  return {
    pubkey,
    id: d,
    kind: 30402,
    created_at: 100,
    content: '',
    tags: [['d', d], ['title', 'Item'], ['price', '21', 'SATS'], ...tags],
    sig: '',
  } as Event;
}
it('uses shop, display name, name, then a shortened npub', () => {
  const profile = { displayName: 'Display', name: 'Name', nip05: 'shop@example.com' };
  expect(merchantLabel(pk, profile, 'Shop')).toBe('Shop');
  expect(merchantLabel(pk, profile)).toBe('Display');
  expect(merchantLabel(pk, { ...profile, displayName: ' ' })).toBe('Name');
  expect(merchantLabel(pk, { nip05: profile.nip05 })).toMatch(/^npub1/);
  expect(merchantLabel(pk)).toMatch(/^npub1.{7}….{4}$/);
  expect(merchantLabel(pk, { name: 123 as unknown as string })).toMatch(/^npub/);
});
it('uses pubkey identity even when display names collide or change', () => {
  const product = parseMarketListing(listing())!;
  expect(merchantId(product)).toBe(pk);
  expect(merchantId({ ...product, sellerName: 'New name' })).toBe(pk);
});
it('puts curated vendors first and sorts others by current listing count', () => {
  const curatedPk = MARKET_VENDORS.map(vendorNostrPubkey).find((p): p is string => !!p)!;
  const products = [
    listing(pk, 'a'),
    listing(pk, 'b'),
    listing('b'.repeat(64), 'c'),
    listing(curatedPk, 'd'),
  ].map((event) => parseMarketListing(event)!);
  expect(marketMerchants(products).map((m) => [m.id, m.count])).toEqual([
    [curatedPk, 1],
    [pk, 2],
    ['b'.repeat(64), 1],
  ]);
});
it('excludes zero-listing merchants after deletions, sold revisions and expiration', () => {
  const events = [
    listing(pk, 'expired', [['expiration', '101']]),
    listing(pk, 'sold', [['status', 'sold']]),
    listing(pk, 'deleted'),
    { ...listing(pk, 'delete'), kind: 5, tags: [['a', `30402:${pk}:deleted`]], created_at: 101 },
  ];
  expect(marketMerchants(reduceMarketListings(events, new Set([pk]), 102), 102)).toEqual([]);
  expect(
    marketMerchants([parseMarketListing(listing(pk, 'aging', [['expiration', '101']]), 100)!], 102),
  ).toEqual([]);
});
it('limits chips to eight, counts hidden options and retains an off-page selection', () => {
  const options = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    label: String(i),
    count: 1,
    curated: false,
  }));
  expect(collapsedMerchants(options, null)).toEqual({
    visible: options.slice(0, 8),
    remaining: 12,
  });
  const selected = collapsedMerchants(options, '19');
  expect(selected.visible).toHaveLength(8);
  expect(selected.visible[7].id).toBe('19');
  expect(selected.remaining).toBe(12);
  expect(collapsedMerchants([], null)).toEqual({ visible: [], remaining: 0 });
  expect(collapsedMerchants(options.slice(0, 2), null).remaining).toBe(0);
});
it('keeps static curated products in their active scope', () => {
  expect(marketMerchants(MARKET_PRODUCTS).length).toBeGreaterThan(0);
});

it('upgrades remembered labels and npubs and keeps unresolved values while loading', () => {
  const options = [{ id: pk, label: 'Shop', count: 1, curated: false }];
  expect(resolveMerchantSelection('Shop', options)).toBe(pk);
  expect(resolveMerchantSelection('My petname', options, new Map([['My petname', pk]]))).toBe(pk);
  expect(resolveMerchantSelection(merchantLabel(pk), options)).toBe(pk);
  expect(resolveMerchantSelection(pk, options)).toBe(pk);
  expect(resolveMerchantSelection('Still loading', [])).toBe('Still loading');
});

it.each([
  ['Shop', 'Shop'],
  ['Sh\u202eop\u200b', 'Shop'],
  ['x'.repeat(65), 'x'.repeat(63) + '…'],
])('sanitises Market seller labels', (name, expected) => {
  expect(merchantLabel(pk, { displayName: name })).toBe(expected);
  expect(merchantLabel(pk, undefined, name)).toBe(expected);
});
