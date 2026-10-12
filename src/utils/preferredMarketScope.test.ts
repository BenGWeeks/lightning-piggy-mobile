import { MARKET_PRODUCTS, sellerOf } from '../data/marketProducts';
import { MARKET_VENDORS } from '../data/marketVendors';
import { ROBOTECHY_PUBKEY } from './marketSample';
import { vendorNostrPubkey } from './marketVendors';
import { preferredMarketScope } from './preferredMarketScope';

it('includes Robotechy and every curated seller even when absent from 216 follows', () => {
  const follows = Array.from({ length: 216 }, (_, i) => i.toString(16).padStart(64, '0'));
  expect(follows).not.toContain(ROBOTECHY_PUBKEY);
  const scope = preferredMarketScope(follows);
  expect(scope).toContain(ROBOTECHY_PUBKEY);
  expect(scope).toEqual(expect.arrayContaining(follows));
  for (const vendor of [...MARKET_VENDORS, ...MARKET_PRODUCTS.map(sellerOf)]) {
    const author = vendor && vendorNostrPubkey(vendor);
    if (author) expect(scope).toContain(author);
  }
});

it('deduplicates follows, vendors and catalogue sellers without mutating follows', () => {
  const follows = [ROBOTECHY_PUBKEY, 'a'.repeat(64), 'a'.repeat(64)];
  const scope = preferredMarketScope(follows);
  expect(scope.filter((author) => author === ROBOTECHY_PUBKEY)).toHaveLength(1);
  expect(scope.filter((author) => author === 'a'.repeat(64))).toHaveLength(1);
  expect(new Set(scope).size).toBe(scope.length);
  expect(follows).toHaveLength(3);
});
