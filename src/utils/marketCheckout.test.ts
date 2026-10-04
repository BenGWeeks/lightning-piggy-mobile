import { MARKET_PRODUCTS, sellerOf, type MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';
import { marketCheckoutTarget } from './marketCheckout';

const vendor: MarketVendor = {
  name: 'Robotechy',
  country: 'United Kingdom',
  shippingRegions: ['Worldwide'],
  shopType: 'online',
  description: 'x',
  url: 'https://robotechy.com',
  logo: 'https://example.com/logo.png',
  nostrUrl: 'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
  xUrl: '',
  featured: false,
};

const product: MarketProduct = {
  id: 'robotechy-lightning-piggy',
  title: 'Lightning Piggy',
  description: 'x',
  priceSats: 1,
  priceFiatLabel: '£60',
  image: 'https://example.com/x.png',
  sellerName: 'Robotechy',
  url: 'https://robotechy.com',
  featured: true,
};

describe('marketCheckoutTarget', () => {
  it('uses the website for a Nostr seller without an explicit opt-in', () => {
    expect(marketCheckoutTarget(product, vendor)).toBeNull();
  });

  it('uses the website when the opted-in seller has no Nostr identity', () => {
    const optedIn = {
      ...product,
      checkout: { listingDTag: 'lp', fulfilment: 'physical' as const },
    };
    expect(marketCheckoutTarget(optedIn, { ...vendor, nostrUrl: '' })).toBeNull();
    expect(marketCheckoutTarget(optedIn, undefined)).toBeNull();
  });

  it('rejects a blank listing id', () => {
    const blank = { ...product, checkout: { listingDTag: '  ', fulfilment: 'none' as const } };
    expect(marketCheckoutTarget(blank, vendor)).toBeNull();
  });

  it('orders against the seller listing id, not the catalogue id', () => {
    const optedIn = {
      ...product,
      checkout: { listingDTag: 'seller-listing-42', fulfilment: 'none' as const },
    };
    expect(marketCheckoutTarget(optedIn, vendor)).toEqual({
      vendorPubkey: expect.stringMatching(/^[0-9a-f]{64}$/),
      listingDTag: 'seller-listing-42',
      fulfilment: 'none',
    });
  });
});

describe('catalogue checkout opt-in', () => {
  it('offers in-app checkout only for the dev test sellers', () => {
    const inApp = MARKET_PRODUCTS.filter((p) => marketCheckoutTarget(p, sellerOf(p)) !== null);
    for (const p of inApp) {
      // Real sellers keep the website link until they confirm order support
      // and supply their real listing id (#948 review).
      expect(p.sellerName).toMatch(/\(TEST\)$/);
    }
    for (const p of MARKET_PRODUCTS.filter((x) => !x.sellerName.endsWith('(TEST)'))) {
      expect(p.checkout).toBeUndefined();
    }
  });
});
