import type { Event as NostrEvent } from 'nostr-tools';
import {
  REVIEW_KIND,
  aggregateReviews,
  buildReviewEvent,
  dedupeNewestPerAuthor,
  isProductReviewCoord,
  parseReviewEvent,
  parseReviews,
  productReviewCoord,
  ratingToStars,
  starsToRating,
} from './productReviews';

const MERCHANT = 'a'.repeat(64);
const D_TAG = 'robotechy-lightning-piggy';
const COORD = `a:30402:${MERCHANT}:${D_TAG}`;

// Minimal event factory — only the fields the parser reads.
const ev = (over: Partial<NostrEvent>): NostrEvent =>
  ({
    id: 'id',
    pubkey: 'p'.repeat(64),
    kind: REVIEW_KIND,
    tags: [],
    content: '',
    created_at: 1000,
    sig: '',
    ...over,
  }) as NostrEvent;

describe('productReviewCoord / isProductReviewCoord', () => {
  it('builds the coordinate with the a: prefix', () => {
    expect(productReviewCoord(MERCHANT, D_TAG)).toBe(`a:30402:${MERCHANT}:${D_TAG}`);
  });

  it('validates a well-formed coordinate and rejects malformed ones', () => {
    expect(isProductReviewCoord(COORD)).toBe(true);
    expect(isProductReviewCoord('just-an-identifier')).toBe(false);
    expect(isProductReviewCoord(`a:30017:${MERCHANT}:${D_TAG}`)).toBe(false); // wrong kind
    expect(isProductReviewCoord(`a:30402:notahexpubkey:${D_TAG}`)).toBe(false);
    expect(isProductReviewCoord(`a:30402:${MERCHANT}:`)).toBe(false); // empty dTag
  });

  it('allows a dTag that itself contains colons', () => {
    expect(isProductReviewCoord(`a:30402:${MERCHANT}:a:b:c`)).toBe(true);
  });
});

describe('star <-> rating conversion', () => {
  it('round-trips whole stars', () => {
    for (let s = 0; s <= 5; s++) {
      expect(ratingToStars(starsToRating(s))).toBeCloseTo(s, 6);
    }
  });

  it('maps 5 stars to 1 and 4 stars to 0.8', () => {
    expect(starsToRating(5)).toBe(1);
    expect(starsToRating(4)).toBeCloseTo(0.8, 6);
    expect(ratingToStars(0.8)).toBeCloseTo(4, 6);
  });

  it('clamps out-of-range and guards NaN', () => {
    expect(starsToRating(9)).toBe(1);
    expect(starsToRating(-2)).toBe(0);
    expect(starsToRating(NaN)).toBe(0);
    expect(ratingToStars(7)).toBe(5);
    expect(ratingToStars(NaN)).toBe(0);
  });
});

describe('buildReviewEvent', () => {
  it('trims content and writes the d + thumb rating tags', () => {
    const t = buildReviewEvent({ coord: COORD, stars: 4, content: '  Great!  ' });
    expect(t.kind).toBe(REVIEW_KIND);
    expect(t.content).toBe('Great!');
    expect(t.tags).toContainEqual(['d', COORD]);
    expect(t.tags).toContainEqual(['rating', '0.8', 'thumb']);
  });

  it('emits rating 1 for 5 stars', () => {
    const t = buildReviewEvent({ coord: COORD, stars: 5 });
    expect(t.tags).toContainEqual(['rating', '1', 'thumb']);
    expect(t.content).toBe('');
  });

  it('adds valid categories, skips thumb/zero/empty categories', () => {
    const t = buildReviewEvent({
      coord: COORD,
      stars: 4,
      categories: [
        { category: 'quality', stars: 5 },
        { category: 'delivery', stars: 0 },
        { category: 'thumb', stars: 3 },
      ],
    });
    const ratingTags = t.tags.filter((tag) => tag[0] === 'rating');
    expect(ratingTags).toHaveLength(2); // thumb + quality only
    expect(t.tags).toContainEqual(['rating', '1', 'quality']);
  });
});

describe('parseReviewEvent', () => {
  it('parses stars, rating, text, time and categories', () => {
    const r = parseReviewEvent(
      ev({
        content: 'nice',
        created_at: 42,
        tags: [
          ['d', COORD],
          ['rating', '1', 'thumb'],
          ['rating', '0.6', 'quality'],
        ],
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.stars).toBeCloseTo(5, 6);
    expect(r!.text).toBe('nice');
    expect(r!.createdAt).toBe(42);
    expect(r!.categories).toEqual([{ category: 'quality', stars: 3 }]);
  });

  it('drops non-numeric category ratings but keeps the review', () => {
    const r = parseReviewEvent(
      ev({
        tags: [
          ['d', COORD],
          ['rating', '0.8', 'thumb'],
          ['rating', 'bogus', 'quality'],
        ],
      }),
    );
    expect(r!.categories).toEqual([]);
  });

  it('clamps an over-range thumb to rating 1', () => {
    const r = parseReviewEvent(
      ev({
        tags: [
          ['d', COORD],
          ['rating', '7', 'thumb'],
        ],
      }),
    );
    expect(r!.rating).toBe(1);
  });

  it('returns null for wrong kind, missing/invalid d, missing/non-numeric thumb', () => {
    expect(
      parseReviewEvent(
        ev({
          kind: 1,
          tags: [
            ['d', COORD],
            ['rating', '1', 'thumb'],
          ],
        }),
      ),
    ).toBeNull();
    expect(parseReviewEvent(ev({ tags: [['rating', '1', 'thumb']] }))).toBeNull();
    expect(
      parseReviewEvent(
        ev({
          tags: [
            ['d', 'just-an-identifier'],
            ['rating', '1', 'thumb'],
          ],
        }),
      ),
    ).toBeNull();
    expect(parseReviewEvent(ev({ tags: [['d', COORD]] }))).toBeNull(); // no thumb
    expect(
      parseReviewEvent(
        ev({
          tags: [
            ['d', COORD],
            ['rating', 'x', 'thumb'],
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('dedupeNewestPerAuthor', () => {
  it('keeps the newest event per author (missing created_at treated as 0)', () => {
    const a1 = ev({ id: 'a1', pubkey: 'A', created_at: 10 });
    const a2 = ev({ id: 'a2', pubkey: 'A', created_at: 20 });
    const bNoDate = ev({ id: 'b0', pubkey: 'B', created_at: undefined as unknown as number });
    const b1 = ev({ id: 'b1', pubkey: 'B', created_at: 5 });
    const out = dedupeNewestPerAuthor([a1, a2, bNoDate, b1]);
    expect(out.map((e) => e.id).sort()).toEqual(['a2', 'b1']);
  });
});

describe('parseReviews + aggregateReviews', () => {
  const mk = (pubkey: string, id: string, stars: number, created_at: number) =>
    ev({
      id,
      pubkey,
      created_at,
      tags: [
        ['d', COORD],
        ['rating', String(stars / 5), 'thumb'],
      ],
    });

  it('dedupes newest-per-author, drops malformed, sorts newest-first', () => {
    const reviews = parseReviews([
      mk('A', 'a1', 3, 10),
      mk('A', 'a2', 5, 20), // newer A wins
      mk('B', 'b1', 4, 15),
      ev({ id: 'junk', pubkey: 'C', tags: [['d', COORD]] }), // no thumb -> dropped
    ]);
    expect(reviews.map((r) => r.id)).toEqual(['a2', 'b1']);
    expect(reviews[0].stars).toBeCloseTo(5, 6);
  });

  it("keeps an author's newest VALID review when a newer event is malformed", () => {
    // A publishes a valid 4-star review, then a NEWER but malformed one (no
    // thumb rating). De-duping before parsing would let the malformed newer
    // event win and then be dropped, hiding A's review entirely. Parsing first
    // keeps the valid one.
    const reviews = parseReviews([
      mk('A', 'a-valid', 4, 10),
      ev({ id: 'a-malformed', pubkey: 'A', created_at: 20, tags: [['d', COORD]] }),
    ]);
    expect(reviews.map((r) => r.id)).toEqual(['a-valid']);
    expect(reviews[0].stars).toBeCloseTo(4, 6);
  });

  it('treats differently-cased pubkeys as the same author (newest wins)', () => {
    const reviews = parseReviews([mk('abc', 'lower', 3, 10), mk('ABC', 'upper', 5, 20)]);
    expect(reviews.map((r) => r.id)).toEqual(['upper']);
  });

  it('aggregates the mean star value; empty -> {average:0,count:0}', () => {
    expect(aggregateReviews([])).toEqual({ average: 0, count: 0 });
    const reviews = parseReviews([mk('A', 'a', 5, 1), mk('B', 'b', 3, 2)]);
    const agg = aggregateReviews(reviews);
    expect(agg.count).toBe(2);
    expect(agg.average).toBeCloseTo(4, 6); // (5 + 3) / 2
  });
});
