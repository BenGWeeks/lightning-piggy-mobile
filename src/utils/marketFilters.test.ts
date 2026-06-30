import {
  EMPTY_MARKET_FILTER,
  currencyOf,
  distinctCurrencies,
  distinctLocations,
  filterMarketProducts,
  isMarketFilterActive,
  productLocation,
  productMatchesSearch,
  type ResolveVendor,
} from './marketFilters';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketVendor } from '../data/marketVendors';

// ----- fixtures ----------------------------------------------------------
const vendor = (over: Partial<MarketVendor>): MarketVendor => ({
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

const product = (over: Partial<MarketProduct>): MarketProduct => ({
  id: 'p',
  title: 'Lightning Piggy',
  description: 'A piggy bank for Bitcoin',
  priceSats: 100000,
  priceFiatLabel: '£60',
  image: 'https://example.com/p.png',
  sellerName: 'Robotechy',
  url: 'https://example.com/buy',
  featured: false,
  ...over,
});

// Directory keyed by sellerName, mirroring `sellerOf` for the tests.
const directory: Record<string, MarketVendor> = {
  Robotechy: vendor({ name: 'Robotechy', country: 'United Kingdom' }),
  'Danish Bacon': vendor({ name: 'Danish Bacon', country: 'Denmark' }),
  TBHS: vendor({ name: 'TBHS', country: 'El Salvador' }),
};
const resolve: ResolveVendor = (p) => directory[p.sellerName];

describe('currencyOf', () => {
  it('maps fiat symbols to ISO codes', () => {
    expect(currencyOf('£60')).toBe('GBP');
    expect(currencyOf('$25')).toBe('USD');
    expect(currencyOf('€40')).toBe('EUR');
    expect(currencyOf('¥500')).toBe('JPY');
  });

  it('reads a bare leading 3-letter ISO code, upper-cased', () => {
    expect(currencyOf('GBP 60')).toBe('GBP');
    expect(currencyOf('usd25')).toBe('USD');
  });

  it('returns null for empty / unrecognised / non-string labels', () => {
    expect(currencyOf('')).toBeNull();
    expect(currencyOf('   ')).toBeNull();
    expect(currencyOf('free')).toBeNull();
    expect(currencyOf(undefined)).toBeNull();
    expect(currencyOf(null)).toBeNull();
  });
});

describe('productLocation', () => {
  it("returns the selling vendor's country", () => {
    expect(productLocation(product({ sellerName: 'Robotechy' }), resolve)).toBe('United Kingdom');
    expect(productLocation(product({ sellerName: 'TBHS' }), resolve)).toBe('El Salvador');
  });

  it('returns null for an orphan seller (not in the directory)', () => {
    expect(productLocation(product({ sellerName: 'Unknown Shop' }), resolve)).toBeNull();
  });
});

describe('productMatchesSearch', () => {
  const p = product({
    title: 'Nostr Badge',
    description: 'Wear your Nostr pride',
    sellerName: 'Robotechy',
  });

  it('matches everything for an empty / whitespace query', () => {
    expect(productMatchesSearch(p, resolve, '')).toBe(true);
    expect(productMatchesSearch(p, resolve, '   ')).toBe(true);
  });

  it('matches on title, case-insensitively', () => {
    expect(productMatchesSearch(p, resolve, 'badge')).toBe(true);
    expect(productMatchesSearch(p, resolve, 'NOSTR')).toBe(true);
  });

  it('matches on description', () => {
    expect(productMatchesSearch(p, resolve, 'pride')).toBe(true);
  });

  it('matches on seller name and vendor country', () => {
    expect(productMatchesSearch(p, resolve, 'robotechy')).toBe(true);
    expect(productMatchesSearch(p, resolve, 'united kingdom')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(productMatchesSearch(p, resolve, 'umbrella')).toBe(false);
  });
});

describe('distinctLocations', () => {
  it('returns sorted distinct vendor countries', () => {
    const products = [
      product({ id: '1', sellerName: 'Robotechy' }), // United Kingdom
      product({ id: '2', sellerName: 'Danish Bacon' }), // Denmark
      product({ id: '3', sellerName: 'TBHS' }), // El Salvador
      product({ id: '4', sellerName: 'Robotechy' }), // dup UK
    ];
    expect(distinctLocations(products, resolve)).toEqual([
      'Denmark',
      'El Salvador',
      'United Kingdom',
    ]);
  });

  it('skips orphan sellers with no resolvable location', () => {
    const products = [product({ id: '1', sellerName: 'Unknown Shop' })];
    expect(distinctLocations(products, resolve)).toEqual([]);
  });
});

describe('distinctCurrencies', () => {
  it('returns sorted distinct currencies derived from price labels', () => {
    const products = [
      product({ id: '1', priceFiatLabel: '£60' }),
      product({ id: '2', priceFiatLabel: '$25' }),
      product({ id: '3', priceFiatLabel: '£4.50' }),
      product({ id: '4', priceFiatLabel: '€40' }),
    ];
    expect(distinctCurrencies(products)).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('ignores products with no readable currency', () => {
    const products = [
      product({ id: '1', priceFiatLabel: '£60' }),
      product({ id: '2', priceFiatLabel: 'free' }),
    ];
    expect(distinctCurrencies(products)).toEqual(['GBP']);
  });
});

describe('isMarketFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isMarketFilterActive(EMPTY_MARKET_FILTER)).toBe(false);
  });

  it('is true when any axis is set', () => {
    expect(isMarketFilterActive({ query: 'pig', location: null, currency: null })).toBe(true);
    expect(isMarketFilterActive({ query: '', location: 'Denmark', currency: null })).toBe(true);
    expect(isMarketFilterActive({ query: '  ', location: null, currency: 'GBP' })).toBe(true);
  });
});

describe('filterMarketProducts', () => {
  // Explicit descriptions so each axis is exercised in isolation (the default
  // factory description contains "piggy", which would otherwise let a "piggy"
  // search match every row via the description field).
  const products = [
    product({
      id: 'piggy-uk',
      title: 'Lightning Piggy',
      description: 'Electronic cash piggy bank',
      sellerName: 'Robotechy',
      priceFiatLabel: '£60',
    }),
    product({
      id: 'badge-uk',
      title: 'Nostr Badge',
      description: 'Keyring with a pin backing',
      sellerName: 'Robotechy',
      priceFiatLabel: '£4.50',
    }),
    product({
      id: 'piggy-dk',
      title: 'Lightning Piggy',
      description: 'Direct from the project team',
      sellerName: 'Danish Bacon',
      priceFiatLabel: '£55',
    }),
    product({
      id: 'merch-sv',
      title: 'Bitcoin Merch',
      description: 'Physical store merch',
      sellerName: 'TBHS',
      priceFiatLabel: '$25',
    }),
  ];

  it('returns all products for the empty filter', () => {
    expect(filterMarketProducts(products, EMPTY_MARKET_FILTER, resolve)).toHaveLength(4);
  });

  it('filters by search query', () => {
    const out = filterMarketProducts(
      products,
      { query: 'piggy', location: null, currency: null },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'piggy-dk']);
  });

  it('filters by location', () => {
    const out = filterMarketProducts(
      products,
      { query: '', location: 'United Kingdom', currency: null },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk']);
  });

  it('filters by currency', () => {
    const out = filterMarketProducts(
      products,
      { query: '', location: null, currency: 'USD' },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['merch-sv']);
  });

  it('composes search + location + currency (AND semantics)', () => {
    const out = filterMarketProducts(
      products,
      { query: 'lightning', location: 'United Kingdom', currency: 'GBP' },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk']);
  });

  it('returns an empty array when nothing matches, without mutating input', () => {
    const copy = [...products];
    const out = filterMarketProducts(
      products,
      { query: 'lightning', location: 'El Salvador', currency: null },
      resolve,
    );
    expect(out).toEqual([]);
    expect(products).toEqual(copy);
  });
});
