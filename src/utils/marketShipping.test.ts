import {
  parseShippingOptionEvent,
  dedupeNewestPerD,
  filterShippingOptions,
  shippingCostFor,
  shippingCostSats,
  orderTotalWithShippingSats,
  SHIPPING_OPTION_KIND,
  type ShippingOption,
} from './marketShipping';

const PK = 'a'.repeat(64);

function makeEvent(tags: string[][], createdAt = 1000) {
  return { kind: SHIPPING_OPTION_KIND, pubkey: PK, created_at: createdAt, tags };
}

function makeOption(over: Partial<ShippingOption>): ShippingOption {
  return {
    coordinate: `${SHIPPING_OPTION_KIND}:${PK}:std`,
    pubkey: PK,
    dTag: 'std',
    title: 'Standard',
    baseAmount: 5,
    currency: 'GBP',
    countries: [],
    createdAt: 1000,
    ...over,
  };
}

describe('parseShippingOptionEvent', () => {
  it('parses a full option: d, title, price, multi-value country tags', () => {
    const option = parseShippingOptionEvent(
      makeEvent([
        ['d', 'royal-mail-48'],
        ['title', 'Royal Mail Tracked 48'],
        ['price', '4.50', 'gbp'],
        ['country', 'gb', 'IE'],
        ['country', 'fr'],
      ]),
    );
    expect(option).toEqual(
      expect.objectContaining({
        coordinate: `${SHIPPING_OPTION_KIND}:${PK}:royal-mail-48`,
        dTag: 'royal-mail-48',
        title: 'Royal Mail Tracked 48',
        baseAmount: 4.5,
        currency: 'GBP',
        countries: ['GB', 'IE', 'FR'],
      }),
    );
  });

  it('treats an option with no country tags as worldwide (empty list)', () => {
    const option = parseShippingOptionEvent(makeEvent([['d', 'ww']]));
    expect(option?.countries).toEqual([]);
  });

  it('normalises alpha-3 country codes to alpha-2 (Robotechy publishes GBR/IRL/DEU…)', () => {
    // Mirrors Robotechy's live "UK & Ireland" option shape exactly.
    const option = parseShippingOptionEvent(
      makeEvent([
        ['d', 'shipping_1766246089306_r6nxd'],
        ['title', 'UK & Ireland'],
        ['price', '4.50', 'GBP'],
        ['country', 'GBR', 'IRL'],
      ]),
    );
    expect(option?.countries).toEqual(['GB', 'IE']);
    expect(filterShippingOptions([option!], 'GB')).toHaveLength(1);
    expect(filterShippingOptions([option!], 'DE')).toHaveLength(0);
  });

  it('falls back to the d tag when title is missing, and 0 for a bad price', () => {
    const option = parseShippingOptionEvent(
      makeEvent([
        ['d', 'mystery'],
        ['price', 'not-a-number', 'USD'],
      ]),
    );
    expect(option?.title).toBe('mystery');
    expect(option?.baseAmount).toBe(0);
  });

  it('rejects wrong kinds and events without a d tag', () => {
    expect(parseShippingOptionEvent({ ...makeEvent([['d', 'x']]), kind: 30402 })).toBeNull();
    expect(parseShippingOptionEvent(makeEvent([['title', 'No d']]))).toBeNull();
  });
});

describe('dedupeNewestPerD', () => {
  it('keeps only the newest revision per coordinate', () => {
    const older = makeOption({ createdAt: 100, title: 'Old' });
    const newer = makeOption({ createdAt: 200, title: 'New' });
    const other = makeOption({
      coordinate: `${SHIPPING_OPTION_KIND}:${PK}:express`,
      dTag: 'express',
    });
    const deduped = dedupeNewestPerD([older, newer, other]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((o) => o.dTag === 'std')?.title).toBe('New');
  });
});

describe('filterShippingOptions', () => {
  const worldwide = makeOption({ countries: [] });
  const ukOnly = makeOption({
    coordinate: `${SHIPPING_OPTION_KIND}:${PK}:uk`,
    dTag: 'uk',
    countries: ['GB'],
  });
  const eu = makeOption({
    coordinate: `${SHIPPING_OPTION_KIND}:${PK}:eu`,
    dTag: 'eu',
    countries: ['FR', 'DE', 'NL'],
  });

  it('matches restricted options by code (case-insensitive) plus worldwide ones', () => {
    const forUk = filterShippingOptions([worldwide, ukOnly, eu], 'gb');
    expect(forUk.map((o) => o.dTag)).toEqual(['std', 'uk']);
  });

  it('returns only worldwide options for an unlisted country', () => {
    expect(filterShippingOptions([worldwide, ukOnly, eu], 'US').map((o) => o.dTag)).toEqual([
      'std',
    ]);
  });

  it('returns nothing without a country code', () => {
    expect(filterShippingOptions([worldwide, ukOnly], '')).toEqual([]);
  });
});

describe('shippingCostFor', () => {
  it('is the base price without a product ref', () => {
    expect(shippingCostFor(makeOption({ baseAmount: 4.5 }))).toBe(4.5);
  });

  it('adds the product surcharge and ignores a negative one', () => {
    const option = makeOption({ baseAmount: 4.5 });
    expect(shippingCostFor(option, { coordinate: option.coordinate, extraAmount: 2 })).toBe(6.5);
    expect(shippingCostFor(option, { coordinate: option.coordinate, extraAmount: -3 })).toBe(4.5);
  });
});

describe('shippingCostSats', () => {
  it('passes SATS/SAT through and scales BTC by 1e8', () => {
    expect(shippingCostSats(500, 'SATS', null)).toBe(500);
    expect(shippingCostSats(500.4, 'sat', null)).toBe(500);
    expect(shippingCostSats(0.0001, 'BTC', null)).toBe(10000);
  });

  it('converts fiat via the BTC spot price', () => {
    // £4.50 at £60,000/BTC → 7,500 sats
    expect(shippingCostSats(4.5, 'GBP', 60000)).toBe(7500);
  });

  it('returns null for fiat without a rate, and for invalid amounts/rates', () => {
    expect(shippingCostSats(4.5, 'GBP', null)).toBeNull();
    expect(shippingCostSats(4.5, 'GBP', 0)).toBeNull();
    expect(shippingCostSats(-1, 'SATS', null)).toBeNull();
    expect(shippingCostSats(NaN, 'SATS', null)).toBeNull();
  });
});

describe('orderTotalWithShippingSats', () => {
  it('sums subtotal and shipping, treating invalid parts as 0', () => {
    expect(orderTotalWithShippingSats(1000, 500)).toBe(1500);
    expect(orderTotalWithShippingSats(1000, NaN)).toBe(1000);
    expect(orderTotalWithShippingSats(-5, 500)).toBe(500);
  });
});
