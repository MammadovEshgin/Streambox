/**
 * In-flight request dedup. When multiple callers ask for the same `key` while a
 * request is still pending, they all share the single in-flight promise instead
 * of triggering duplicate work (e.g. a list row and a detail prefetch racing for
 * the same movie). The registry entry is removed once the promise settles, so
 * failures are never cached — the next call retries cleanly.
 */
export function dedupeInFlight<T>(
  registry: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = registry.get(key);
  if (existing) return existing;

  const task = factory().finally(() => {
    registry.delete(key);
  });
  registry.set(key, task);
  return task;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
