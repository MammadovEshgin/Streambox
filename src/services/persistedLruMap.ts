import AsyncStorage from "@react-native-async-storage/async-storage";

import { LruMap } from "../utils/LruMap";

/**
 * PersistedLruMap — an LruMap<string, V> whose entries survive app restarts.
 *
 * Motivation: the API layer keeps stable lookups (TMDB↔IMDb id maps, logo
 * paths, poster ratings) in plain in-memory LruMaps, so every cold start
 * replays the full request burst that built them — the single biggest source
 * of proxy rate-limit pressure. These values are immutable or slow-moving, so
 * persisting them collapses cold-start bursts to near zero from the second
 * launch on.
 *
 * Semantics:
 *  - Drop-in for LruMap: get/set/has/delete/clear/negative-caching unchanged.
 *  - Writes are whole-map snapshots, debounced, best-effort. A lost write just
 *    means a refetch later — never an error.
 *  - `hydrateAllPersistedApiCaches()` loads every registered map from disk.
 *    App boot awaits it alongside the existing runtime-cache hydration, so the
 *    first discovery burst already sees warm caches. Until hydration lands, a
 *    miss simply refetches (identical to the previous behavior).
 *  - The whole snapshot expires after `ttlMs` (values here are stable; a
 *    coarse whole-map TTL keeps the format trivial and corruption-proof).
 *  - Values must be JSON-serializable.
 */

type PersistedPayload = {
  savedAt: number;
  entries: [string, unknown][];
};

const WRITE_DEBOUNCE_MS = 1500;

const registry: PersistedLruMap<unknown>[] = [];

export class PersistedLruMap<V> extends LruMap<string, V> {
  private readonly storageKey: string;
  private readonly ttlMs: number;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrationPromise: Promise<void> | null = null;

  constructor(options: { storageKey: string; maxEntries: number; ttlMs: number }) {
    super(options.maxEntries);
    this.storageKey = options.storageKey;
    this.ttlMs = options.ttlMs;
    registry.push(this as PersistedLruMap<unknown>);
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    this.scheduleWrite();
    return this;
  }

  override delete(key: string): boolean {
    const deleted = super.delete(key);
    if (deleted) {
      this.scheduleWrite();
    }
    return deleted;
  }

  private scheduleWrite() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    try {
      const payload: PersistedPayload = {
        savedAt: Date.now(),
        entries: [...this.entries()] as [string, unknown][],
      };
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // Best-effort disk cache — a lost write only costs a refetch later.
    }
  }

  hydrate(): Promise<void> {
    if (this.hydrationPromise) {
      return this.hydrationPromise;
    }

    this.hydrationPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(this.storageKey);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as PersistedPayload | null;
        if (
          !parsed
          || typeof parsed !== "object"
          || typeof parsed.savedAt !== "number"
          || !Array.isArray(parsed.entries)
        ) {
          return;
        }

        if (Date.now() - parsed.savedAt > this.ttlMs) {
          void AsyncStorage.removeItem(this.storageKey).catch(() => undefined);
          return;
        }

        for (const entry of parsed.entries) {
          if (!Array.isArray(entry) || typeof entry[0] !== "string") {
            continue;
          }

          // Anything fetched before hydration finished is fresher than disk —
          // never clobber it. super.set skips the debounced re-write.
          if (!super.has(entry[0])) {
            super.set(entry[0], entry[1] as V);
          }
        }
      } catch {
        // Corrupt or unreadable snapshot — behave like an empty cache.
      }
    })();

    return this.hydrationPromise;
  }
}

/**
 * Hydrate every PersistedLruMap constructed so far. Idempotent; failures are
 * swallowed per-map. App.tsx awaits this inside the existing boot gate.
 */
export function hydrateAllPersistedApiCaches(): Promise<void> {
  return Promise.all(registry.map((map) => map.hydrate())).then(() => undefined);
}
