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

import { utf8ByteSize } from './byteSize';

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

/**
 * Evict the oldest-inserted entries until the cache's serialised JSON is
 * at most `maxBytes` (measured in real UTF-8 bytes — see `utf8ByteSize`,
 * since that's the unit SQLite's CursorWindow row limit applies to).
 * Mutates in place; returns the number removed.
 *
 * The count cap in `evictNip17CacheOverflow` isn't enough on its own —
 * Android's SQLite CursorWindow caps a row at ~2 MB, and past that the
 * *read* throws `SQLiteBlobTooBigException`. The wrap cache then fails
 * to hydrate, so every cold start falls back to a full relay restream +
 * NIP-17 re-decrypt instead of the fast cache path. Trims in ~10%
 * chunks to keep the re-checks bounded.
 *
 * `keys.length > 0` (not `> 1`): a single wrap whose own JSON exceeds
 * the budget must still be dropped — keeping it would persist an
 * unreadable row anyway. An empty cache is valid; the relay restream
 * repopulates it. `Math.max(1, …)` guarantees forward progress so a
 * small-but-over-budget cache can't spin forever.
 */
export function evictNip17CacheBytes<V>(cache: Record<string, V>, maxBytes: number): number {
  if (utf8ByteSize(JSON.stringify(cache)) <= maxBytes) return 0;
  let removed = 0;
  let keys = Object.keys(cache);
  while (keys.length > 0 && utf8ByteSize(JSON.stringify(cache)) > maxBytes) {
    const chunk = Math.max(1, Math.ceil(keys.length * 0.1));
    for (let i = 0; i < chunk; i += 1) delete cache[keys[i]];
    removed += chunk;
    keys = Object.keys(cache);
  }
  return removed;
}
