import { unreachableMarketSellers } from './marketUnreachableSellers';
import type { MarketProduct } from '../data/marketProducts';

const author = 'a'.repeat(64);
const shop = 'wss://shop.example';
const family = 'wss://family.example';
const product = {
  listing: { event: { pubkey: author }, seenOn: [shop] },
} as MarketProduct;
const scope = new Set([author]);

it('reports a missing seller when the queried listing relay does not answer', () => {
  expect(unreachableMarketSellers(scope, [shop], [], new Set(), [], [])).toEqual([author]);
});
it('does not warn when cached products are still displayed', () => {
  expect(unreachableMarketSellers(scope, [shop], [], new Set(), [product], [product])).toEqual([]);
});
it('uses known listing provenance rather than an unrelated silent relay', () => {
  expect(unreachableMarketSellers(scope, [shop, family], [shop], new Set(), [product], [])).toEqual(
    [],
  );
});
it('does not treat an internally withheld listing as an unreachable seller', () => {
  expect(unreachableMarketSellers(scope, [shop], [], scope, [], [])).toEqual([]);
});
it('does not warn when the listings pass answered but later internal work was incomplete', () => {
  expect(unreachableMarketSellers(scope, [shop], [shop], new Set(), [], [])).toEqual([]);
});
