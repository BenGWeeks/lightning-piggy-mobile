import { MARKET_PRODUCTS, sellerOf } from '../data/marketProducts';
import { MARKET_VENDORS } from '../data/marketVendors';
import { vendorNostrPubkey } from './marketVendors';

// Curated identities remain preferred even when absent from the team's follows.
const curatedAuthors = [
  ...MARKET_VENDORS.map(vendorNostrPubkey),
  ...MARKET_PRODUCTS.map((product) => {
    const seller = sellerOf(product);
    return product.listing?.event.pubkey ?? (seller ? vendorNostrPubkey(seller) : null);
  }),
].filter((author): author is string => author !== null);

export function preferredMarketScope(follows: readonly string[]): string[] {
  return [...new Set([...curatedAuthors, ...follows])];
}
