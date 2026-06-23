import AsyncStorage from "@react-native-async-storage/async-storage";

import { getMovieSummary, getSeriesSummary, type MediaItem } from "../api/tmdb";
import i18n from "../localization/i18n";
import { normalizeAppLanguage, type AppLanguage } from "../localization/types";
import { mapWithConcurrency } from "../utils/concurrency";

export type HydratedMediaCache = Map<string, MediaItem>;

const sharedHydratedMediaCache: HydratedMediaCache = new Map();
const PERSISTENT_HYDRATION_PREFIX = "@streambox/media-hydration-v1:";
const HYDRATION_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const HYDRATION_FLUSH_DEBOUNCE_MS = 250;
const HYDRATION_MAX_PERSISTED_ENTRIES = 1000;
const HYDRATION_STORAGE_SCHEMA_VERSION = 1;
const HYDRATION_FETCH_CONCURRENCY = 10;

type PersistedHydratedMediaEntry = {
  item: MediaItem;
  updatedAt: number;
};

type PersistedHydratedMediaPayload = {
  schemaVersion: number;
  updatedAt: number;
  entries: Record<string, PersistedHydratedMediaEntry>;
};

const hydratedEntryTimestamps = new Map<string, number>();
const hydrationLoadPromises = new Map<AppLanguage, Promise<void>>();
const loadedHydrationLanguages = new Set<AppLanguage>();
const hydrationFlushTimers = new Map<AppLanguage, ReturnType<typeof setTimeout>>();
const hydrationRequests = new Map<string, Promise<MediaItem | null>>();

function getActiveLanguage() {
  return normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
}

function getPersistentHydrationKey(language: AppLanguage) {
  return `${PERSISTENT_HYDRATION_PREFIX}${language}`;
}

function getLocalizedCacheKey(language: AppLanguage, mediaType: "movie" | "tv", id: number | string) {
  return `${language}:${mediaType}-${id}`;
}

function isFresh(updatedAt: number) {
  return Date.now() - updatedAt <= HYDRATION_CACHE_TTL_MS;
}

function isMediaItem(value: unknown): value is MediaItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<MediaItem>;
  return (
    (typeof item.id === "number" || typeof item.id === "string")
    && typeof item.title === "string"
    && (typeof item.posterPath === "string" || item.posterPath === null)
    && (typeof item.backdropPath === "string" || item.backdropPath === null)
    && typeof item.rating === "number"
    && typeof item.overview === "string"
    && typeof item.year === "string"
    && (item.mediaType === "movie" || item.mediaType === "tv")
  );
}

function getCachedMediaItem(cache: HydratedMediaCache, key: string) {
  const item = cache.get(key);
  if (!item) {
    return null;
  }

  const updatedAt = hydratedEntryTimestamps.get(key);
  if (updatedAt && !isFresh(updatedAt)) {
    cache.delete(key);
    hydratedEntryTimestamps.delete(key);
    return null;
  }

  return item;
}

async function flushPersistedHydratedMediaCache(language: AppLanguage, cache: HydratedMediaCache) {
  const languagePrefix = `${language}:`;
  const now = Date.now();
  const entries = Array.from(cache.entries())
    .filter(([key, item]) => key.startsWith(languagePrefix) && isMediaItem(item))
    .map(([key, item]) => ({
      key,
      item,
      updatedAt: hydratedEntryTimestamps.get(key) ?? now,
    }))
    .filter((entry) => isFresh(entry.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, HYDRATION_MAX_PERSISTED_ENTRIES);

  const payload: PersistedHydratedMediaPayload = {
    schemaVersion: HYDRATION_STORAGE_SCHEMA_VERSION,
    updatedAt: now,
    entries: Object.fromEntries(
      entries.map((entry) => [
        entry.key,
        {
          item: entry.item,
          updatedAt: entry.updatedAt,
        },
      ])
    ),
  };

  try {
    await AsyncStorage.setItem(getPersistentHydrationKey(language), JSON.stringify(payload));
  } catch {
    // Best-effort cache persistence.
  }
}

function scheduleHydrationFlush(language: AppLanguage, cache: HydratedMediaCache) {
  const existingTimer = hydrationFlushTimers.get(language);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    hydrationFlushTimers.delete(language);
    void flushPersistedHydratedMediaCache(language, cache);
  }, HYDRATION_FLUSH_DEBOUNCE_MS);

  hydrationFlushTimers.set(language, timer);
}

async function ensurePersistedHydrationLoaded(language: AppLanguage, cache: HydratedMediaCache) {
  if (loadedHydrationLanguages.has(language)) {
    return;
  }

  const existingLoad = hydrationLoadPromises.get(language);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  const loadPromise = (async () => {
    let shouldFlush = false;

    try {
      const raw = await AsyncStorage.getItem(getPersistentHydrationKey(language));
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedHydratedMediaPayload> | null;
      if (
        !parsed
        || typeof parsed !== "object"
        || parsed.schemaVersion !== HYDRATION_STORAGE_SCHEMA_VERSION
        || !parsed.entries
        || typeof parsed.entries !== "object"
      ) {
        shouldFlush = true;
        return;
      }

      Object.entries(parsed.entries).forEach(([key, entry]) => {
        if (
          !key.startsWith(`${language}:`)
          || !entry
          || typeof entry !== "object"
          || typeof entry.updatedAt !== "number"
          || !isMediaItem(entry.item)
        ) {
          shouldFlush = true;
          return;
        }

        if (!isFresh(entry.updatedAt)) {
          shouldFlush = true;
          return;
        }

        cache.set(key, entry.item);
        hydratedEntryTimestamps.set(key, entry.updatedAt);
      });
    } catch {
      shouldFlush = true;
    } finally {
      loadedHydrationLanguages.add(language);
      hydrationLoadPromises.delete(language);

      if (shouldFlush) {
        scheduleHydrationFlush(language, cache);
      }
    }
  })();

  hydrationLoadPromises.set(language, loadPromise);
  await loadPromise;
}

function cacheFreshMediaItem(
  cache: HydratedMediaCache,
  key: string,
  item: MediaItem,
  language: AppLanguage
) {
  cache.set(key, item);
  hydratedEntryTimestamps.set(key, Date.now());
  scheduleHydrationFlush(language, cache);
}

async function fetchHydratedMediaItem(
  mediaType: "movie" | "tv",
  id: number | string,
  key: string,
  language: AppLanguage,
  cache: HydratedMediaCache
) {
  const existingRequest = hydrationRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const numericId = Number(id);
      if (!Number.isFinite(numericId)) {
        return null;
      }

      const item = mediaType === "movie"
        ? await getMovieSummary(numericId)
        : await getSeriesSummary(numericId);

      if (item) {
        cacheFreshMediaItem(cache, key, item, language);
      }

      return item ?? null;
    } catch {
      return null;
    } finally {
      hydrationRequests.delete(key);
    }
  })();

  hydrationRequests.set(key, request);
  return request;
}

export function getSharedHydratedMediaCache() {
  return sharedHydratedMediaCache;
}

export async function hydrateMediaIds(
  movieIds: (number | string)[],
  seriesIds: (number | string)[],
  cache: HydratedMediaCache = sharedHydratedMediaCache
): Promise<MediaItem[]> {
  const language = getActiveLanguage();
  await ensurePersistedHydrationLoaded(language, cache);

  const movieItems = await mapWithConcurrency(
    movieIds,
    HYDRATION_FETCH_CONCURRENCY,
    async (id) => {
      const key = getLocalizedCacheKey(language, "movie", id);
      const cached = getCachedMediaItem(cache, key);
      if (cached) {
        return cached;
      }

      return fetchHydratedMediaItem("movie", id, key, language, cache);
    }
  );

  const seriesItems = await mapWithConcurrency(
    seriesIds,
    HYDRATION_FETCH_CONCURRENCY,
    async (id) => {
      const key = getLocalizedCacheKey(language, "tv", id);
      const cached = getCachedMediaItem(cache, key);
      if (cached) {
        return cached;
      }

      return fetchHydratedMediaItem("tv", id, key, language, cache);
    }
  );

  return [...movieItems, ...seriesItems].filter((item): item is MediaItem => item !== null);
}

export async function clearPersistedMediaHydrationCache(): Promise<void> {
  sharedHydratedMediaCache.clear();
  hydratedEntryTimestamps.clear();
  loadedHydrationLanguages.clear();
  hydrationLoadPromises.clear();
  hydrationRequests.clear();

  hydrationFlushTimers.forEach((timer) => clearTimeout(timer));
  hydrationFlushTimers.clear();

  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((key) => key.startsWith(PERSISTENT_HYDRATION_PREFIX));
    if (targets.length > 0) {
      await AsyncStorage.multiRemove(targets);
    }
  } catch {
    // Best-effort purge.
  }
}
