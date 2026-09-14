/**
 * Pure ordering/filtering helpers for the profile shelves (watchlist, liked,
 * watched) and their See All grids.
 *
 * Extracted from the screens so the ordering rules are unit-testable without
 * React. "Recently added" showed the OLDEST bookmarks first for a long time,
 * and that is exactly the kind of bug a test pins down in three lines.
 */

import { GENRE_ID_MAP, type MediaItem } from "../api/tmdb";

export type ProfileShelfSort = "recent" | "rating" | "year" | "title";

export type ProfileShelfFilters = {
  sortBy: ProfileShelfSort;
  genre: string | null;
};

export type ProfileShelfRecord = {
  item: MediaItem;
  /**
   * Position in the list this record came from, already in display order:
   * newest first. Watchlist/liked ids are stored append-ordered on disk, so the
   * screens reverse them before building records.
   */
  order: number;
  watchedAt?: number;
  genres: string[];
};

export const DEFAULT_SHELF_FILTERS: ProfileShelfFilters = {
  sortBy: "recent",
  genre: null,
};

export const PROFILE_SHELF_SORT_OPTIONS: readonly ProfileShelfSort[] = [
  "recent",
  "rating",
  "year",
  "title",
];

export function deriveGenresFromMediaItem(item: MediaItem): string[] {
  return (item.genreIds ?? [])
    .map((genreId) => GENRE_ID_MAP[genreId])
    .filter((genreName): genreName is string => typeof genreName === "string" && genreName.length > 0);
}

export function buildHydratedShelfRecords(items: MediaItem[]): ProfileShelfRecord[] {
  return items.map((item, index) => ({
    item,
    order: index,
    genres: deriveGenresFromMediaItem(item),
  }));
}

export function getAvailableGenres(records: ProfileShelfRecord[]): string[] {
  return Array.from(new Set(records.flatMap((record) => record.genres))).sort((left, right) =>
    left.localeCompare(right)
  );
}

/** "----" is a real year value here (undated titles), and `Number("----")` is NaN. */
export function parseSortableYear(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyShelfFilters(
  records: ProfileShelfRecord[],
  filters: ProfileShelfFilters
): MediaItem[] {
  const next = filters.genre
    ? records.filter((record) => record.genres.includes(filters.genre ?? ""))
    : records.slice();

  switch (filters.sortBy) {
    case "rating":
      next.sort((left, right) => (right.item.rating ?? 0) - (left.item.rating ?? 0));
      break;
    case "year":
      // A comparator that returns NaN — which Number("----") produced — leaves
      // the list in whatever order the engine happened to hand it back.
      next.sort((left, right) => parseSortableYear(right.item.year) - parseSortableYear(left.item.year));
      break;
    case "title":
      next.sort((left, right) => left.item.title.localeCompare(right.item.title));
      break;
    case "recent":
    default:
      next.sort((left, right) => {
        // Watched entries carry a real timestamp, so use it.
        if (typeof left.watchedAt === "number" && typeof right.watchedAt === "number") {
          if (right.watchedAt !== left.watchedAt) {
            return right.watchedAt - left.watchedAt;
          }
          return left.order - right.order;
        }
        // Watchlist/liked have no timestamp; `order` is their position in the
        // newest-first id list. This used to compare `order` ascending against
        // the raw append-ordered list, i.e. "Recently added" reliably showed
        // the OLDEST bookmarks first.
        return left.order - right.order;
      });
      break;
  }

  return next.map((record) => record.item);
}

export function isShelfFilterActive(filters: ProfileShelfFilters): boolean {
  return (
    filters.sortBy !== DEFAULT_SHELF_FILTERS.sortBy || filters.genre !== DEFAULT_SHELF_FILTERS.genre
  );
}

/**
 * Stored media-id lists are append-ordered: a new bookmark lands at the end.
 * Reading them newest-first therefore means reading them backwards.
 */
export function toNewestFirstIds<T>(ids: readonly T[]): T[] {
  return [...ids].reverse();
}
