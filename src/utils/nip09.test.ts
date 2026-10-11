import type { Event as NostrEvent } from 'nostr-tools';
import {
  DELETION_KIND,
  DELETION_QUERY_CHUNK,
  addressOf,
  deletedByAuthor,
  deletionFilters,
} from './nip09';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const D = `a:30402:${'c'.repeat(64)}:product`;

const ev = (id: string, over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id,
    pubkey: ME,
    kind: 1111,
    tags: [],
    content: '',
    created_at: 100,
    sig: '',
    ...over,
  }) as NostrEvent;

const review = (id: string, created_at: number, pubkey = ME) =>
  ev(id, { kind: 31555, pubkey, created_at, tags: [['d', D]] });

const del = (tags: string[][], pubkey = ME, created_at = 200) =>
  ev(`del-${tags.map((t) => t[1]).join()}`, { kind: DELETION_KIND, pubkey, created_at, tags });

describe('addressOf', () => {
  it('builds the coordinate for addressable kinds only', () => {
    expect(addressOf(review('r1', 1))).toBe(`31555:${ME}:${D}`);
    expect(addressOf(ev('c1'))).toBeNull();
  });
});

describe('deletionFilters', () => {
  it('chunks and de-duplicates values into bounded kind-5 filters', () => {
    const ids = Array.from({ length: DELETION_QUERY_CHUNK + 5 }, (_, i) => `id${i}`);
    const filters = deletionFilters('e', [...ids, 'id0']);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual({
      kinds: [DELETION_KIND],
      '#e': ids.slice(0, DELETION_QUERY_CHUNK),
      limit: DELETION_QUERY_CHUNK * 2,
    });
    expect(filters[1]['#e']).toEqual(ids.slice(DELETION_QUERY_CHUNK));
    expect(filters[1].limit).toBe(10);
  });

  it('supports #a and returns nothing for no values', () => {
    expect(deletionFilters('a', ['x'])).toEqual([
      { kinds: [DELETION_KIND], '#a': ['x'], limit: 2 },
    ]);
    expect(deletionFilters('e', [])).toEqual([]);
  });
});

describe('deletedByAuthor', () => {
  it("honours an e deletion only from the event's author", () => {
    const mine = ev('c1');
    const theirs = ev('c2', { pubkey: OTHER });
    const out = deletedByAuthor(
      [mine, theirs],
      [
        del([
          ['e', 'c1'],
          ['e', 'c2'],
        ]),
        del([['e', 'c1']], OTHER),
      ],
    );
    expect(Array.from(out)).toEqual(['c1']);
  });

  it('deletes every version of an address up to the deletion time', () => {
    const old = review('r1', 100);
    const current = review('r2', 150);
    const later = review('r3', 300); // re-reviewed after deleting
    const out = deletedByAuthor([old, current, later], [del([['a', `31555:${ME}:${D}`]])]);
    expect(Array.from(out).sort()).toEqual(['r1', 'r2']);
  });

  it("ignores an a deletion from someone other than the address's author", () => {
    const out = deletedByAuthor([review('r1', 100)], [del([['a', `31555:${ME}:${D}`]], OTHER)]);
    expect(out.size).toBe(0);
  });

  it('ignores events that are not kind 5', () => {
    const fake = { ...del([['e', 'c1']]), kind: 1 } as NostrEvent;
    expect(deletedByAuthor([ev('c1')], [fake]).size).toBe(0);
  });
});
