import {
  EMPTY_MARKET_FILTER,
  canClearMarketFilters,
  countActiveMarketFilters,
  currencyOf,
  distinctCurrencies,
  distinctCountries,
  distinctMerchants,
  filterMarketProducts,
  isMarketFilterActive,
  isMarketScopeNarrowing,
  productCountry,
  productCurrency,
  productMerchant,
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

  it('uses the earliest symbol in the label, not the table order', () => {
    expect(currencyOf('$25 (≈ €23)')).toBe('USD');
    expect(currencyOf('€23 (≈ $25)')).toBe('EUR');
    expect(currencyOf('$6 / £5')).toBe('USD');
  });

  it('prefers a leading ISO code over a symbol', () => {
    expect(currencyOf('CAD $25')).toBe('CAD');
    expect(currencyOf('CNY ¥50')).toBe('CNY');
  });

  it('reads prefixed dollars and refuses unknown prefixes', () => {
    expect(currencyOf('A$30')).toBe('AUD');
    expect(currencyOf('CA$25')).toBe('CAD');
    expect(currencyOf('HK$100')).toBe('HKD');
    expect(currencyOf('US$10')).toBe('USD');
    expect(currencyOf('ZZ$10')).toBeNull();
  });

  it('only accepts known ISO codes in the bare-code form', () => {
    expect(currencyOf('Ask')).toBeNull();
    expect(currencyOf('TBC')).toBeNull();
    expect(currencyOf('POA')).toBeNull();
    expect(currencyOf('Sat 500')).toBeNull();
    expect(currencyOf('21 sats')).toBeNull();
  });
});

describe('productCountry', () => {
  it("returns the selling vendor's country", () => {
    expect(productCountry(product({ sellerName: 'Robotechy' }), resolve)).toBe('United Kingdom');
    expect(productCountry(product({ sellerName: 'TBHS' }), resolve)).toBe('El Salvador');
  });

  it('returns null for an orphan seller (not in the directory)', () => {
    expect(productCountry(product({ sellerName: 'Unknown Shop' }), resolve)).toBeNull();
  });
});

describe('productMerchant', () => {
  it("returns the selling vendor's display name", () => {
    expect(productMerchant(product({ sellerName: 'Robotechy' }), resolve)).toBe('Robotechy');
    expect(productMerchant(product({ sellerName: 'Danish Bacon' }), resolve)).toBe('Danish Bacon');
  });

  it('returns null for an orphan seller (not in the directory)', () => {
    expect(productMerchant(product({ sellerName: 'Unknown Shop' }), resolve)).toBeNull();
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

  it('never matches a query spanning two fields', () => {
    // title "…Badge" + description "Wear…" must not join into "badge wear".
    expect(productMatchesSearch(p, resolve, 'badge wear')).toBe(false);
    expect(productMatchesSearch(p, resolve, 'badgewear')).toBe(false);
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

describe('distinctCountries', () => {
  it('returns sorted distinct vendor countries', () => {
    const products = [
      product({ id: '1', sellerName: 'Robotechy' }), // United Kingdom
      product({ id: '2', sellerName: 'Danish Bacon' }), // Denmark
      product({ id: '3', sellerName: 'TBHS' }), // El Salvador
      product({ id: '4', sellerName: 'Robotechy' }), // dup UK
    ];
    expect(distinctCountries(products, resolve)).toEqual([
      'Denmark',
      'El Salvador',
      'United Kingdom',
    ]);
  });

  it('skips orphan sellers with no resolvable country', () => {
    const products = [product({ id: '1', sellerName: 'Unknown Shop' })];
    expect(distinctCountries(products, resolve)).toEqual([]);
  });
});

describe('distinctMerchants', () => {
  it('returns sorted distinct vendor names', () => {
    const products = [
      product({ id: '1', sellerName: 'Robotechy' }),
      product({ id: '2', sellerName: 'Danish Bacon' }),
      product({ id: '3', sellerName: 'TBHS' }),
      product({ id: '4', sellerName: 'Robotechy' }), // dup
    ];
    expect(distinctMerchants(products, resolve)).toEqual(['Danish Bacon', 'Robotechy', 'TBHS']);
  });

  it('skips orphan sellers with no resolvable merchant', () => {
    const products = [product({ id: '1', sellerName: 'Unknown Shop' })];
    expect(distinctMerchants(products, resolve)).toEqual([]);
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

// A relay listing priced in `currency` (the parser keeps the seller's
// spelling upper-cased, so SAT and SATS both reach the filter layer).
const listed = (id: string, currency: string): MarketProduct =>
  product({
    id,
    priceFiatLabel: `21 ${currency}`,
    listing: { currency, priceLabel: `21 ${currency}` } as MarketProduct['listing'],
  });

describe('productCurrency', () => {
  it('normalises listing currencies so sats spellings bucket together', () => {
    expect(productCurrency(listed('1', 'SAT'))).toBe('SATS');
    expect(productCurrency(listed('2', 'sats'))).toBe('SATS');
    expect(productCurrency(listed('3', 'eur'))).toBe('EUR');
  });

  it('falls back to the price label, and is null when unreadable', () => {
    expect(productCurrency(product({ id: '4', priceFiatLabel: '£60' }))).toBe('GBP');
    expect(productCurrency(product({ id: '5', priceFiatLabel: 'free' }))).toBeNull();
  });
});

describe('currency normalisation in options and filtering', () => {
  const products = [
    listed('sat', 'SAT'),
    listed('sats', 'SATS'),
    listed('lower', 'sats'),
    listed('eur', 'eur'),
    product({ id: 'gbp', priceFiatLabel: '£60' }),
  ];

  it('lists one SATS chip for every sats spelling, and upper-cases other codes', () => {
    expect(distinctCurrencies(products)).toEqual(['EUR', 'GBP', 'SATS']);
  });

  it('the SATS chip matches listings priced in any sats spelling', () => {
    const ids = filterMarketProducts(
      products,
      { query: '', merchant: null, country: null, currency: 'SATS' },
      resolve,
    ).map((p) => p.id);
    expect(ids).toEqual(['sat', 'sats', 'lower']);
  });

  it('normalises the selected currency too (a legacy "sat" selection still matches)', () => {
    expect(
      filterMarketProducts(
        products,
        { query: '', merchant: null, country: null, currency: 'sat' },
        resolve,
      ),
    ).toHaveLength(3);
  });
});

describe('isMarketFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isMarketFilterActive(EMPTY_MARKET_FILTER)).toBe(false);
  });

  it('is true when any axis is set', () => {
    expect(
      isMarketFilterActive({ query: 'pig', merchant: null, country: null, currency: null }),
    ).toBe(true);
    expect(
      isMarketFilterActive({ query: '', merchant: 'Robotechy', country: null, currency: null }),
    ).toBe(true);
    expect(
      isMarketFilterActive({ query: '', merchant: null, country: 'Denmark', currency: null }),
    ).toBe(true);
    expect(
      isMarketFilterActive({ query: '  ', merchant: null, country: null, currency: 'GBP' }),
    ).toBe(true);
  });
});

describe('isMarketScopeNarrowing', () => {
  it('treats every scope short of the whole web of trust as a filter', () => {
    expect(isMarketScopeNarrowing('preferred')).toBe(true);
    expect(isMarketScopeNarrowing('wotFriends')).toBe(true);
    expect(isMarketScopeNarrowing('wotFof')).toBe(true);
    expect(isMarketScopeNarrowing('wotAll')).toBe(false);
  });
});

describe('countActiveMarketFilters', () => {
  it('is 0 only when nothing narrows (whole web of trust, no axes)', () => {
    expect(countActiveMarketFilters(EMPTY_MARKET_FILTER, 'wotAll')).toBe(0);
  });

  it('counts the default preferred-sellers scope as an active filter', () => {
    expect(countActiveMarketFilters(EMPTY_MARKET_FILTER, 'preferred')).toBe(1);
    expect(countActiveMarketFilters(EMPTY_MARKET_FILTER, 'wotFriends')).toBe(1);
  });

  it('counts each active category axis (merchant / country / currency)', () => {
    expect(
      countActiveMarketFilters(
        { query: '', merchant: 'Robotechy', country: null, currency: null },
        'wotAll',
      ),
    ).toBe(1);
    expect(
      countActiveMarketFilters(
        { query: '', merchant: 'Robotechy', country: 'United Kingdom', currency: 'GBP' },
        'preferred',
      ),
    ).toBe(4);
  });

  it('ignores the search query (it has its own inline field, not the panel badge)', () => {
    expect(
      countActiveMarketFilters(
        { query: 'piggy', merchant: null, country: null, currency: null },
        'wotAll',
      ),
    ).toBe(0);
    expect(
      countActiveMarketFilters(
        { query: 'piggy', merchant: 'Robotechy', country: null, currency: null },
        'wotAll',
      ),
    ).toBe(1);
  });
});

describe('canClearMarketFilters', () => {
  it('is false at the defaults, even though the default scope narrows', () => {
    expect(canClearMarketFilters(EMPTY_MARKET_FILTER, 'preferred')).toBe(false);
  });

  it('is true when the scope or any category axis differs from its default', () => {
    expect(canClearMarketFilters(EMPTY_MARKET_FILTER, 'wotFriends')).toBe(true);
    expect(
      canClearMarketFilters(
        { query: '', merchant: null, country: null, currency: 'SATS' },
        'preferred',
      ),
    ).toBe(true);
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
      { query: 'piggy', merchant: null, country: null, currency: null },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'piggy-dk']);
  });

  it('filters by merchant', () => {
    const out = filterMarketProducts(
      products,
      { query: '', merchant: 'Robotechy', country: null, currency: null },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk']);
  });

  it('filters by country', () => {
    const out = filterMarketProducts(
      products,
      { query: '', merchant: null, country: 'United Kingdom', currency: null },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk']);
  });

  it('filters by currency', () => {
    const out = filterMarketProducts(
      products,
      { query: '', merchant: null, country: null, currency: 'USD' },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['merch-sv']);
  });

  it('composes search + merchant + country + currency (AND semantics)', () => {
    const out = filterMarketProducts(
      products,
      { query: 'lightning', merchant: 'Robotechy', country: 'United Kingdom', currency: 'GBP' },
      resolve,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk']);
  });

  it('merchant AND country compose to exclude a same-country different-merchant row', () => {
    // Danish Bacon is the only DK merchant here; narrowing to merchant
    // "Robotechy" AND country "Denmark" yields nothing (AND, not OR).
    const out = filterMarketProducts(
      products,
      { query: '', merchant: 'Robotechy', country: 'Denmark', currency: null },
      resolve,
    );
    expect(out).toEqual([]);
  });

  it('returns an empty array when nothing matches, without mutating input', () => {
    const copy = [...products];
    const out = filterMarketProducts(
      products,
      { query: 'lightning', merchant: null, country: 'El Salvador', currency: null },
      resolve,
    );
    expect(out).toEqual([]);
    expect(products).toEqual(copy);
  });
});

it('counts seller scope alongside category filters, including the default scope', () => {
  expect(countActiveMarketFilters(EMPTY_MARKET_FILTER, 'preferred')).toBe(1);
  expect(countActiveMarketFilters(EMPTY_MARKET_FILTER, 'wotFriends')).toBe(1);
  expect(
    countActiveMarketFilters(
      { query: '', merchant: 'Robotechy', country: 'United Kingdom', currency: 'GBP' },
      'wotFriends',
    ),
  ).toBe(4);
});
