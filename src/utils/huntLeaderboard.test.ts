import {
  rankHiders,
  rankFinders,
  sortRecentCaches,
  sortRecentFinds,
  type HiderCacheInput,
  type FinderFindInput,
} from './huntLeaderboard';
import type { ParsedCache, ParsedFoundLog } from '../services/nostrPlacesService';

const hider = (
  hiderPubkey: string,
  d: string,
  isLpPiggy = false,
  createdAt = 1000,
): HiderCacheInput => ({
  coord: `37516:${hiderPubkey}:${d}`,
  hiderPubkey,
  isLpPiggy,
  createdAt,
});

const find = (finderPubkey: string, coord: string, createdAt = 1000): FinderFindInput => ({
  finderPubkey,
  coord,
  createdAt,
});

const fullCache = (over: Partial<ParsedCache> & { coord: string }): ParsedCache => ({
  hiderPubkey: 'h',
  d: 'd',
  name: 'Cache',
  description: '',
  geohash: null,
  difficulty: null,
  terrain: null,
  size: null,
  cacheType: null,
  hint: null,
  imageUrl: null,
  isLpPiggy: false,
  waitSeconds: null,
  uses: null,
  payoutSats: null,
  createdAt: 1000,
  expiresAt: null,
  ...over,
});

const fullFind = (over: Partial<ParsedFoundLog> & { id: string }): ParsedFoundLog => ({
  coord: '37516:h:d',
  finderPubkey: 'f',
  createdAt: 1000,
  amountSats: null,
  ...over,
});

describe('rankHiders', () => {
  it('ranks by distinct caches authored and tallies piglets', () => {
    const board = rankHiders([
      hider('alice', 'a', true),
      hider('alice', 'b', false),
      hider('bob', 'c', true),
    ]);
    expect(board[0]).toEqual({ pubkey: 'alice', total: 2, pigletCount: 1 });
    expect(board[1]).toEqual({ pubkey: 'bob', total: 1, pigletCount: 1 });
  });

  it('dedupes cache revisions by coord (latest wins for piglet flag)', () => {
    const board = rankHiders([
      hider('alice', 'a', false, 1000),
      hider('alice', 'a', true, 2000), // same coord, newer, becomes a piglet
    ]);
    expect(board).toEqual([{ pubkey: 'alice', total: 1, pigletCount: 1 }]);
  });

  it('honours the limit', () => {
    const caches = ['a', 'b', 'c', 'd'].map((p) => hider(p, 'x'));
    expect(rankHiders(caches, 2)).toHaveLength(2);
  });
});

describe('rankFinders', () => {
  it('ranks by distinct caches found, deduping repeat finds of one cache', () => {
    const board = rankFinders(
      [
        find('alice', 'c1'),
        find('alice', 'c1', 2000), // same finder+cache — counts once
        find('alice', 'c2'),
        find('bob', 'c1'),
      ],
      new Set(['c1']),
    );
    expect(board[0]).toEqual({ pubkey: 'alice', total: 2, pigletCount: 1 });
    expect(board[1]).toEqual({ pubkey: 'bob', total: 1, pigletCount: 1 });
  });

  it('counts pigletCount only for coords in the piglet set', () => {
    const board = rankFinders([find('alice', 'c1'), find('alice', 'c2')], new Set(['c2']));
    expect(board[0]).toEqual({ pubkey: 'alice', total: 2, pigletCount: 1 });
  });

  it('ignores finds with an empty coord', () => {
    const board = rankFinders([find('alice', '')], new Set());
    expect(board).toEqual([]);
  });
});

describe('sortRecentCaches', () => {
  it('sorts newest-first, dedupes to latest revision, drops expired', () => {
    const now = 10_000;
    const out = sortRecentCaches(
      [
        fullCache({ coord: 'a', createdAt: 100 }),
        fullCache({ coord: 'b', createdAt: 300 }),
        fullCache({ coord: 'a', createdAt: 400 }), // newer revision of a
        fullCache({ coord: 'c', createdAt: 500, expiresAt: 5000 }), // expired
      ],
      { nowSec: now },
    );
    expect(out.map((c) => c.coord)).toEqual(['a', 'b']);
    expect(out[0].createdAt).toBe(400);
  });

  it('keeps unexpired and null-expiry caches', () => {
    const out = sortRecentCaches(
      [
        fullCache({ coord: 'a', createdAt: 1, expiresAt: null }),
        fullCache({ coord: 'b', createdAt: 2, expiresAt: 999_999 }),
      ],
      { nowSec: 100 },
    );
    expect(out).toHaveLength(2);
  });
});

describe('sortRecentFinds', () => {
  it('dedupes by id and sorts newest-first', () => {
    const out = sortRecentFinds([
      fullFind({ id: '1', createdAt: 100 }),
      fullFind({ id: '2', createdAt: 300 }),
      fullFind({ id: '1', createdAt: 100 }), // duplicate id
    ]);
    expect(out.map((f) => f.id)).toEqual(['2', '1']);
  });

  it('filters to the given authors (lowercased)', () => {
    const out = sortRecentFinds(
      [fullFind({ id: '1', finderPubkey: 'ALICE' }), fullFind({ id: '2', finderPubkey: 'bob' })],
      { authors: new Set(['alice']) },
    );
    expect(out.map((f) => f.id)).toEqual(['1']);
  });

  it('honours the limit', () => {
    const finds = Array.from({ length: 5 }, (_, i) => fullFind({ id: String(i), createdAt: i }));
    expect(sortRecentFinds(finds, { limit: 2 })).toHaveLength(2);
  });
});
