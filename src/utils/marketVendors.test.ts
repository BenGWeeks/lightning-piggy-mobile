import { featuredFirst, shopTypeLabel, vendorLocationLine, vendorSlug } from './marketVendors';
import type { MarketVendor } from '../data/marketVendors';

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
