/**
 * LruMap — a Map with a bounded number of entries and least-recently-used eviction.
 *
 * Drop-in replacement for `new Map()` in long-lived in-memory caches. Without a
 * bound, caches like movie/series details grow for the entire process lifetime
 * (a user browsing thousands of titles accumulates megabytes that never release).
 *
 * Semantics preserved from Map:
 *  - `get`, `set`, `has`, `delete`, `clear`, `size`, iteration all behave as usual.
 *  - Storing `null`/`undefined` values is supported, so negative-caching patterns
 *    like `if (cache.has(key)) return cache.get(key) ?? null;` keep working.
 *
 * Added behavior:
 *  - When a NEW key is inserted beyond `maxSize`, the oldest entry is evicted.
 *  - `get` and `set` mark a key as most-recently-used, so hot entries survive.
 *
 * Recency is tracked using Map's insertion-order guarantee: touching a key
 * re-inserts it at the end, so `keys().next()` is always the LRU entry.
 */
export class LruMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;

  constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
    super(entries ?? undefined);
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(`LruMap requires a positive integer maxSize, received: ${maxSize}`);
    }
    this.maxSize = maxSize;
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    // Touch: move to most-recently-used position.
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    // Re-inserting moves the key to the most-recently-used position.
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);

    // Evict oldest entries until we're within the bound.
    while (super.size > this.maxSize) {
      const oldestKey = super.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      super.delete(oldestKey);
    }
    return this;
  }
}
