import {
  formatMarketAmount,
  listingCategories,
  listingShippingRefs,
  listingStock,
  quoteListingShipping,
} from './marketListingShipping';
import type { ShippingOption } from './marketShipping';

const pk = 'a'.repeat(64);
const option = (d: string, baseAmount: number, currency: string): ShippingOption => ({
  coordinate: `30406:${pk}:${d}`,
  pubkey: pk,
  dTag: d,
  title: d,
  baseAmount,
  currency,
  countries: [],
  createdAt: 1,
});

describe('listingShippingRefs', () => {
  it('reads direct 30406 refs with their extra cost, ignoring junk and duplicates', () => {
    expect(
      listingShippingRefs({
        tags: [
          ['shipping_option', `30406:${pk}:uk`, '1.25'],
          ['shipping_option', `30406:${pk}:uk`, '9'],
          ['shipping_option', `30406:${pk}:world`],
          ['shipping_option', `30406:${pk}:neg`, '-3'],
          ['shipping_option', `30405:${pk}:collection`],
          ['shipping_option', 'garbage'],
        ],
      }),
    ).toEqual([
      { coordinate: `30406:${pk}:uk`, extraAmount: 1.25 },
      { coordinate: `30406:${pk}:world`, extraAmount: 0 },
      { coordinate: `30406:${pk}:neg`, extraAmount: 0 },
    ]);
  });
});

describe('quoteListingShipping', () => {
  const options = [option('uk', 3.5, 'GBP'), option('world', 12, 'USD'), option('free', 0, 'GBP')];
  const refs = listingShippingRefs({
    tags: [
      ['shipping_option', `30406:${pk}:uk`, '1.2'],
      ['shipping_option', `30406:${pk}:world`, '2'],
      ['shipping_option', `30406:${pk}:free`],
      ['shipping_option', `30406:${pk}:unpublished`],
    ],
  });

  it('adds the per-product extra cost to the base cost in the same currency', () => {
    const [uk] = quoteListingShipping('GBP', refs, options);
    expect(uk).toMatchObject({
      baseAmount: 3.5,
      extraAmount: 1.2,
      totalAmount: 4.7,
      currency: 'GBP',
    });
  });

  it('keeps base and extra apart when the currencies differ (extra is in the product currency)', () => {
    const world = quoteListingShipping('GBP', refs, options)[1];
    expect(world).toMatchObject({
      baseAmount: 12,
      extraAmount: 2,
      totalAmount: null,
      currency: 'USD',
    });
  });

  it('a free option with no extra costs nothing, and unpublished options are skipped', () => {
    const quotes = quoteListingShipping('GBP', refs, options);
    expect(quotes).toHaveLength(3);
    expect(quotes[2].totalAmount).toBe(0);
  });

  it('treats SAT and SATS as the same currency', () => {
    const [q] = quoteListingShipping(
      'SAT',
      [{ coordinate: `30406:${pk}:s`, extraAmount: 100 }],
      [option('s', 500, 'SATS')],
    );
    expect(q.totalAmount).toBe(600);
  });
});

describe('listing stock and categories', () => {
  it('parses stock as an integer or null', () => {
    expect(listingStock({ tags: [['stock', '6']] })).toBe(6);
    expect(listingStock({ tags: [['stock', 'lots']] })).toBeNull();
    expect(listingStock({ tags: [] })).toBeNull();
  });
  it('lists unique categories', () => {
    expect(
      listingCategories({
        tags: [
          ['t', 'art'],
          ['t', 'art'],
          ['t', 'pets'],
          ['t', ''],
        ],
      }),
    ).toEqual(['art', 'pets']);
  });
});

describe('formatMarketAmount', () => {
  it('uses whole sats, two-decimal fiat and up to 8-decimal BTC', () => {
    expect(formatMarketAmount(3.5, 'GBP')).toBe('3.50');
    expect(formatMarketAmount(12, 'usd')).toBe('12.00');
    expect(formatMarketAmount(2100.4, 'SATS')).toBe('2100');
    expect(formatMarketAmount(0.00012, 'BTC')).toBe('0.00012');
  });
});
