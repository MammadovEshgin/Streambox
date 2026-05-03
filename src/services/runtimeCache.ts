import AsyncStorage from "@react-native-async-storage/async-storage";

export type CacheEntry<T> = {
  value: T;
  updatedAt: number;
  version?: string | null;
};

const runtimeCache = new Map<string, CacheEntry<unknown>>();
const PERSISTENT_CACHE_PREFIX = "@streambox/runtime-cache-v1:";

function getPersistentCacheKey(key: string) {
  return `${PERSISTENT_CACHE_PREFIX}${key}`;
}

export function readRuntimeCache<T>(key: string): CacheEntry<T> | null {
  const entry = runtimeCache.get(key);
  if (!entry) {
    return null;
  }

  return entry as CacheEntry<T>;
}

type WriteRuntimeCacheOptions = {
  version?: string | null;
};

export function writeRuntimeCache<T>(key: string, value: T, options?: WriteRuntimeCacheOptions): CacheEntry<T> {
  const entry: CacheEntry<T> = {
    value,
    updatedAt: Date.now(),
    version: options?.version ?? null,
  };

  runtimeCache.set(key, entry as CacheEntry<unknown>);
  return entry;
}

export function isRuntimeCacheFresh(
  entry: { updatedAt: number; version?: string | null } | null | undefined,
  maxAgeMs: number,
  expectedVersion?: string | null
) {
  if (!entry) {
    return false;
  }

  if ((expectedVersion ?? null) !== (entry.version ?? null)) {
    return false;
  }

  return Date.now() - entry.updatedAt <= maxAgeMs;
}

type ReadPersistedRuntimeCacheOptions<T> = {
  validate?: (value: unknown) => value is T;
};

export async function readPersistedRuntimeCache<T>(
  key: string,
  options?: ReadPersistedRuntimeCacheOptions<T>
): Promise<CacheEntry<T> | null> {
  const inMemoryEntry = readRuntimeCache<T>(key);
  if (inMemoryEntry) {
    if (options?.validate && !options.validate(inMemoryEntry.value)) {
      runtimeCache.delete(key);
      void AsyncStorage.removeItem(getPersistentCacheKey(key)).catch(() => undefined);
      return null;
    }
    return inMemoryEntry;
  }

  try {
    const raw = await AsyncStorage.getItem(getPersistentCacheKey(key));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEntry<T> | null;
    if (
      !parsed
      || typeof parsed !== "object"
      || !("updatedAt" in parsed)
      || typeof parsed.updatedAt !== "number"
      || !("value" in parsed)
    ) {
      return null;
    }

    if (options?.validate && !options.validate(parsed.value)) {
      void AsyncStorage.removeItem(getPersistentCacheKey(key)).catch(() => undefined);
      return null;
    }

    runtimeCache.set(key, parsed as CacheEntry<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

export async function writePersistedRuntimeCache<T>(
  key: string,
  value: T,
  options?: WriteRuntimeCacheOptions
): Promise<CacheEntry<T>> {
  const entry = writeRuntimeCache(key, value, options);

  try {
    await AsyncStorage.setItem(getPersistentCacheKey(key), JSON.stringify(entry));
  } catch {
    // Best-effort disk cache.
  }

  return entry;
}

export function clearInMemoryRuntimeCache() {
  runtimeCache.clear();
}

export async function clearPersistedRuntimeCaches(): Promise<void> {
  clearInMemoryRuntimeCache();

  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((key) => key.startsWith(PERSISTENT_CACHE_PREFIX));
    if (targets.length > 0) {
      await AsyncStorage.multiRemove(targets);
    }
  } catch {
    // Best-effort purge; in-memory clear above is the critical path.
  }
}
