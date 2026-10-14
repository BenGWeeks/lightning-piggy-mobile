import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import {
  MAX_PRODUCT_PAGE_CHAIN,
  RECOMMENDATION_LIMIT,
  listingAddress,
  mergeCatalogue,
  productPageAction,
  recommendListings,
  recommendationCardId,
  sellerListings,
  shouldShowRecommendations,
} from './marketRecommendations';

const SELLER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const FRIEND = 'c'.repeat(64);
const VIEWER = 'd'.repeat(64);
const NOW = 2_000_000;

let seq = 0;
function listing(
  d: string,
  opts: {
    pubkey?: string;
    createdAt?: number;
    tags?: string[][];
    kind?: number;
    id?: string;
  } = {},
): MarketProduct {
  const pubkey = opts.pubkey ?? SELLER;
  const kind = opts.kind ?? 30402;
  const id = opts.id ?? (++seq).toString(16).padStart(64, '0');
  const event = {
    id,
    pubkey,
    kind,
    created_at: opts.createdAt ?? 1_000_000 + seq,
    content: '',
    sig: '',
    tags: [['d', d], ['title', d], ...(opts.tags ?? [])],
  } as Event;
  return {
    id: `nostr-${kind}-${pubkey}-${d}`,
    title: d,
    description: '',
    priceSats: 1,
    priceFiatLabel: '1 SAT',
    image: '',
    sellerName: 'seller',
    url: 'https://example.com',
    featured: false,
    listing: {
      event,
      currency: 'SAT',
      priceLabel: '1 SAT',
      vendor: {
        name: 'seller',
        country: '',
        shippingRegions: [],
        shopType: 'online',
        description: '',
        url: '',
        logo: '',
        nostrUrl: '',
        xUrl: '',
        featured: false,
      },
    },
  };
}

const ids = (products: readonly MarketProduct[]) => products.map((p) => p.title);
const noSignals = { followed: new Set<string>() };

describe('mergeCatalogue', () => {
  it('keeps only active kind-30402 listings, newest first', () => {
    const products = [
      listing('old', { createdAt: 10 }),
      listing('new', { createdAt: 30 }),
      listing('nip15', { createdAt: 40, kind: 30018 }),
      listing('expired', { createdAt: 50, tags: [['expiration', String(NOW - 1)]] }),
      listing('sold', { createdAt: 60, tags: [['status', 'sold']] }),
      listing('hidden', { createdAt: 70, tags: [['visibility', 'hidden']] }),
      listing('future', { createdAt: 20, tags: [['expiration', String(NOW + 100)]] }),
    ];
    const { products: merged } = mergeCatalogue([{ mode: 'preferred', products }], NOW);
    expect(ids(merged)).toEqual(['new', 'future', 'old']);
  });

  it('de-duplicates a listing across snapshots, keeping the newest revision', () => {
    const older = listing('same', { createdAt: 10 });
    const newer = listing('same', { createdAt: 20 });
    const { products } = mergeCatalogue(
      [
        { mode: 'wotFriends', products: [older] },
        { mode: 'preferred', products: [newer] },
      ],
      NOW,
    );
    expect(products).toHaveLength(1);
    expect(products[0].listing!.event.created_at).toBe(20);
  });

  it('records the mode each seller was loaded under, preferring the preferred catalogue', () => {
    const { modeBySeller } = mergeCatalogue(
      [
        { mode: 'wotFriends', products: [listing('x', { pubkey: SELLER })] },
        { mode: 'preferred', products: [listing('y', { pubkey: SELLER })] },
        { mode: 'wotFriends', products: [listing('z', { pubkey: FRIEND })] },
      ],
      NOW,
    );
    expect(modeBySeller.get(SELLER)).toBe('preferred');
    expect(modeBySeller.get(FRIEND)).toBe('wotFriends');
  });
});

describe('sellerListings', () => {
  it("returns the seller's other listings newest first, excluding the current one", () => {
    const current = listing('current', { createdAt: 50 });
    const catalogue = [
      current,
      listing('a', { createdAt: 10 }),
      listing('b', { createdAt: 40 }),
      listing('someone-else', { pubkey: OTHER, createdAt: 60 }),
    ];
    expect(ids(sellerListings(catalogue, SELLER, current, 12, NOW))).toEqual(['b', 'a']);
  });

  it('excludes a refreshed revision of the current listing (same address)', () => {
    const current = listing('current', { createdAt: 50 });
    const revision = { ...listing('current', { createdAt: 60 }), id: 'refreshed-id' };
    expect(listingAddress(revision)).toBe(listingAddress(current));
    expect(sellerListings([revision], SELLER, current, 12, NOW)).toEqual([]);
  });

  it('drops hidden, sold and expired listings even from an aged snapshot', () => {
    const current = listing('current');
    const catalogue = [
      listing('hidden', { tags: [['visibility', 'hidden']] }),
      listing('sold', { tags: [['status', 'sold']] }),
      listing('expired', { tags: [['expiration', String(NOW - 1)]] }),
      listing('ok'),
    ];
    expect(ids(sellerListings(catalogue, SELLER, current, 12, NOW))).toEqual(['ok']);
  });

  it('caps the rail and returns nothing without a seller', () => {
    const current = listing('current');
    const catalogue = Array.from({ length: 20 }, (_, i) => listing(`l${i}`));
    expect(sellerListings(catalogue, SELLER, current, RECOMMENDATION_LIMIT, NOW)).toHaveLength(
      RECOMMENDATION_LIMIT,
    );
    expect(sellerListings(catalogue, null, current, 12, NOW)).toEqual([]);
  });
});

describe('recommendListings', () => {
  const current = listing('current', {
    tags: [
      ['t', 'Bitcoin'],
      ['t', 'hardware'],
    ],
  });

  it('ranks shared tags, then collection, then liked, then followed seller, then recency', () => {
    const collection = `30405:${OTHER}:shop`;
    const currentInCollection = listing('current', {
      tags: [
        ['t', 'bitcoin'],
        ['t', 'hardware'],
        ['a', collection],
      ],
    });
    const twoTags = listing('two-tags', {
      pubkey: OTHER,
      createdAt: 1,
      tags: [
        ['t', 'BITCOIN'],
        ['t', 'Hardware'],
      ],
    });
    const oneTag = listing('one-tag', { pubkey: OTHER, createdAt: 2, tags: [['t', 'bitcoin']] });
    const sameCollection = listing('collection', {
      pubkey: OTHER,
      createdAt: 3,
      tags: [['a', collection]],
    });
    const liked = listing('liked', { pubkey: OTHER, createdAt: 4 });
    const followed = listing('followed', { pubkey: FRIEND, createdAt: 5 });
    const recentNewer = listing('recent-newer', { pubkey: OTHER, createdAt: 100 });
    const recentOlder = listing('recent-older', { pubkey: OTHER, createdAt: 6 });
    const result = recommendListings(
      [recentOlder, followed, liked, sameCollection, oneTag, twoTags, recentNewer],
      currentInCollection,
      [],
      {
        followed: new Set([FRIEND]),
        liked: new Set([listingAddress(liked)!]),
      },
      12,
      NOW,
    );
    expect(ids(result)).toEqual([
      'two-tags',
      'one-tag',
      'collection',
      'liked',
      'followed',
      'recent-newer',
      'recent-older',
    ]);
  });

  it('works without the liked signal (likes helper not wired yet)', () => {
    const a = listing('a', { pubkey: OTHER, createdAt: 1, tags: [['t', 'bitcoin']] });
    const b = listing('b', { pubkey: OTHER, createdAt: 2 });
    expect(ids(recommendListings([b, a], current, [], noSignals, 12, NOW))).toEqual(['a', 'b']);
  });

  it('excludes the current listing, items already in the seller rail and own listings', () => {
    const shownInSellerRail = listing('seller-shown', { createdAt: 10 });
    const sellerNotShown = listing('seller-not-shown', { createdAt: 5 });
    const own = listing('own', { pubkey: VIEWER, createdAt: 20 });
    const other = listing('other', { pubkey: OTHER, createdAt: 15 });
    const revisionOfCurrent = listing('current', { createdAt: 99 });
    const result = recommendListings(
      [current, revisionOfCurrent, shownInSellerRail, sellerNotShown, own, other],
      current,
      [shownInSellerRail],
      { followed: new Set(), viewer: VIEWER },
      12,
      NOW,
    );
    expect(ids(result)).toEqual(['other', 'seller-not-shown']);
  });

  it('never duplicates a card already shown in the seller rail', () => {
    const catalogue = Array.from({ length: 6 }, (_, i) =>
      listing(`s${i}`, { createdAt: i, tags: [['t', 'bitcoin']] }),
    );
    const rail = sellerListings(catalogue, SELLER, current, 3, NOW);
    const recos = recommendListings(catalogue, current, rail, noSignals, 12, NOW);
    const railIds = new Set(rail.map((p) => p.id));
    expect(recos.some((p) => railIds.has(p.id))).toBe(false);
    expect(recos).toHaveLength(3);
  });

  it('drops inactive listings and caps the result', () => {
    const catalogue = [
      listing('hidden', { pubkey: OTHER, tags: [['visibility', 'hidden']] }),
      ...Array.from({ length: 20 }, (_, i) => listing(`o${i}`, { pubkey: OTHER })),
    ];
    const result = recommendListings(catalogue, current, [], noSignals, RECOMMENDATION_LIMIT, NOW);
    expect(result).toHaveLength(RECOMMENDATION_LIMIT);
    expect(ids(result)).not.toContain('hidden');
  });
});

describe('shouldShowRecommendations', () => {
  it('hides the section with fewer than two candidates', () => {
    expect(shouldShowRecommendations([])).toBe(false);
    expect(shouldShowRecommendations([listing('one')])).toBe(false);
    expect(shouldShowRecommendations([listing('one'), listing('two')])).toBe(true);
  });
});

describe('productPageAction', () => {
  it('pushes until the chain of product pages reaches the cap, then replaces', () => {
    const chain = (n: number) => [
      'ExploreHome',
      'Market',
      ...Array<string>(n).fill('MarketProductDetail'),
    ];
    expect(productPageAction(chain(1), 'MarketProductDetail')).toBe('push');
    expect(productPageAction(chain(MAX_PRODUCT_PAGE_CHAIN - 1), 'MarketProductDetail')).toBe(
      'push',
    );
    expect(productPageAction(chain(MAX_PRODUCT_PAGE_CHAIN), 'MarketProductDetail')).toBe('replace');
  });

  it('only counts consecutive product pages at the top of the stack', () => {
    const routes = [
      ...Array<string>(MAX_PRODUCT_PAGE_CHAIN).fill('ProductDetail'),
      'ContactProfile',
      'ProductDetail',
    ];
    expect(productPageAction(routes, 'ProductDetail')).toBe('push');
  });
});

describe('recommendationCardId', () => {
  it('uses the first 8 chars of the listing event id', () => {
    expect(recommendationCardId(listing('x', { id: 'abcdef0123456789' }))).toBe('abcdef01');
  });
});
