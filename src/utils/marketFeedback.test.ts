import type { MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';
import { marketFeedbackContext } from './marketFeedback';
import { addressableCoord } from './productComments';

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

const baseVendor: MarketVendor = {
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

// Hex for the npub above (nip19-decoded) — kept in the assertions below.
describe('marketFeedbackContext', () => {
  it('returns null when the vendor is undefined', () => {
    expect(marketFeedbackContext(product, undefined)).toBeNull();
  });

  it('returns null when the vendor has no Nostr identity', () => {
    expect(marketFeedbackContext(product, { ...baseVendor, nostrUrl: '' })).toBeNull();
  });

  it('builds review + comment coordinates for a Nostr vendor', () => {
    const ctx = marketFeedbackContext(product, baseVendor);
    expect(ctx).not.toBeNull();
    const { merchantPubkey, productDTag, reviewCoord, commentRoot } = ctx!;
    expect(merchantPubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(productDTag).toBe('robotechy-lightning-piggy');
    // Review coordinate carries the a: prefix; comment root does not.
    expect(reviewCoord).toBe(`a:30402:${merchantPubkey}:robotechy-lightning-piggy`);
    expect(commentRoot.kind).toBe(30402);
    expect(commentRoot.pubkey).toBe(merchantPubkey);
    expect(addressableCoord(commentRoot)).toBe(`30402:${merchantPubkey}:robotechy-lightning-piggy`);
  });
});
