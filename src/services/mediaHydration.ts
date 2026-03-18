import { getMovieSummary, getSeriesSummary, type MediaItem } from "../api/tmdb";
import { getAzClassicMovieSummary } from "../api/azClassics";

export type HydratedMediaCache = Map<string, MediaItem>;

const sharedHydratedMediaCache: HydratedMediaCache = new Map();

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
      const key = `movie-${id}`;
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }

      try {
        let item: MediaItem | null = null;
        if (typeof id === "string" && id.includes("-")) {
          // Likely a UUID for Azerbaijan Classics
          item = await getAzClassicMovieSummary(id);
        } else {
          item = await getMovieSummary(Number(id));
        }

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
      const key = `tv-${id}`;
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
