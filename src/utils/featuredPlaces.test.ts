import { MAX_FEATURED_PLACES, orderFeaturedFirst } from './featuredPlaces';

type Row = { id: string; featured: boolean; distance: number };

const row = (id: string, featured: boolean, distance: number): Row => ({
  id,
  featured,
  distance,
});

const isFeatured = (r: Row) => r.featured;
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('orderFeaturedFirst', () => {
  it('returns an empty array for empty input', () => {
    expect(orderFeaturedFirst([], isFeatured)).toEqual([]);
  });

  it('pins featured items to the top even when non-featured are closer', () => {
    // Input is distance-sorted: a close non-featured place precedes a
    // farther featured one. After ordering, the featured place leads.
    const input = [
      row('near-plain', false, 100),
      row('far-featured', true, 5000),
      row('mid-plain', false, 1000),
    ];
    expect(ids(orderFeaturedFirst(input, isFeatured))).toEqual([
      'far-featured',
      'near-plain',
      'mid-plain',
    ]);
  });

  it('caps featured at 3 by default; the 4th+ featured fall back into the remainder', () => {
    const input = [
      row('f1', true, 10),
      row('f2', true, 20),
      row('f3', true, 30),
      row('f4', true, 40),
      row('p1', false, 5),
    ];
    const result = orderFeaturedFirst(input, isFeatured);
    // First 3 are the featured that fit the cap; then the remainder keeps
    // its input order — the over-cap featured f4 sat before p1 in the input
    // (which the caller already distance-sorted), so it stays before p1.
    expect(ids(result)).toEqual(['f1', 'f2', 'f3', 'f4', 'p1']);
  });

  it('exposes the cap as MAX_FEATURED_PLACES = 3', () => {
    expect(MAX_FEATURED_PLACES).toBe(3);
  });

  it('honours a custom maxFeatured', () => {
    const input = [row('f1', true, 10), row('f2', true, 20), row('p1', false, 5)];
    // maxFeatured=1: only f1 is pinned; f2 (over-cap) keeps its input
    // position ahead of p1, so the remainder reads [f2, p1].
    expect(ids(orderFeaturedFirst(input, isFeatured, 1))).toEqual(['f1', 'f2', 'p1']);
  });

  it('preserves the non-featured order (no re-sorting of the remainder)', () => {
    const input = [row('p1', false, 100), row('p2', false, 200), row('p3', false, 300)];
    expect(ids(orderFeaturedFirst(input, isFeatured))).toEqual(['p1', 'p2', 'p3']);
  });

  it('never duplicates or drops an item', () => {
    const input = [
      row('f1', true, 10),
      row('f2', true, 20),
      row('f3', true, 30),
      row('f4', true, 40),
      row('p1', false, 5),
      row('p2', false, 50),
    ];
    const result = orderFeaturedFirst(input, isFeatured);
    expect(result).toHaveLength(input.length);
    expect(new Set(ids(result)).size).toBe(input.length);
    for (const r of input) expect(result).toContain(r);
  });

  it('does not mutate the input array', () => {
    const input = [row('p1', false, 100), row('f1', true, 5000)];
    const snapshot = ids(input);
    orderFeaturedFirst(input, isFeatured);
    expect(ids(input)).toEqual(snapshot);
  });

  it('handles fewer featured than the cap', () => {
    const input = [row('f1', true, 10), row('p1', false, 5), row('p2', false, 50)];
    expect(ids(orderFeaturedFirst(input, isFeatured))).toEqual(['f1', 'p1', 'p2']);
  });

  it('floors a non-integer cap instead of rounding up (2.5 pins 2, not 3)', () => {
    const input = [
      row('f1', true, 10),
      row('f2', true, 20),
      row('f3', true, 30),
      row('p1', false, 5),
    ];
    // 2.5 must pin exactly 2 featured; the 3rd featured falls into the remainder.
    expect(ids(orderFeaturedFirst(input, isFeatured, 2.5))).toEqual(['f1', 'f2', 'f3', 'p1']);
  });

  it('treats a negative cap as zero (pins nothing)', () => {
    const input = [row('f1', true, 10), row('p1', false, 5)];
    expect(ids(orderFeaturedFirst(input, isFeatured, -1))).toEqual(['f1', 'p1']);
  });
});
