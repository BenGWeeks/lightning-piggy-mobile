import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { MARKET_VENDORS } from '../data/marketVendors';
import { COUNTRIES, localizedCountryName } from '../data/countries';
import { parseShippingOptionEvent, type ShippingOption } from './marketShipping';
import {
  isDigitalListing,
  listingShipsTo,
  normalizeShipsToSelection,
  productShipsTo,
  shippingCoordinatesOf,
  shipsToMatches,
  shipsToOptions,
  type ShipsTo,
} from './marketShipsTo';

const SELLER = 'a'.repeat(64);
const coord = (d: string) => `30406:${SELLER}:${d}`;

/** A kind-30406 option exactly as a seller publishes it (Gamma spec tags). */
function published(d: string, extraTags: string[][]): ShippingOption {
  const option = parseShippingOptionEvent({
    kind: 30406,
    pubkey: SELLER,
    created_at: 1,
    tags: [['d', d], ['title', d], ['price', '5', 'GBP'], ['service', 'standard'], ...extraTags],
  });
  if (!option) throw new Error(`fixture ${d} did not parse`);
  return option;
}

const OPTIONS: Record<string, ShippingOption> = {
  uk: published('uk', [['country', 'GB']]),
  eu: published('eu', [['country', 'DE', 'FRA', 'ie']]),
  florida: published('florida', [
    ['country', 'US'],
    ['region', 'US-FL'],
  ]),
  world: published('world', []),
};
/** Fetch finished: published options resolve, anything else is missing. */
const fetched = (c: string) => Object.values(OPTIONS).find((o) => o.coordinate === c) ?? null;
const notFetchedYet = () => undefined;

const listing = (tags: string[][], kind = 30402): Pick<Event, 'kind' | 'tags'> => ({
  kind,
  tags: [['d', 'item'], ...tags],
});
const ref = (d: string, extra?: string) =>
  extra ? ['shipping_option', coord(d), extra] : ['shipping_option', coord(d)];

const product = (id: string, event?: Pick<Event, 'kind' | 'tags'>): MarketProduct =>
  ({
    id,
    title: id,
    description: '',
    priceSats: 1,
    priceFiatLabel: '1 SATS',
    image: '',
    sellerName: 'Robotechy',
    url: 'https://example.com',
    featured: false,
    ...(event
      ? { listing: { event: { ...event, pubkey: SELLER } as Event, currency: 'SATS', priceLabel: '1 SATS', vendor: MARKET_VENDORS[0] } } // prettier-ignore
      : {}),
  }) as MarketProduct;

describe('isDigitalListing', () => {
  it('reads the Gamma type tag format', () => {
    expect(isDigitalListing(listing([['type', 'simple', 'digital']]))).toBe(true);
    expect(isDigitalListing(listing([['type', 'simple', 'DIGITAL']]))).toBe(true);
    expect(isDigitalListing(listing([['type', 'simple', 'physical']]))).toBe(false);
  });
  it('does not treat a missing type tag (NIP-99 classifieds) as digital', () => {
    expect(isDigitalListing(listing([]))).toBe(false);
  });
  it('only applies to kind 30402', () => {
    expect(isDigitalListing(listing([['type', 'simple', 'digital']], 30018))).toBe(false);
  });
});

describe('listingShipsTo', () => {
  it('unions the countries of every referenced option (alpha-3 normalised)', () => {
    expect(listingShipsTo(listing([ref('uk'), ref('eu', '2')]), fetched)).toEqual({
      kind: 'countries',
      countries: ['DE', 'FR', 'GB', 'IE'],
    });
  });

  it('counts a region-restricted option for its country', () => {
    expect(listingShipsTo(listing([ref('florida')]), fetched)).toEqual({
      kind: 'countries',
      countries: ['US'],
    });
  });

  it('is worldwide when any referenced option has no country restriction', () => {
    expect(listingShipsTo(listing([ref('uk'), ref('world')]), fetched)).toEqual({
      kind: 'anywhere',
      reason: 'worldwide',
    });
  });

  it('is digital (anywhere) without needing shipping data', () => {
    expect(listingShipsTo(listing([['type', 'simple', 'digital']]), notFetchedYet)).toEqual({
      kind: 'anywhere',
      reason: 'digital',
    });
  });

  it('is unknown with no shipping refs, or when no referenced option is published', () => {
    expect(listingShipsTo(listing([]), fetched).kind).toBe('unknown');
    expect(listingShipsTo(listing([ref('gone')]), fetched).kind).toBe('unknown');
    // Collection (30405) shipping refs aren't expanded by the Market reader.
    const viaCollection = ['shipping_option', `30405:${SELLER}:shop`];
    expect(listingShipsTo(listing([viaCollection]), fetched).kind).toBe('unknown');
  });

  it('is pending while referenced options are still being fetched', () => {
    expect(listingShipsTo(listing([ref('uk')]), notFetchedYet).kind).toBe('pending');
  });

  it('answers with the resolved countries even while other refs are pending', () => {
    const partial = (c: string) => (c === coord('uk') ? OPTIONS.uk : undefined);
    expect(listingShipsTo(listing([ref('uk'), ref('eu')]), partial)).toEqual({
      kind: 'countries',
      countries: ['GB'],
    });
  });
});

describe('productShipsTo', () => {
  it('treats curated (non-Nostr) catalogue products as unknown — no vendor-directory guess', () => {
    // Robotechy's directory entry says "United Kingdom"; that must not leak in.
    expect(productShipsTo(product('curated'), fetched)).toEqual({ kind: 'unknown' });
  });
  it('reads a relay listing from its shipping options', () => {
    expect(productShipsTo(product('relay', listing([ref('uk')])), fetched)).toEqual({
      kind: 'countries',
      countries: ['GB'],
    });
  });
});

describe('shippingCoordinatesOf', () => {
  it('collects distinct 30406 refs across listings, skipping digital and curated products', () => {
    const products = [
      product('a', listing([ref('uk'), ref('eu')])),
      product('b', listing([ref('uk')])),
      product('c', listing([ref('world'), ['type', 'simple', 'digital']])),
      product('curated'),
    ];
    expect(shippingCoordinatesOf(products).sort()).toEqual([coord('eu'), coord('uk')]);
  });
});

describe('shipsToMatches', () => {
  const gb: ShipsTo = { kind: 'countries', countries: ['GB', 'IE'] };
  it('passes everything when Ships to is Anywhere', () => {
    expect(shipsToMatches({ kind: 'unknown' }, null, false)).toBe(true);
    expect(shipsToMatches(gb, null, false)).toBe(true);
  });
  it('matches named countries only', () => {
    expect(shipsToMatches(gb, 'IE', false)).toBe(true);
    expect(shipsToMatches(gb, 'US', true)).toBe(false);
  });
  it('matches worldwide and digital listings for every country', () => {
    expect(shipsToMatches({ kind: 'anywhere', reason: 'worldwide' }, 'JP', false)).toBe(true);
    expect(shipsToMatches({ kind: 'anywhere', reason: 'digital' }, 'JP', false)).toBe(true);
  });
  it('keeps unknown/pending shipping only while the include toggle is on', () => {
    for (const shipsTo of [{ kind: 'unknown' }, { kind: 'pending' }] as ShipsTo[]) {
      expect(shipsToMatches(shipsTo, 'GB', true)).toBe(true);
      expect(shipsToMatches(shipsTo, 'GB', false)).toBe(false);
    }
  });
});

describe('shipsToOptions', () => {
  const data: ShipsTo[] = [
    { kind: 'countries', countries: ['US', 'GB'] },
    { kind: 'countries', countries: ['DE', 'GB'] },
    { kind: 'anywhere', reason: 'worldwide' },
    { kind: 'unknown' },
  ];
  const en = (code: string) => localizedCountryName(code, 'en');

  it('ranks distinct countries by listing count, then name', () => {
    expect(shipsToOptions(data, { deviceCountry: null, selected: null, nameOf: en })).toEqual([
      'GB', // Named by two listings
      'DE', // Germany
      'US', // United States
    ]);
  });

  it("puts the phone's country first when the data has it", () => {
    expect(shipsToOptions(data, { deviceCountry: 'US', selected: null, nameOf: en })).toEqual([
      'US',
      'GB',
      'DE',
    ]);
  });

  it("always offers the phone's country even when no listing names it", () => {
    expect(shipsToOptions(data, { deviceCountry: 'JP', selected: null, nameOf: en })).toEqual([
      'JP',
      'GB',
      'DE',
      'US',
    ]);
  });

  it('keeps a saved selection visible (so it can be cleared) even if no listing names it', () => {
    expect(shipsToOptions(data, { deviceCountry: 'US', selected: 'JP', nameOf: en })).toEqual([
      'US',
      'JP',
      'GB',
      'DE',
    ]);
  });

  it('offers the phone country when all loaded listings ship worldwide', () => {
    expect(
      shipsToOptions([{ kind: 'anywhere', reason: 'worldwide' }], {
        deviceCountry: 'GB',
        selected: null,
        nameOf: en,
      }),
    ).toEqual(['GB']);
  });

  it('keeps a picker selection visible with no country-restricted listings', () => {
    expect(shipsToOptions([], { deviceCountry: 'GB', selected: 'JP', nameOf: en })).toEqual([
      'GB',
      'JP',
    ]);
    expect(shipsToOptions([], { deviceCountry: 'GB', selected: 'GB', nameOf: en })).toEqual(['GB']);
    expect(shipsToOptions([], { deviceCountry: null, selected: 'JP', nameOf: en })).toEqual(['JP']);
  });

  it('pins a selected country ahead of popular candidates and caps extras at six', () => {
    const countries = ['AF', 'AL', 'AD', 'AU', 'AT', 'BE', 'BR', 'CA', 'JP', 'US'];
    const options = shipsToOptions(
      [
        { kind: 'countries', countries },
        { kind: 'countries', countries: ['CA', 'CA'] },
        { kind: 'countries', countries: ['BR'] },
      ],
      { deviceCountry: 'US', selected: 'JP', nameOf: en },
    );
    expect(options).toEqual(['US', 'JP', 'BR', 'CA', 'AF', 'AL', 'AD', 'AU']);
    expect(
      shipsToOptions([{ kind: 'countries', countries }], {
        deviceCountry: null,
        selected: null,
        nameOf: en,
      }),
    ).toHaveLength(6);
  });

  it('keeps an explicitly worldwide option out of chips while matching its named countries', () => {
    const codes = COUNTRIES.map(({ code }) => code);
    const world = published('explicit-world', [['country', ...codes]]);
    const reach = listingShipsTo(listing([ref('explicit-world')]), () => world);
    const chips = shipsToOptions([reach], {
      deviceCountry: 'US',
      selected: 'JP',
      nameOf: en,
    });
    // The component adds Anywhere and More countries around this country list.
    expect(chips).toEqual(['US', 'JP']);
    expect(chips.length + 1).toBeLessThanOrEqual(8);
    for (const code of codes) expect(shipsToMatches(reach, code, false)).toBe(true);
    expect(shipsToMatches(reach, 'ZZ', false)).toBe(false);
  });

  it('excludes broad options at the 50-country boundary but retains narrow options', () => {
    const codes = COUNTRIES.slice(0, 50).map(({ code }) => code);
    const broad = published('broad', [['country', ...codes]]);
    const narrow = published('narrow', [['country', ...codes.slice(0, 49)]]);
    const lookup = (coordinate: string) => (coordinate === broad.coordinate ? broad : OPTIONS.uk);
    const reach = listingShipsTo(listing([ref('broad'), ref('uk')]), lookup);
    expect(shipsToOptions([reach], { deviceCountry: null, selected: null, nameOf: en })).toEqual([
      'GB',
    ]);
    expect(
      shipsToOptions([listingShipsTo(listing([ref('narrow')]), () => narrow)], {
        deviceCountry: null,
        selected: null,
        nameOf: en,
      }),
    ).toHaveLength(6);
  });

  it('does not mistake a union of narrow options for a single worldwide option', () => {
    const codes = COUNTRIES.slice(0, 60).map(({ code }) => code);
    const a = published('a', [['country', ...codes.slice(0, 30)]]);
    const b = published('b', [['country', ...codes.slice(30)]]);
    const reach = listingShipsTo(listing([ref('a'), ref('b')]), (coordinate) =>
      coordinate === a.coordinate ? a : b,
    );
    expect(
      shipsToOptions([reach], { deviceCountry: null, selected: null, nameOf: en }),
    ).toHaveLength(6);
  });

  it('sorts equally frequent countries by localised name in the display locale', () => {
    const de = (code: string) => localizedCountryName(code, 'de');
    // Deutschland, Vereinigtes Königreich, Vereinigte Staaten
    expect(
      shipsToOptions([data[0], data[1], { kind: 'countries', countries: ['DE', 'US'] }], {
        deviceCountry: null,
        selected: null,
        nameOf: de,
        locale: 'de',
      }),
    ).toEqual(['DE', 'US', 'GB']);
  });
});

describe('normalizeShipsToSelection (persisted value migration)', () => {
  it('accepts ISO alpha-2 / alpha-3 codes in any case', () => {
    expect(normalizeShipsToSelection('gb')).toBe('GB');
    expect(normalizeShipsToSelection('DEU')).toBe('DE');
  });
  it("drops the retired Country filter's vendor names and junk", () => {
    expect(normalizeShipsToSelection('United Kingdom')).toBeNull();
    expect(normalizeShipsToSelection('ZZ')).toBeNull();
    expect(normalizeShipsToSelection(42)).toBeNull();
    expect(normalizeShipsToSelection(null)).toBeNull();
  });
});
