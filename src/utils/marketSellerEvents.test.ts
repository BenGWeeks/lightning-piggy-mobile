import { buildShopTemplate, parseShopDraft } from './marketSellerTestFixtures';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';
import {
  SHOP_COLLECTION_D,
  buildDeletionTemplate,
  buildListingTemplate,
  buildShippingZoneTemplate,
  coordinateOf,
  newIdentifier,
  nextCreatedAt,
  normaliseAmount,
  parseListingDraft,
  shopCoordinate,
  splitCategories,
  validateListingDraft,
  validateShop,
  zoneDraftFromOption,
  type EventTemplate,
  type ListingDraft,
  type ShippingZoneDraft,
} from './marketSellerEvents';
import { parseShippingOptionEvent } from './marketShipping';
import { parseMarketListing } from './marketListings';

const key = new Uint8Array(32).fill(3);
const pubkey = getPublicKey(key);
const sign = (template: EventTemplate, created_at = 1_800_000_000): Event =>
  finalizeEvent({ ...template, created_at }, key);
const zoneCoord = (d: string) => coordinateOf(30406, pubkey, d);

const draft = (over: Partial<ListingDraft> = {}): ListingDraft => ({
  dTag: 'item-abc',
  title: 'TEST — Knitted piggy',
  description: 'Hand knitted. **Not for sale.**',
  images: ['https://blossom.example/a.jpg', 'https://blossom.example/b.jpg'],
  price: '12.50',
  currency: 'GBP',
  quantity: '3',
  categories: ['crafts', 'kids-room'],
  collections: [],
  shipping: [
    { coordinate: zoneCoord('zone-uk'), extraCost: '1.25' },
    { coordinate: zoneCoord('zone-world'), extraCost: '' },
  ],
  ...over,
});

describe('listing events (kind 30402)', () => {
  it('round-trips build → sign → parse back to the same draft', () => {
    const event = sign(buildListingTemplate({ draft: draft(), pubkey, nowSeconds: 1_800_000_000 }));
    expect(event.kind).toBe(30402);
    expect(parseListingDraft(event)).toEqual(draft());
  });

  it('writes the Gamma Markets tags in spec shape', () => {
    const { tags, content } = buildListingTemplate({ draft: draft(), pubkey, nowSeconds: 1234 });
    expect(content).toBe('Hand knitted. **Not for sale.**');
    expect(tags).toEqual(
      expect.arrayContaining([
        ['d', 'item-abc'],
        ['title', 'TEST — Knitted piggy'],
        ['price', '12.50', 'GBP'],
        ['type', 'simple', 'physical'],
        ['visibility', 'on-sale'],
        ['stock', '3'],
        ['image', 'https://blossom.example/a.jpg', '', '0'],
        ['image', 'https://blossom.example/b.jpg', '', '1'],
        ['t', 'crafts'],
        ['shipping_option', zoneCoord('zone-uk'), '1.25'],
        ['shipping_option', zoneCoord('zone-world')],
        ['published_at', '1234'],
      ]),
    );
  });

  it('is readable by the Market reader with the same title, price and image', () => {
    const event = sign(buildListingTemplate({ draft: draft(), pubkey, nowSeconds: 1 }));
    const product = parseMarketListing(event, 0);
    expect(product).not.toBeNull();
    expect(product!.title).toBe('TEST — Knitted piggy');
    expect(product!.listing!.priceLabel).toBe('12.50 GBP');
    expect(product!.image).toBe('https://blossom.example/a.jpg');
  });

  it('marks a listing with no shipping as digital and omits untracked stock', () => {
    const { tags } = buildListingTemplate({
      draft: draft({ shipping: [], quantity: '' }),
      pubkey,
      nowSeconds: 1,
    });
    expect(tags).toContainEqual(['type', 'simple', 'digital']);
    expect(tags.find((t) => t[0] === 'stock')).toBeUndefined();
  });

  it('prices in whole sats', () => {
    const { tags } = buildListingTemplate({
      draft: draft({ currency: 'sats', price: '2100', shipping: [] }),
      pubkey,
      nowSeconds: 1,
    });
    expect(tags).toContainEqual(['price', '2100', 'SATS']);
    expect(validateListingDraft(draft({ currency: 'SATS', price: '21.5' }))).toContain('price');
  });

  it('keeps the d tag, published_at, visibility and foreign tags on edit', () => {
    const previous = sign({
      kind: 30402,
      content: 'old',
      tags: [
        ['d', 'item-abc'],
        ['title', 'Old'],
        ['price', '1', 'GBP'],
        ['visibility', 'pre-order'],
        ['published_at', '1700000000'],
        ['summary', 'Short blurb'],
        ['spec', 'colour', 'pink'],
        ['a', '30405:' + pubkey + ':other-collection'],
        ['a', shopCoordinate(pubkey)],
        ['image', 'https://old.example/x.jpg', '800x600', '0'],
        ['t', 'old'],
      ],
    });
    const { tags } = buildListingTemplate({
      draft: draft({ collections: ['30405:' + pubkey + ':other-collection'] }),
      pubkey,
      nowSeconds: 1_900_000_000,
      previous,
    });
    expect(tags).toContainEqual(['d', 'item-abc']);
    expect(tags).toContainEqual(['visibility', 'pre-order']);
    expect(tags).toContainEqual(['published_at', '1700000000']);
    expect(tags).toContainEqual(['summary', 'Short blurb']);
    expect(tags).toContainEqual(['spec', 'colour', 'pink']);
    expect(tags).toContainEqual(['a', '30405:' + pubkey + ':other-collection']);
    // Managed tags are replaced, not duplicated.
    expect(tags.filter((t) => t[0] === 'a' && t[1] === shopCoordinate(pubkey))).toHaveLength(0);
    expect(tags.filter((t) => t[0] === 'title')).toEqual([['title', 'TEST — Knitted piggy']]);
    expect(tags.find((t) => t[1] === 'https://old.example/x.jpg')).toBeUndefined();
    expect(tags).not.toContainEqual(['t', 'old']);
  });

  it('keeps a subscription frequency and the published physical format on edit', () => {
    const previous = sign({
      kind: 30402,
      content: '',
      tags: [
        ['d', 'item-abc'],
        ['price', '10', 'GBP', 'M'],
        ['type', 'simple', 'physical'],
      ],
    });
    const { tags } = buildListingTemplate({
      draft: draft({ shipping: [] }),
      pubkey,
      nowSeconds: 1,
      previous,
    });
    expect(tags).toContainEqual(['price', '12.50', 'GBP', 'M']);
    expect(tags).toContainEqual(['type', 'simple', 'physical']);
  });

  it('keeps image dimensions from the previous revision and edits SAT / BTC listings', () => {
    const previous = sign({
      kind: 30402,
      content: '',
      tags: [
        ['d', 'item-abc'],
        ['price', '2100', 'SAT'],
        ['image', 'https://blossom.example/a.jpg', '800x600', '0'],
      ],
    });
    const parsed = parseListingDraft(previous);
    expect(parsed.currency).toBe('SATS');
    expect(validateListingDraft({ ...parsed, title: 'x' })).toEqual([]);
    const { tags } = buildListingTemplate({
      draft: { ...parsed, title: 'x' },
      pubkey,
      nowSeconds: 1,
      previous,
    });
    expect(tags).toContainEqual(['image', 'https://blossom.example/a.jpg', '800x600', '0']);
    expect(tags).toContainEqual(['price', '2100', 'SATS']);
    expect(validateListingDraft(draft({ currency: 'BTC', price: '0.0005' }))).toEqual([]);
  });

  it('parses images in sort order and drops duplicates (Robotechy repeats images)', () => {
    const parsed = parseListingDraft({
      content: '',
      tags: [
        ['image', 'https://x.example/2.jpg', '800x600', '2'],
        ['image', 'https://x.example/1.jpg', '800x600', '1'],
        ['image', 'https://x.example/1.jpg', '800x600', '3'],
      ],
    });
    expect(parsed.images).toEqual(['https://x.example/1.jpg', 'https://x.example/2.jpg']);
  });

  it('never moves created_at backwards for a quick re-edit', () => {
    expect(nextCreatedAt(100, { created_at: 100 })).toBe(101);
    expect(nextCreatedAt(200.7, { created_at: 100 })).toBe(200);
    expect(nextCreatedAt(50)).toBe(50);
  });
});

describe('listing validation', () => {
  it('accepts a complete draft', () => {
    expect(validateListingDraft(draft())).toEqual([]);
  });
  it('flags each bad field', () => {
    expect(validateListingDraft(draft({ title: ' ' }))).toContain('title');
    expect(validateListingDraft(draft({ price: 'abc' }))).toContain('price');
    expect(validateListingDraft(draft({ currency: 'XYZ' }))).toContain('currency');
    expect(validateListingDraft(draft({ quantity: '-1' }))).toContain('quantity');
    expect(validateListingDraft(draft({ images: ['http://insecure.example/a.jpg'] }))).toContain(
      'images',
    );
    expect(
      validateListingDraft(draft({ shipping: [{ coordinate: zoneCoord('z'), extraCost: 'x' }] })),
    ).toContain('shipping');
  });
  it('normalises typed amounts', () => {
    expect(normaliseAmount('3,50', 'EUR')).toBe('3.50');
    expect(normaliseAmount(' 007 ', 'GBP')).toBe('7');
    expect(normaliseAmount('0.5', 'GBP')).toBe('0.5');
    expect(normaliseAmount('1e3', 'GBP')).toBeNull();
    expect(normaliseAmount('', 'GBP')).toBeNull();
    expect(normaliseAmount('10.5', 'SATS')).toBeNull();
  });
  it('splits categories into lower-case unique tags', () => {
    expect(splitCategories('Art, #Prints,art,\n kids room ')).toEqual([
      'art',
      'prints',
      'kids room',
    ]);
  });
  it('mints distinct identifiers', () => {
    expect(newIdentifier('item', 1000, () => 0.123456789)).toMatch(/^item-rs-[0-9a-z]{6}$/);
    expect(newIdentifier('item')).not.toBe(newIdentifier('item'));
  });
});

describe('shipping zones (kind 30406)', () => {
  const zone: ShippingZoneDraft = {
    dTag: 'zone-uk',
    name: 'UK Royal Mail',
    countries: ['gb', 'GB', 'IM'],
    cost: '3.5',
    currency: 'GBP',
  };

  it('round-trips through the checkout parser', () => {
    const event = sign(buildShippingZoneTemplate({ ...zone, currency: 'gbp' }));
    const option = parseShippingOptionEvent(event)!;
    expect(option).toMatchObject({
      coordinate: zoneCoord('zone-uk'),
      title: 'UK Royal Mail',
      baseAmount: 3.5,
      currency: 'GBP',
      countries: ['GB', 'IM'],
    });
    expect(zoneDraftFromOption(option)).toEqual({ ...zone, countries: ['GB', 'IM'] });
    expect(event.tags).toContainEqual(['service', 'standard']);
  });

  it('omits the country tag for worldwide (an empty tag is rejected by readers)', () => {
    const event = sign(buildShippingZoneTemplate({ ...zone, countries: [], currency: 'GBP' }));
    expect(event.tags.find((t) => t[0] === 'country')).toBeUndefined();
    expect(parseShippingOptionEvent(event)!.countries).toEqual([]);
  });

  it('keeps the previous service and foreign tags', () => {
    const previous = sign({
      kind: 30406,
      content: 'Tracked',
      tags: [
        ['d', 'zone-uk'],
        ['service', 'express'],
        ['duration', '1', '2', 'D'],
      ],
    });
    const { tags, content } = buildShippingZoneTemplate(zone, previous);
    expect(content).toBe('Tracked');
    expect(tags).toContainEqual(['service', 'express']);
    expect(tags).toContainEqual(['duration', '1', '2', 'D']);
    expect(tags.filter((t) => t[0] === 'service')).toHaveLength(1);
  });

  it("keeps each zone's own currency (a USD zone in a GBP shop stays USD)", () => {
    const us = sign(buildShippingZoneTemplate({ ...zone, dTag: 'us', cost: '5', currency: 'USD' }));
    const draft = zoneDraftFromOption(parseShippingOptionEvent(us)!);
    expect(draft.currency).toBe('USD');
    expect(buildShippingZoneTemplate(draft, us).tags).toContainEqual(['price', '5', 'USD']);
    expect(validateShop({ currency: 'GBP' }, [draft])).toEqual([]);
  });

  it('rejects a bad cost', () => {
    expect(() => buildShippingZoneTemplate({ ...zone, cost: 'free', currency: 'GBP' })).toThrow();
  });
});

describe('shop collection (kind 30405)', () => {
  it('round-trips name, description and currency, listing products and zones', () => {
    const template = buildShopTemplate({
      shop: { name: ' Big Piggy Crafts ', description: 'TEST shop', currency: 'eur' },
      pubkey,
      productCoordinates: [coordinateOf(30402, pubkey, 'a'), coordinateOf(30402, pubkey, 'a')],
      zoneCoordinates: [zoneCoord('zone-uk')],
    });
    const event = sign(template);
    expect(event.tags).toContainEqual(['d', SHOP_COLLECTION_D]);
    expect(event.tags.filter((t) => t[0] === 'a')).toEqual([
      ['a', coordinateOf(30402, pubkey, 'a')],
    ]);
    expect(event.tags).toContainEqual(['shipping_option', zoneCoord('zone-uk')]);
    expect(parseShopDraft(event, [])).toEqual({
      name: 'Big Piggy Crafts',
      description: 'TEST shop',
      currency: 'EUR',
    });
  });

  it('falls back to the zone currency when the shop has no currency tag', () => {
    const option = parseShippingOptionEvent(
      sign(
        buildShippingZoneTemplate({
          dTag: 'z',
          name: 'Z',
          countries: [],
          cost: '1',
          currency: 'USD',
        }),
      ),
    )!;
    expect(parseShopDraft({ content: '', tags: [['title', 'X']] }, [option])!.currency).toBe('USD');
    expect(parseShopDraft(null, [])).toBeNull();
  });

  it('validates the settings form', () => {
    const shop = { name: 'Shop', description: '', currency: 'GBP' };
    const ok: ShippingZoneDraft = {
      dTag: 'z',
      name: 'UK',
      countries: ['GB'],
      cost: '2',
      currency: 'GBP',
    };
    expect(validateShop(shop, [ok])).toEqual([]);
    expect(validateShop({ currency: 'GBP' }, [])).toEqual([]);
    expect(validateShop(shop, [{ ...ok, name: '' }])).toContain('zoneName');
    expect(validateShop(shop, [{ ...ok, cost: '' }])).toContain('zoneCost');
    expect(validateShop(shop, [{ ...ok, countries: ['ZZ'] }])).toContain('zoneCountries');
  });
});

describe('deletion (kind 5)', () => {
  it('targets the address, the exact revision and the kind', () => {
    const coord = coordinateOf(30402, pubkey, 'item-abc');
    expect(
      buildDeletionTemplate([
        { kind: 30402, coordinate: coord, eventId: 'f'.repeat(64) },
        { kind: 30406, coordinate: zoneCoord('z') },
      ]),
    ).toEqual({
      kind: 5,
      content: '',
      tags: [
        ['a', coord],
        ['e', 'f'.repeat(64)],
        ['a', zoneCoord('z')],
        ['k', '30402'],
        ['k', '30406'],
      ],
    });
  });
});
