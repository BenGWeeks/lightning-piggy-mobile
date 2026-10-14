import type { Event } from 'nostr-tools';
import { buildReactionDeletionEvent } from './reactions';
import {
  MAX_LIKED_ITEMS,
  aggregateListingLikes,
  chunkIds,
  deriveLikedListings,
  isLikeContent,
  listingCoordinate,
  parseListingCoordinate,
  retractedReactionIds,
} from './marketLikes';

const SELLER = 'a'.repeat(64);
const OTHER_SELLER = 'b'.repeat(64);
const ME = 'c'.repeat(64);
const ALICE = 'd'.repeat(64);
const BOB = 'e'.repeat(64);
const COORD = `30402:${SELLER}:widget`;
const OTHER_COORD = `30402:${OTHER_SELLER}:gadget`;

let seq = 0;
function reaction(
  pubkey: string,
  opts: { content?: string; coordinate?: string; createdAt?: number; k?: string; id?: string } = {},
): Event {
  const coordinate = opts.coordinate ?? COORD;
  return {
    id: opts.id ?? `r${++seq}`,
    pubkey,
    kind: 7,
    content: opts.content ?? '+',
    created_at: opts.createdAt ?? 1000 + seq,
    tags: [
      ['e', 'f'.repeat(64)],
      ['p', coordinate.split(':')[1]],
      ['a', coordinate],
      ['k', opts.k ?? '30402'],
    ],
    sig: 'x',
  };
}

function deletion(pubkey: string, ids: string[]): Event {
  return {
    id: `d${++seq}`,
    pubkey,
    kind: 5,
    content: '',
    created_at: 5000,
    tags: [...ids.map((id) => ['e', id]), ['k', '7']],
    sig: 'x',
  };
}

describe('isLikeContent', () => {
  it.each(['+', '', '❤️', '❤', '👍', '👍🏽', '🤙', ' + '])('counts %p as a like', (c) => {
    expect(isLikeContent(c)).toBe(true);
  });
  it.each(['-', '😂', '🔥', ':pig:', 'nice'])('does not count %p', (c) => {
    expect(isLikeContent(c)).toBe(false);
  });
});

describe('listingCoordinate / parseListingCoordinate', () => {
  it('builds the 30402 coordinate from the d tag', () => {
    expect(listingCoordinate({ kind: 30402, pubkey: SELLER, tags: [['d', 'widget']] })).toBe(COORD);
  });
  it('rejects other kinds and missing d tags', () => {
    expect(listingCoordinate({ kind: 30018, pubkey: SELLER, tags: [['d', 'x']] })).toBeNull();
    expect(listingCoordinate({ kind: 30402, pubkey: SELLER, tags: [] })).toBeNull();
  });
  it('parses a coordinate whose d contains colons', () => {
    expect(parseListingCoordinate(`30402:${SELLER}:a:b`)).toEqual({
      kind: 30402,
      pubkey: SELLER,
      identifier: 'a:b',
    });
  });
  it('rejects malformed or non-listing coordinates', () => {
    expect(parseListingCoordinate(`30023:${SELLER}:x`)).toBeNull();
    expect(parseListingCoordinate('30402:nothex:x')).toBeNull();
    expect(parseListingCoordinate(`30402:${SELLER}:`)).toBeNull();
  });
});

describe('unlike deletion', () => {
  it('is a NIP-09 kind 5 of the reaction id with k=7', () => {
    const del = buildReactionDeletionEvent('reaction-1');
    expect(del.kind).toBe(5);
    expect(del.tags).toEqual([
      ['e', 'reaction-1'],
      ['k', '7'],
    ]);
  });
});

describe('retractedReactionIds', () => {
  it("only honours a deletion by the reaction's own author", () => {
    const mine = reaction(ME);
    const alices = reaction(ALICE);
    const retracted = retractedReactionIds(
      [mine, alices],
      [deletion(ME, [mine.id]), deletion(ME, [alices.id])],
    );
    expect([...retracted]).toEqual([mine.id]);
  });
});

describe('aggregateListingLikes', () => {
  it('counts one like per pubkey', () => {
    const likes = aggregateListingLikes(
      [reaction(ALICE), reaction(ALICE, { content: '❤️' }), reaction(BOB)],
      [],
      COORD,
      null,
    );
    expect(likes.count).toBe(2);
    expect(likes.myReactionId).toBeNull();
  });

  it('removes retracted likes and ignores forged retractions', () => {
    const alice = reaction(ALICE);
    const bob = reaction(BOB);
    const likes = aggregateListingLikes(
      [alice, bob],
      [deletion(ALICE, [alice.id]), deletion(ALICE, [bob.id])],
      COORD,
      null,
    );
    expect(likes.count).toBe(1);
  });

  it('ignores non-like reactions and other listings', () => {
    const likes = aggregateListingLikes(
      [
        reaction(ALICE, { content: '😂' }),
        reaction(BOB, { content: '-' }),
        reaction(ME, { coordinate: OTHER_COORD }),
      ],
      [],
      COORD,
      ME,
    );
    expect(likes).toEqual({ count: 0, myReactionId: null, myReactionIds: [] });
  });

  it("reports the viewer's active likes, newest first", () => {
    const older = reaction(ME, { createdAt: 10 });
    const newer = reaction(ME, { createdAt: 20 });
    const gone = reaction(ME, { createdAt: 30 });
    const likes = aggregateListingLikes(
      [older, newer, gone, reaction(ALICE)],
      [deletion(ME, [gone.id])],
      COORD,
      ME,
    );
    expect(likes.count).toBe(2);
    expect(likes.myReactionId).toBe(newer.id);
    expect(likes.myReactionIds).toEqual([newer.id, older.id]);
  });
});

describe('deriveLikedListings', () => {
  it("lists the viewer's liked listings, newest like first, once each", () => {
    const refs = deriveLikedListings(
      [
        reaction(ME, { coordinate: COORD, createdAt: 10 }),
        reaction(ME, { coordinate: OTHER_COORD, createdAt: 30 }),
        reaction(ME, { coordinate: COORD, createdAt: 20 }),
      ],
      [],
      ME,
    );
    expect(refs).toEqual([
      {
        coordinate: OTHER_COORD,
        kind: 30402,
        pubkey: OTHER_SELLER,
        identifier: 'gadget',
        likedAt: 30,
      },
      { coordinate: COORD, kind: 30402, pubkey: SELLER, identifier: 'widget', likedAt: 20 },
    ]);
  });

  it('drops retracted likes, but a later re-like keeps the listing', () => {
    const first = reaction(ME, { coordinate: COORD, createdAt: 10 });
    const relike = reaction(ME, { coordinate: COORD, createdAt: 30 });
    const other = reaction(ME, { coordinate: OTHER_COORD, createdAt: 20 });
    const refs = deriveLikedListings(
      [first, relike, other],
      [deletion(ME, [first.id, other.id])],
      ME,
    );
    expect(refs.map((r) => r.coordinate)).toEqual([COORD]);
  });

  it("ignores other people's likes, non-likes, and reactions without k=30402", () => {
    const refs = deriveLikedListings(
      [
        reaction(ALICE),
        reaction(ME, { content: '🔥' }),
        reaction(ME, { k: '1' }),
        reaction(ME, { coordinate: `30023:${SELLER}:article` }),
      ],
      [],
      ME,
    );
    expect(refs).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_LIKED_ITEMS + 5 }, (_, i) =>
      reaction(ME, { coordinate: `30402:${SELLER}:item-${i}` }),
    );
    expect(deriveLikedListings(many, [], ME)).toHaveLength(MAX_LIKED_ITEMS);
  });
});

describe('chunkIds', () => {
  it('splits ids into bounded chunks', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});
