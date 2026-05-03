import { getMovieSummary, getSeriesSummary, type MediaItem } from "../api/tmdb";
import i18n from "../localization/i18n";
import { normalizeAppLanguage } from "../localization/types";

export type HydratedMediaCache = Map<string, MediaItem>;

const sharedHydratedMediaCache: HydratedMediaCache = new Map();

function getLocalizedCacheKey(mediaType: "movie" | "tv", id: number | string) {
  const language = normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  return `${language}:${mediaType}-${id}`;
}

export function getSharedHydratedMediaCache() {
  return sharedHydratedMediaCache;
}

export async function hydrateMediaIds(
  movieIds: (number | string)[],
  seriesIds: (number | string)[],
  cache: HydratedMediaCache = sharedHydratedMediaCache
): Promise<MediaItem[]> {
  const movieItems = await Promise.all(
    movieIds.map(async (id) => {
      const key = getLocalizedCacheKey("movie", id);
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }

      try {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) {
          return null;
        }
        const item = await getMovieSummary(numericId);

        if (item) {
          cache.set(key, item);
        }
        return item;
      } catch {
        return null;
      }
    })
  );

  const seriesItems = await Promise.all(
    seriesIds.map(async (id) => {
      const key = getLocalizedCacheKey("tv", id);
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }

      try {
        const item = await getSeriesSummary(Number(id));
        cache.set(key, item);
        return item;
      } catch {
        return null;
      }
    })
  );

  return [...movieItems, ...seriesItems].filter((item): item is MediaItem => item !== null);
}
