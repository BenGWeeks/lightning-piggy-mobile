import {
  EMPTY_MARKET_FILTER,
  canClearMarketFilters,
  countActiveMarketFilters,
  currencyOf,
  distinctCurrencies,
  distinctMerchants,
  filterMarketProducts,
  isMarketFilterActive,
  isMarketScopeNarrowing,
  productCurrency,
  productMerchant,
  productMatchesSearch,
  type MarketFilter,
  type ResolveShipsTo,
  type ResolveVendor,
} from './marketFilters';
import { SHIPS_TO_UNKNOWN, type ShipsTo } from './marketShipsTo';
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
const f = (over: Partial<MarketFilter>): MarketFilter => ({ ...EMPTY_MARKET_FILTER, ...over });

// Ships-to per product id, as `useMarketShipsTo` would derive it from the
// sellers' kind-30406 options. Deliberately unrelated to the directory's
// `country` values above — the filter must never read those.
const SHIPS_TO: Record<string, ShipsTo> = {
  'piggy-uk': { kind: 'countries', countries: ['GB', 'IE'] },
  'badge-uk': { kind: 'anywhere', reason: 'worldwide' },
  'piggy-dk': { kind: 'countries', countries: ['DK'] },
};
const shipsToOf: ResolveShipsTo = (p) => SHIPS_TO[p.id] ?? SHIPS_TO_UNKNOWN;

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

  it('matches on seller name, but not the curated directory country', () => {
    expect(productMatchesSearch(p, resolve, 'robotechy')).toBe(true);
    // No hard-coded locations: where a seller ships comes from Nostr shipping
    // options (Ships-to filter), never the vendor directory.
    expect(productMatchesSearch(p, resolve, 'united kingdom')).toBe(false);
  });

  it('does not match unrelated text', () => {
    expect(productMatchesSearch(p, resolve, 'umbrella')).toBe(false);
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
    const ids = filterMarketProducts(products, f({ currency: 'SATS' }), resolve, shipsToOf).map(
      (p) => p.id,
    );
    expect(ids).toEqual(['sat', 'sats', 'lower']);
  });

  it('normalises the selected currency too (a legacy "sat" selection still matches)', () => {
    expect(filterMarketProducts(products, f({ currency: 'sat' }), resolve, shipsToOf)).toHaveLength(
      3,
    );
  });
});

describe('isMarketFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isMarketFilterActive(EMPTY_MARKET_FILTER)).toBe(false);
  });

  it('is true when any axis is set', () => {
    expect(isMarketFilterActive(f({ query: 'pig' }))).toBe(true);
    expect(isMarketFilterActive(f({ merchant: 'Robotechy' }))).toBe(true);
    expect(isMarketFilterActive(f({ shipsTo: 'DK' }))).toBe(true);
    expect(isMarketFilterActive(f({ query: '  ', currency: 'GBP' }))).toBe(true);
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

  it('counts each active category axis (merchant / ships to / currency)', () => {
    expect(countActiveMarketFilters(f({ merchant: 'Robotechy' }), 'wotAll')).toBe(1);
    expect(
      countActiveMarketFilters(
        f({ merchant: 'Robotechy', shipsTo: 'GB', currency: 'GBP' }),
        'preferred',
      ),
    ).toBe(4);
  });

  it('ignores the search query (it has its own inline field, not the panel badge)', () => {
    expect(countActiveMarketFilters(f({ query: 'piggy' }), 'wotAll')).toBe(0);
    expect(countActiveMarketFilters(f({ query: 'piggy', merchant: 'Robotechy' }), 'wotAll')).toBe(
      1,
    );
  });
});

describe('canClearMarketFilters', () => {
  it('is false at the defaults, even though the default scope narrows', () => {
    expect(canClearMarketFilters(EMPTY_MARKET_FILTER, 'preferred')).toBe(false);
  });

  it('is true when the scope or any category axis differs from its default', () => {
    expect(canClearMarketFilters(EMPTY_MARKET_FILTER, 'wotFriends')).toBe(true);
    expect(canClearMarketFilters(f({ currency: 'SATS' }), 'preferred')).toBe(true);
  });

  it('offers Clear for a ships-to destination or a switched-off include toggle', () => {
    expect(canClearMarketFilters(f({ shipsTo: 'GB' }), 'preferred')).toBe(true);
    expect(canClearMarketFilters(f({ includeUnknownShipping: false }), 'preferred')).toBe(true);
  });

  it('badges a ships-to destination but not the include toggle on its own', () => {
    expect(countActiveMarketFilters(f({ shipsTo: 'GB' }), 'wotAll')).toBe(1);
    expect(countActiveMarketFilters(f({ includeUnknownShipping: false }), 'wotAll')).toBe(0);
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
    expect(filterMarketProducts(products, EMPTY_MARKET_FILTER, resolve, shipsToOf)).toHaveLength(4);
  });

  it('filters by search query', () => {
    const out = filterMarketProducts(products, f({ query: 'piggy' }), resolve, shipsToOf);
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'piggy-dk']);
  });

  it('filters by merchant', () => {
    const out = filterMarketProducts(products, f({ merchant: 'Robotechy' }), resolve, shipsToOf);
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk']);
  });

  it('filters by ships-to country: named and worldwide listings, plus unknown by default', () => {
    const out = filterMarketProducts(products, f({ shipsTo: 'GB' }), resolve, shipsToOf);
    // merch-sv has no shipping info: kept while "include unknown" is on.
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk', 'merch-sv']);
  });

  it('hides listings without shipping info once the include toggle is off', () => {
    const out = filterMarketProducts(
      products,
      f({ shipsTo: 'GB', includeUnknownShipping: false }),
      resolve,
      shipsToOf,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk', 'badge-uk']);
  });

  it('ignores the include toggle while Ships to is Anywhere', () => {
    const out = filterMarketProducts(
      products,
      f({ includeUnknownShipping: false }),
      resolve,
      shipsToOf,
    );
    expect(out).toHaveLength(4);
  });

  it('never uses the vendor directory country (Robotechy is "United Kingdom" there)', () => {
    const out = filterMarketProducts(
      products,
      f({ shipsTo: 'DK', includeUnknownShipping: false }),
      resolve,
      shipsToOf,
    );
    expect(out.map((p) => p.id)).toEqual(['badge-uk', 'piggy-dk']);
  });

  it('filters by currency', () => {
    const out = filterMarketProducts(products, f({ currency: 'USD' }), resolve, shipsToOf);
    expect(out.map((p) => p.id)).toEqual(['merch-sv']);
  });

  it('composes search + merchant + ships-to + currency (AND semantics)', () => {
    const out = filterMarketProducts(
      products,
      f({ query: 'lightning', merchant: 'Robotechy', shipsTo: 'GB', currency: 'GBP' }),
      resolve,
      shipsToOf,
    );
    expect(out.map((p) => p.id)).toEqual(['piggy-uk']);
  });

  it('merchant AND ships-to compose (AND, not OR)', () => {
    // TBHS publishes no shipping info, so with unknown shipping hidden,
    // merchant "TBHS" AND ships-to "DK" yields nothing even though another
    // merchant ships there.
    const out = filterMarketProducts(
      products,
      f({ merchant: 'TBHS', shipsTo: 'DK', includeUnknownShipping: false }),
      resolve,
      shipsToOf,
    );
    expect(out).toEqual([]);
  });

  it('returns an empty array when nothing matches, without mutating input', () => {
    const copy = [...products];
    const out = filterMarketProducts(
      products,
      f({ query: 'lightning', shipsTo: 'SV' }),
      resolve,
      shipsToOf,
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
      f({ merchant: 'Robotechy', shipsTo: 'GB', currency: 'GBP' }),
      'wotFriends',
    ),
  ).toBe(4);
});
