import {
  featuredFirst,
  shopTypeLabel,
  vendorHasNostr,
  vendorLocationLine,
  vendorNostrPubkey,
  vendorSlug,
} from './marketVendors';
import { MARKET_VENDORS, type MarketVendor } from '../data/marketVendors';

const make = (over: Partial<MarketVendor>): MarketVendor => ({
  name: 'Test Vendor',
  country: 'Denmark',
  shippingRegions: ['Worldwide'],
  shopType: 'online',
  description: 'desc',
  url: 'https://example.com',
  logo: 'https://example.com/logo.png',
  nostrUrl: '',
  xUrl: '',
  featured: false,
  ...over,
});

describe('vendorSlug', () => {
  it('lower-cases and hyphenates', () => {
    expect(vendorSlug('Danish Bacon')).toBe('danish-bacon');
  });

  it('collapses runs of non-alphanumerics and trims edges', () => {
    expect(vendorSlug('SatoshiStore.io')).toBe('satoshistore-io');
    expect(vendorSlug('The Bitcoin Hardware Store')).toBe('the-bitcoin-hardware-store');
  });

  it('strips diacritics', () => {
    expect(vendorSlug('Usulután Café')).toBe('usulutan-cafe');
  });
});

describe('featuredFirst', () => {
  it('moves featured vendors to the front, preserving relative order', () => {
    const a = make({ name: 'A', featured: false });
    const b = make({ name: 'B', featured: true });
    const c = make({ name: 'C', featured: false });
    const d = make({ name: 'D', featured: true });
    const sorted = featuredFirst([a, b, c, d]).map((v) => v.name);
    expect(sorted).toEqual(['B', 'D', 'A', 'C']);
  });

  it('does not mutate the input array', () => {
    const input = [make({ name: 'A' }), make({ name: 'B', featured: true })];
    const copy = [...input];
    featuredFirst(input);
    expect(input).toEqual(copy);
  });
});

describe('shopTypeLabel', () => {
  it('maps each shop type to a label', () => {
    expect(shopTypeLabel('online')).toBe('Online');
    expect(shopTypeLabel('physical')).toBe('Physical');
    expect(shopTypeLabel('both')).toBe('Online & Physical');
  });
});

describe('vendorLocationLine', () => {
  it('includes shipping regions when present', () => {
    expect(vendorLocationLine(make({ country: 'Denmark', shippingRegions: ['Worldwide'] }))).toBe(
      'Denmark · Ships to Worldwide',
    );
  });

  it('omits the ships-to clause for physical-only vendors', () => {
    expect(
      vendorLocationLine(
        make({ country: 'El Salvador', shippingRegions: [], shopType: 'physical' }),
      ),
    ).toBe('El Salvador');
  });
});

describe('vendorNostrPubkey', () => {
  // Robotechy's npub → hex (verified against nostr-tools nip19.decode).
  const robotechyHex = '211f325b5396968ac0c79b7c0a030d768206d32ac61f93f143de112b859bd46f';

  it('decodes an njump.me npub link to its hex pubkey', () => {
    const vendor = make({
      nostrUrl: 'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
    });
    expect(vendorNostrPubkey(vendor)).toBe(robotechyHex);
  });

  it('tolerates a trailing slash and a bare npub', () => {
    expect(
      vendorNostrPubkey(
        make({
          nostrUrl:
            'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5/',
        }),
      ),
    ).toBe(robotechyHex);
    expect(
      vendorNostrPubkey(
        make({ nostrUrl: 'npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5' }),
      ),
    ).toBe(robotechyHex);
  });

  it('returns null for an empty or non-npub nostrUrl', () => {
    expect(vendorNostrPubkey(make({ nostrUrl: '' }))).toBeNull();
    expect(vendorNostrPubkey(make({ nostrUrl: 'https://example.com/profile' }))).toBeNull();
    expect(vendorNostrPubkey(make({ nostrUrl: 'https://njump.me/npub1notvalid' }))).toBeNull();
  });
});

describe('vendorHasNostr', () => {
  it('is true only when an npub decodes', () => {
    expect(
      vendorHasNostr(
        make({
          nostrUrl:
            'https://njump.me/npub1yy0nyk6nj6tg4sx8nd7q5qcdw6pqd5e2cc0e8u2rmcgjhpvm63hsk67xe5',
        }),
      ),
    ).toBe(true);
    expect(vendorHasNostr(make({ nostrUrl: '' }))).toBe(false);
  });
});

describe('MARKET_VENDORS directory', () => {
  it('exposes a Nostr identity for exactly the three production npub vendors', () => {
    // In DEV builds MARKET_VENDORS is prepended with __DEV__-gated "(TEST)"
    // pig sellers (Big/Little Piggy) that carry npubs so a pig-to-pig NIP-17
    // order can be exercised end-to-end. Jest runs with __DEV__ === true, so
    // exclude those dev-only entries and assert on the real, shipped directory.
    const onNostr = MARKET_VENDORS.filter(
      (v) => vendorHasNostr(v) && !v.name.includes('(TEST)'),
    ).map((v) => v.name);
    expect(onNostr.sort()).toEqual(['BitcoinStuffStore', 'Robotechy', 'SatoshiStore.io'].sort());
  });

  it('only ever uses https banner URLs (no dead-host fallbacks baked in)', () => {
    for (const v of MARKET_VENDORS) {
      if (v.banner) expect(v.banner).toMatch(/^https:\/\//);
    }
  });

  it('every vendor has non-empty absolute https url + logo (per the data contract)', () => {
    for (const v of MARKET_VENDORS) {
      expect(v.url).toMatch(/^https:\/\/.+/);
      expect(v.logo).toMatch(/^https:\/\/.+/);
    }
  });
});
