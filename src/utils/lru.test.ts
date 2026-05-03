/**
 * Coverage for the tiny Map-backed LRU. Touches every public method
 * (get/set/has/delete/clear/size) plus the eviction order contract
 * documented in the source: oldest key is dropped when `max` is hit,
 * and `get` re-inserts to mark most-recently-used.
 */

import { LRUCache } from './lru';

describe('LRUCache', () => {
  it('throws when max is not a positive integer', () => {
    expect(() => new LRUCache<string, number>({ max: 0 })).toThrow(/positive integer/i);
    expect(() => new LRUCache<string, number>({ max: -1 })).toThrow(/positive integer/i);
    // 1.5 isn't an integer either.
    expect(() => new LRUCache<string, number>({ max: 1.5 })).toThrow(/positive integer/i);
  });

  it('stores and retrieves values via set/get/has/size', () => {
    const cache = new LRUCache<string, number>({ max: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the oldest entry when max is exceeded', () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('promotes the touched key on get, deferring its eviction', () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so it becomes most-recently-used.
    expect(cache.get('a')).toBe(1);
    // Now 'b' is the least-recently-used and gets evicted by 'c'.
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('does not promote on get when touchOnGet is false', () => {
    const cache = new LRUCache<string, number>({ max: 2, touchOnGet: false });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    // Without the touch-on-get re-insert, 'a' is still the oldest.
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('overwrites an existing key without growing the size', () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set('a', 1);
    cache.set('a', 99);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(99);
  });

  it('delete returns true on a hit and false on a miss', () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.has('a')).toBe(false);
  });

  it('clear empties the cache', () => {
    const cache = new LRUCache<string, number>({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });
});
