/**
 * NIP-17 plaintext-wrap cache helpers (#193).
 *
 * The cache itself is a plain `Record<string, V>` persisted to
 * AsyncStorage as JSON. We rely on JS object insertion order for
 * non-integer string keys (wrap ids are 64-char hex) being stable
 * across `JSON.parse` / `JSON.stringify` round-trips — this lets us
 * persist LRU order on disk without any new schema or wrapper type.
 *
 * Eviction in `writeNip17Cache` (NostrContext) drops the oldest-by-
 * insertion entries when overflow > 0. Combined with `touchNip17CacheEntry`
 * being called on every cache hit during `refreshDmInbox`, this gives
 * true LRU semantics: a recently-touched entry moves to the tail of
 * insertion order and survives the next overflow sweep, even if
 * thousands of newer wraps arrive afterwards.
 *
 * Without the touch, this is FIFO-by-first-write (the previous
 * behaviour) — see issue #193 for the regression mode it produces on
 * users with very active inboxes.
 */

/**
 * Mark `key` as most-recently-used in `cache` by deleting and
 * re-inserting it. No-op (returns false) if the key isn't present.
 *
 * The implementation guards with `Object.prototype.hasOwnProperty.call`
 * rather than `key in cache` so inherited properties (e.g. `toString`,
 * `__proto__` if the cache was reconstituted from an attacker-supplied
 * blob) don't accidentally count as hits.
 */
export function touchNip17CacheEntry<V>(cache: Record<string, V>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(cache, key)) return false;
  const value = cache[key];
  delete cache[key];
  cache[key] = value;
  return true;
}

/**
 * Evict the oldest-inserted entries from `cache` so its size is at most
 * `cap`. Mutates `cache` in place. Returns the number of entries
 * removed so callers can include it in perf instrumentation. A no-op
 * when `Object.keys(cache).length <= cap`.
 *
 * Extracted from the persistence path so the eviction policy can be
 * unit-tested without dragging AsyncStorage / NostrContext into the
 * test environment.
 */
export function evictNip17CacheOverflow<V>(cache: Record<string, V>, cap: number): number {
  const keys = Object.keys(cache);
  const overflow = keys.length - cap;
  if (overflow <= 0) return 0;
  for (let i = 0; i < overflow; i++) delete cache[keys[i]];
  return overflow;
}
