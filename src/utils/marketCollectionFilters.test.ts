import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { productsInCollection, visibleCollections } from './marketCollectionFilters';
const pubkey = 'a'.repeat(64);
const collection = {
  kind: 30405,
  pubkey,
  tags: [
    ['d', 'art'],
    ['title', 'Art'],
    ['a', `30402:${pubkey}:listed`],
  ],
} as Event;
const product = (d: string, tags: string[][] = []) =>
  ({
    id: d,
    listing: { event: { kind: 30402, pubkey, tags: [['d', d], ...tags] } },
  }) as MarketProduct;
it('filters both collection members and explicit listing references, without cascades', () => {
  const products = [
    product('listed'),
    product('referenced', [['a', `30405:${pubkey}:art`]]),
    product('unrelated'),
  ];
  expect(productsInCollection(products, collection).map((p) => p.id)).toEqual([
    'listed',
    'referenced',
  ]);
  expect(productsInCollection(products, null)).toEqual(products);
  expect(products[1].listing?.event.tags).toEqual([
    ['d', 'referenced'],
    ['a', `30405:${pubkey}:art`],
  ]);
});
it('omits legacy shop-name collections from buyer filters', () => {
  const legacy = {
    ...collection,
    tags: [
      ['d', 'lightning-piggy-shop'],
      ['title', 'Shop'],
      ['currency', 'GBP'],
    ],
  };
  expect(visibleCollections([legacy, collection])).toEqual([collection]);
});
