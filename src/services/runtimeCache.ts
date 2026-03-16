type CacheEntry<T> = {
  value: T;
  updatedAt: number;
};

const runtimeCache = new Map<string, CacheEntry<unknown>>();

export function readRuntimeCache<T>(key: string): CacheEntry<T> | null {
  const entry = runtimeCache.get(key);
  if (!entry) {
    return null;
  }

  return entry as CacheEntry<T>;
}

export function writeRuntimeCache<T>(key: string, value: T): CacheEntry<T> {
  const entry: CacheEntry<T> = {
    value,
    updatedAt: Date.now(),
  };

  runtimeCache.set(key, entry as CacheEntry<unknown>);
  return entry;
}

export function isRuntimeCacheFresh(entry: { updatedAt: number } | null | undefined, maxAgeMs: number) {
  if (!entry) {
    return false;
  }

  return Date.now() - entry.updatedAt <= maxAgeMs;
}


