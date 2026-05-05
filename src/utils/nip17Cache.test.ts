/**
 * Eviction-policy tests for the NIP-17 plaintext-wrap cache (#193).
 *
 * The persisted cache is a plain `Record<string, V>` and we rely on JS
 * object insertion order being stable. Eviction in `evictNip17CacheOverflow`
 * drops the oldest-by-insertion entries — which becomes LRU semantics
 * when callers `touchNip17CacheEntry(cache, key)` on every cache hit
 * (delete + reinsert moves the entry to the tail).
 *
 * These tests pin the eviction order so a future regression — e.g.
 * someone replacing the plain object with a `Map` that doesn't survive
 * `JSON.stringify` round-trip, or skipping the touch on the read path —
 * surfaces here rather than as a silent re-decrypt regression in
 * production.
 */

import { evictNip17CacheOverflow, touchNip17CacheEntry } from './nip17Cache';

describe('touchNip17CacheEntry', () => {
  it('returns false and leaves cache untouched when key is absent', () => {
    const cache: Record<string, number> = { a: 1, b: 2 };
    const result = touchNip17CacheEntry(cache, 'missing');
    expect(result).toBe(false);
    expect(Object.keys(cache)).toEqual(['a', 'b']);
  });

  it('moves the touched key to the tail of insertion order', () => {
    const cache: Record<string, number> = { a: 1, b: 2, c: 3 };
    expect(touchNip17CacheEntry(cache, 'a')).toBe(true);
    expect(Object.keys(cache)).toEqual(['b', 'c', 'a']);
  });

  it('preserves the value when re-inserting', () => {
    const cache: Record<string, { text: string }> = {
      a: { text: 'first' },
      b: { text: 'second' },
    };
    touchNip17CacheEntry(cache, 'a');
    expect(cache.a).toEqual({ text: 'first' });
  });

  it('does not match inherited prototype properties', () => {
    // Guard: a reconstituted-from-JSON cache could theoretically contain
    // a `__proto__` key; without `hasOwnProperty` we'd treat inherited
    // `toString` etc. as hits and corrupt the cache by reinserting them
    // as own-properties.
    const cache: Record<string, number> = {};
    expect(touchNip17CacheEntry(cache, 'toString')).toBe(false);
    expect(Object.keys(cache)).toEqual([]);
  });
});

describe('evictNip17CacheOverflow', () => {
  it('returns 0 and leaves cache untouched when under cap', () => {
    const cache: Record<string, number> = { a: 1, b: 2 };
    expect(evictNip17CacheOverflow(cache, 5)).toBe(0);
    expect(Object.keys(cache)).toEqual(['a', 'b']);
  });

  it('returns 0 when exactly at cap', () => {
    const cache: Record<string, number> = { a: 1, b: 2, c: 3 };
    expect(evictNip17CacheOverflow(cache, 3)).toBe(0);
    expect(Object.keys(cache)).toEqual(['a', 'b', 'c']);
  });

  it('drops the oldest-inserted entries when over cap', () => {
    const cache: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const evicted = evictNip17CacheOverflow(cache, 3);
    expect(evicted).toBe(2);
    expect(Object.keys(cache)).toEqual(['c', 'd', 'e']);
  });
});

describe('LRU eviction (touch + overflow combined)', () => {
  // The behaviour the production code depends on: a touched entry must
  // survive subsequent overflow eviction, even if it was inserted long
  // before any of the entries that triggered the overflow.

  it('keeps a touched entry after the next overflow sweep', () => {
    const cache: Record<string, number> = { a: 1, b: 2, c: 3 };
    // Touch `a` — now MRU.
    touchNip17CacheEntry(cache, 'a');
    // Insert two new entries to push us 2 over the cap of 3.
    cache.d = 4;
    cache.e = 5;
    const evicted = evictNip17CacheOverflow(cache, 3);
    expect(evicted).toBe(2);
    // FIFO would have evicted `a` and `b`. LRU keeps `a` because we touched it.
    expect(Object.keys(cache)).toEqual(['a', 'd', 'e']);
  });

  it('FIFO baseline: untouched cache evicts the first-inserted entry', () => {
    // Negative control: confirms the touch is the only thing flipping
    // FIFO → LRU. If this ever fails, JS object insertion order has
    // changed (it hasn't since ES2015) or the cache representation
    // changed under us.
    const cache: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
    evictNip17CacheOverflow(cache, 2);
    expect(Object.keys(cache)).toEqual(['c', 'd']);
  });

  it('survives JSON round-trip — LRU order is persistable', () => {
    // The on-disk format is JSON. Object insertion order survives
    // `JSON.parse` / `JSON.stringify` for non-integer string keys
    // (wrap ids are 64-char hex). This pins that contract — without
    // it the LRU order would silently reset to alphabetical or hash
    // order on every app restart.
    const cache: Record<string, number> = { a: 1, b: 2, c: 3 };
    touchNip17CacheEntry(cache, 'a');
    const roundTripped: Record<string, number> = JSON.parse(JSON.stringify(cache));
    expect(Object.keys(roundTripped)).toEqual(['b', 'c', 'a']);
    // And eviction on the round-tripped object behaves the same way.
    roundTripped.d = 4;
    evictNip17CacheOverflow(roundTripped, 3);
    expect(Object.keys(roundTripped)).toEqual(['c', 'a', 'd']);
  });

  it('repeated touches keep the same entry warm across many evictions', () => {
    // Simulates a user re-opening the same thread across many refresh
    // cycles. The hot entry should survive indefinitely as long as it
    // gets touched at least once between overflows.
    const cache: Record<string, number> = { hot: 1 };
    for (let i = 0; i < 20; i++) {
      touchNip17CacheEntry(cache, 'hot');
      cache[`cold-${i}`] = i;
      evictNip17CacheOverflow(cache, 5);
    }
    expect(Object.prototype.hasOwnProperty.call(cache, 'hot')).toBe(true);
    expect(Object.keys(cache).length).toBe(5);
    // FIFO would have dropped `hot` on the first overflow (it was the
    // oldest insert). LRU keeps it because every iteration touches it
    // *before* inserting the new cold entry, so cold-i is the only
    // entry younger than hot at eviction time.
  });
});
