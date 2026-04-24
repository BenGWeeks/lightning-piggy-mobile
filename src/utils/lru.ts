/**
 * Tiny Map-backed LRU cache. ~25 lines, zero dependencies, RN-safe
 * (no `node:*` imports — the real `lru-cache` package pulls in
 * `node:diagnostics_channel` since v11 which Metro can't resolve).
 *
 * Keeps the API minimal: get, set, delete, clear, size. Uses Map's
 * insertion-order iteration for O(1) eviction of the oldest entry
 * when `max` is hit (re-inserting on access to mark "recently used").
 *
 * Call `set(k, v)` on the read path to "touch" an existing entry —
 * the standard `get` pattern does this when `touchOnGet` is true.
 */
export interface LRUCacheOptions {
  max: number;
  /** Re-insert the entry on `get` to mark it most-recently-used. Default: true. */
  touchOnGet?: boolean;
}

export class LRUCache<K, V> {
  private readonly max: number;
  private readonly touchOnGet: boolean;
  private readonly map = new Map<K, V>();

  constructor(opts: LRUCacheOptions) {
    // Reject malformed sizes up-front — `max=0` would evict on every
    // set (making the cache useless); negatives would wrap via `>=`
    // comparison and never evict. Fail loud so misconfigurations
    // show up at construction, not silently degrade at runtime.
    if (!Number.isInteger(opts.max) || opts.max < 1) {
      throw new Error(`LRUCache: max must be a positive integer, got ${opts.max}`);
    }
    this.max = opts.max;
    this.touchOnGet = opts.touchOnGet ?? true;
  }

  /**
   * Return the value for `key`, or `undefined` if absent. Use `has()`
   * to disambiguate if a caller genuinely stores `undefined` values
   * (this cache's current consumer — the NIP-04 plaintext pipeline —
   * never stores `undefined`, since `null`-plaintext from a failed
   * decrypt is filtered out before `set()`).
   */
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    if (this.touchOnGet) {
      // Re-insert to move to the end (most-recently-used position).
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // Evict least-recently-used (first inserted).
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
