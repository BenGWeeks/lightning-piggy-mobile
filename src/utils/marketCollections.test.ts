import { finalizeEvent, getPublicKey } from 'nostr-tools';
import {
  buildCollectionTemplate,
  parseCollection,
  isLegacyShopCollection,
} from './marketCollections';
import { buildListingTemplate, parseListingDraft, SHOP_COLLECTION_D } from './marketSellerEvents';
import { reduceSellerSnapshot } from './marketSellerSnapshot';
const key = new Uint8Array(32).fill(4);
const pubkey = getPublicKey(key);
const product = `30402:${pubkey}:prints`;
const collection = `30405:${pubkey}:art`;
const draft = {
  dTag: 'art',
  title: ' Art ',
  summary: 'Prints',
  image: 'https://example.com/art.jpg',
  location: 'London',
  shipping: [`30406:${pubkey}:uk`],
  products: [product, product],
};
const sign = (template: ReturnType<typeof buildCollectionTemplate>, at = 100) =>
  finalizeEvent({ ...template, created_at: at }, key);
it('builds a Gamma collection with product references and shared attributes, without shop currency', () => {
  const template = buildCollectionTemplate(draft);
  expect(template).toEqual({
    kind: 30405,
    content: '',
    tags: [
      ['d', 'art'],
      ['title', 'Art'],
      ['summary', 'Prints'],
      ['image', draft.image],
      ['location', 'London'],
      ['a', product],
      ['shipping_option', draft.shipping[0]],
    ],
  });
  expect(parseCollection(template)).toEqual({ ...draft, title: 'Art', products: [product] });
});
it('preserves content, geohash and extensions from the current collection revision', () => {
  const previous = sign({
    kind: 30405,
    content: 'Markdown',
    tags: [
      ['g', 'abc'],
      ['custom', 'keep'],
      ['title', 'Old'],
    ],
  });
  expect(buildCollectionTemplate(draft, previous)).toMatchObject({
    content: 'Markdown',
    tags: expect.arrayContaining([
      ['g', 'abc'],
      ['custom', 'keep'],
    ]),
  });
});
it('uses explicit multiple collection a tags and preserves a variation parent', () => {
  const listing = {
    dTag: 'print',
    title: 'Print',
    description: '',
    images: [],
    price: '1',
    currency: 'GBP',
    quantity: '1',
    categories: [],
    shipping: [],
    collections: [collection, collection, `30405:${pubkey}:new`],
  };
  const previous = sign({
    kind: 30402,
    content: '',
    tags: [
      ['a', product],
      ['a', `30405:${pubkey}:removed`],
      ['type', 'variation', 'physical'],
    ],
  });
  const template = buildListingTemplate({ draft: listing, pubkey, nowSeconds: 100, previous });
  expect(template.tags.filter((t) => t[0] === 'a')).toEqual([
    ['a', collection],
    ['a', `30405:${pubkey}:new`],
    ['a', product],
  ]);
  expect(parseListingDraft(template).collections).toEqual([collection, `30405:${pubkey}:new`]);
  expect(
    buildListingTemplate({
      draft: { ...listing, collections: [] },
      pubkey,
      nowSeconds: 100,
    }).tags.some((t) => t[0] === 'a'),
  ).toBe(false);
});
it('detects only the app-created legacy identifier plus currency marker', () => {
  const legacy = sign({
    kind: 30405,
    content: '',
    tags: [
      ['d', SHOP_COLLECTION_D],
      ['title', 'Shop'],
      ['currency', 'GBP'],
    ],
  });
  expect(isLegacyShopCollection(legacy)).toBe(true);
  expect(
    isLegacyShopCollection({
      ...legacy,
      tags: [
        ['d', SHOP_COLLECTION_D],
        ['title', 'Shop'],
      ],
    }),
  ).toBe(false);
  expect(
    isLegacyShopCollection({
      ...legacy,
      tags: [
        ['d', 'art'],
        ['currency', 'GBP'],
      ],
    }),
  ).toBe(false);
  expect(isLegacyShopCollection(null)).toBe(false);
});
it('retains every collection and applies NIP-09 deletion without hiding products', () => {
  const first = sign(buildCollectionTemplate(draft));
  const second = sign(buildCollectionTemplate({ ...draft, dTag: 'new' }));
  const deletion = sign(
    {
      kind: 5,
      content: '',
      tags: [
        ['a', collection],
        ['e', first.id],
        ['k', '30405'],
      ],
    },
    101,
  );
  expect(reduceSellerSnapshot([first, second], pubkey).collections).toEqual([first, second]);
  expect(reduceSellerSnapshot([first, second, deletion], pubkey).collections).toEqual([second]);
});

it('keeps a legitimate lightning-piggy-shop collection selected when saving a listing', () => {
  const legitimate = sign(buildCollectionTemplate({ ...draft, dTag: SHOP_COLLECTION_D }));
  expect(isLegacyShopCollection(legitimate)).toBe(false);
  const coordinate = `30405:${pubkey}:${SHOP_COLLECTION_D}`;
  const previous = sign({
    kind: 30402,
    content: 'Print',
    tags: [
      ['d', 'print'],
      ['title', 'Print'],
      ['price', '1', 'GBP'],
      ['a', coordinate],
    ],
  });
  const listing = parseListingDraft(previous);
  expect(listing.collections).toEqual([coordinate]);
  const saved = buildListingTemplate({ draft: listing, pubkey, nowSeconds: 101, previous });
  expect(saved.tags).toContainEqual(['a', coordinate]);
  expect(parseListingDraft(saved).collections).toEqual([coordinate]);

  const removed = buildListingTemplate({
    draft: { ...listing, collections: [] },
    pubkey,
    nowSeconds: 102,
    previous,
  });
  expect(removed.tags).not.toContainEqual(['a', coordinate]);
});
