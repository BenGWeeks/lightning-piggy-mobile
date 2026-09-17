import {
  parseShippingOptionEvent,
  dedupeNewestPerCoordinate,
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
    const option = parseShippingOptionEvent(
      makeEvent([
        ['d', 'ww'],
        ['price', '0', 'SATS'],
      ]),
    );
    expect(option?.countries).toEqual([]);
  });

  it('rejects an option whose country tag carries an unknown code', () => {
    expect(
      parseShippingOptionEvent(
        makeEvent([
          ['d', 'zz'],
          ['price', '1', 'GBP'],
          ['country', 'ZZZ'],
        ]),
      ),
    ).toBeNull();
    expect(
      parseShippingOptionEvent(makeEvent([['d', 'mix'], ['price', '1', 'GBP'], ['country', 'GB', 'XQ']])), // prettier-ignore
    ).toBeNull();
  });

  it('rejects a present-but-empty country tag instead of treating it as worldwide', () => {
    expect(
      parseShippingOptionEvent(makeEvent([['d', 'bad'], ['price', '1', 'GBP'], ['country']])),
    ).toBeNull();
    expect(
      parseShippingOptionEvent(
        makeEvent([
          ['d', 'bad2'],
          ['price', '1', 'GBP'],
          ['country', ' '],
        ]),
      ),
    ).toBeNull();
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

  it('falls back to the d tag for a valid free option', () => {
    const option = parseShippingOptionEvent(
      makeEvent([
        ['d', 'free'],
        ['price', '0', 'SATS'],
      ]),
    );
    expect(option?.title).toBe('free');
    expect(option?.baseAmount).toBe(0);
  });

  it.each(['', ' ', 'not-a-number', '-1', 'Infinity'])('rejects invalid price %s', (price) => {
    expect(
      parseShippingOptionEvent(
        makeEvent([
          ['d', 'bad'],
          ['price', price, 'USD'],
        ]),
      ),
    ).toBeNull();
  });

  it('rejects absent price or currency', () => {
    expect(parseShippingOptionEvent(makeEvent([['d', 'bad']]))).toBeNull();
    expect(
      parseShippingOptionEvent(
        makeEvent([
          ['d', 'bad'],
          ['price', '0'],
        ]),
      ),
    ).toBeNull();
  });

  it('rejects wrong kinds and events without a d tag', () => {
    expect(parseShippingOptionEvent({ ...makeEvent([['d', 'x']]), kind: 30402 })).toBeNull();
    expect(parseShippingOptionEvent(makeEvent([['title', 'No d']]))).toBeNull();
  });
});

describe('dedupeNewestPerCoordinate', () => {
  it('keeps only the newest revision per coordinate', () => {
    const older = makeOption({ createdAt: 100, title: 'Old' });
    const newer = makeOption({ createdAt: 200, title: 'New' });
    const other = makeOption({
      coordinate: `${SHIPPING_OPTION_KIND}:${PK}:express`,
      dTag: 'express',
    });
    const deduped = dedupeNewestPerCoordinate([older, newer, other]);
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

  it('ignores a surcharge whose ref points at a DIFFERENT option', () => {
    const option = makeOption({ baseAmount: 4.5 });
    expect(
      shippingCostFor(option, {
        coordinate: `${SHIPPING_OPTION_KIND}:${PK}:other`,
        extraAmount: 2,
      }),
    ).toBe(4.5);
  });
});

describe('shippingCostSats — free options', () => {
  it('converts a zero fiat cost to 0 sats without needing a rate', () => {
    expect(shippingCostSats(0, 'GBP', null)).toBe(0);
    expect(shippingCostSats(0, 'SATS', null)).toBe(0);
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
  it('sums valid amounts and rejects invalid or unsafe totals', () => {
    expect(orderTotalWithShippingSats(1000, 500)).toBe(1500);
    expect(orderTotalWithShippingSats(1000, NaN)).toBeNull();
    expect(orderTotalWithShippingSats(-5, 500)).toBeNull();
  });
});

test('shipping conversion and addition reject overflow', () => {
  expect(shippingCostSats(1e308, 'BTC', null)).toBeNull();
  expect(shippingCostSats(1e308, 'GBP', 0.00001)).toBeNull();
  expect(shippingCostSats(Number.MAX_SAFE_INTEGER + 1, 'SATS', null)).toBeNull();
  expect(orderTotalWithShippingSats(Number.MAX_SAFE_INTEGER, 1)).toBeNull();
  expect(orderTotalWithShippingSats(1.1, 2)).toBeNull();
});
