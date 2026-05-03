import AsyncStorage from "@react-native-async-storage/async-storage";

import { getMovieSummary, getSeriesSummary, getTmdbImageUrl } from "./tmdb";
import { prefetchRemoteImages } from "../services/remoteImageCache";
import { supabase } from "../services/supabase";

export const FRANCHISE_CATALOG_CACHE_KEY = "@streambox/franchise-catalog-v12";
export const FRANCHISE_ENTRIES_CACHE_PREFIX = "@streambox/franchise-entries-v12-";
export const FRANCHISE_PROGRESS_CACHE_PREFIX = "@streambox/franchise-progress-v10-";
const ENTRY_IMAGE_WARM_LIMIT = 12;
const ENTRY_POSTER_ENRICH_BATCH_SIZE = 6;

export type FranchiseCollection = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  cachedLogoUrl?: string | null;
  backdropUrl: string | null;
  accentColor: string | null;
  totalEntries: number;
  sortOrder: number;
};

export type FranchiseEntry = {
  id: string;
  franchiseId: string;
  tmdbId: number | null;
  mediaType: "movie" | "tv";
  title: string;
  year: number | null;
  watchOrder: number;
  phase: string | null;
  posterUrl: string | null;
  cachedPosterUrl?: string | null;
  tagline: string | null;
  note: string | null;
  runtimeMinutes: number | null;
  episodeCount: number | null;
  isReleased: boolean;
};

export type UserFranchiseProgress = {
  entryId: string;
  watchedAt: string;
};

let collectionsRequest: Promise<FranchiseCollection[]> | null = null;
const entriesRequests = new Map<string, Promise<FranchiseEntry[]>>();
const progressRequests = new Map<string, Promise<UserFranchiseProgress[]>>();

function normalizeCachedCollections(rawValue: string | null): FranchiseCollection[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((item) => ({
        id: String(item.id ?? ""),
        slug: String(item.slug ?? ""),
        title: String(item.title ?? ""),
        description: typeof item.description === "string" ? item.description : null,
        logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : null,
        cachedLogoUrl: null,
        backdropUrl: typeof item.backdropUrl === "string" ? item.backdropUrl : null,
        accentColor: typeof item.accentColor === "string" ? item.accentColor : null,
        totalEntries: typeof item.totalEntries === "number" ? item.totalEntries : 0,
        sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0,
      }))
      .filter((collection) => collection.id.length > 0);
  } catch {
    return [];
  }
}

function normalizeCachedEntries(rawValue: string | null): FranchiseEntry[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((item) => ({
        id: String(item.id ?? ""),
        franchiseId: String(item.franchiseId ?? ""),
        tmdbId: typeof item.tmdbId === "number" ? item.tmdbId : null,
        mediaType: (item.mediaType === "tv" ? "tv" : "movie") as "movie" | "tv",
        title: String(item.title ?? ""),
        year: typeof item.year === "number" ? item.year : null,
        watchOrder: typeof item.watchOrder === "number" ? item.watchOrder : 0,
        phase: typeof item.phase === "string" ? item.phase : null,
        posterUrl:
          typeof item.posterUrl === "string" && item.posterUrl.includes("image.tmdb.org")
            ? item.posterUrl
            : null,
        cachedPosterUrl: null,
        tagline: typeof item.tagline === "string" ? item.tagline : null,
        note: typeof item.note === "string" ? item.note : null,
        runtimeMinutes: typeof item.runtimeMinutes === "number" ? item.runtimeMinutes : null,
        episodeCount: typeof item.episodeCount === "number" ? item.episodeCount : null,
        isReleased: typeof item.isReleased === "boolean" ? item.isReleased : true,
      }))
      .filter((entry) => entry.id.length > 0);
  } catch {
    return [];
  }
}

function normalizeCachedProgress(rawValue: string | null): UserFranchiseProgress[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((item) => ({
        entryId: String(item.entryId ?? ""),
        watchedAt: String(item.watchedAt ?? ""),
      }))
      .filter((progress) => progress.entryId.length > 0);
  } catch {
    return [];
  }
}

function hydrateCollectionsWithCachedImages(collections: FranchiseCollection[]) {
  return collections.map((collection) => ({
    ...collection,
    cachedLogoUrl: null,
  }));
}

function hydrateEntriesWithCachedImages(entries: FranchiseEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    cachedPosterUrl: null,
  }));
}

function warmCollectionImages(_collections: FranchiseCollection[]) {}

function warmEntryImages(entries: FranchiseEntry[]) {
  void prefetchRemoteImages(
    entries
      .filter((entry) => entry.isReleased)
      .slice(0, ENTRY_IMAGE_WARM_LIMIT)
      .map((entry) => entry.posterUrl),
    ENTRY_IMAGE_WARM_LIMIT,
    3
  ).catch(() => undefined);
}

async function resolveEntryPosterUrl(entry: FranchiseEntry): Promise<string | null> {
  if (!entry.tmdbId) {
    return null;
  }

  try {
    const summary =
      entry.mediaType === "tv"
        ? await getSeriesSummary(entry.tmdbId)
        : await getMovieSummary(entry.tmdbId);

    return getTmdbImageUrl(summary.posterPath, "w342");
  } catch {
    return null;
  }
}

async function enrichEntriesWithTmdbPosters(entries: FranchiseEntry[]): Promise<FranchiseEntry[]> {
  const resolvedEntries: FranchiseEntry[] = [];

  for (let index = 0; index < entries.length; index += ENTRY_POSTER_ENRICH_BATCH_SIZE) {
    const batch = entries.slice(index, index + ENTRY_POSTER_ENRICH_BATCH_SIZE);
    const resolvedBatch = await Promise.all(
      batch.map(async (entry) => {
        const posterUrl = await resolveEntryPosterUrl(entry);
        return {
          ...entry,
          posterUrl,
        };
      })
    );

    resolvedEntries.push(...resolvedBatch);
  }

  return resolvedEntries;
}

async function fetchFranchisesFromSupabase(): Promise<FranchiseCollection[]> {
  const { data, error } = await supabase
    .from("franchise_collections")
    .select("id, slug, title, description, backdrop_url, accent_color, total_entries, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch franchises: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    logoUrl: null,
    cachedLogoUrl: null,
    backdropUrl: row.backdrop_url,
    accentColor: row.accent_color,
    totalEntries: row.total_entries,
    sortOrder: row.sort_order,
  }));
}

function fetchFreshFranchises() {
  if (!collectionsRequest) {
    collectionsRequest = fetchFranchisesFromSupabase().finally(() => {
      collectionsRequest = null;
    });
  }

  return collectionsRequest;
}

async function fetchFranchiseEntriesFromSupabase(franchiseId: string): Promise<FranchiseEntry[]> {
  const { data, error } = await supabase
    .from("franchise_entries")
    .select("id, franchise_id, tmdb_id, media_type, title, year, watch_order, phase, tagline, note, runtime_minutes, episode_count, is_released")
    .eq("franchise_id", franchiseId)
    .order("watch_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch franchise entries: ${error.message}`);
  }

  const rows = (data || []).map((row) => ({
    id: row.id,
    franchiseId: row.franchise_id,
    tmdbId: row.tmdb_id,
    mediaType: row.media_type as "movie" | "tv",
    title: row.title,
    year: row.year,
    watchOrder: row.watch_order,
    phase: row.phase,
    posterUrl: null,
    cachedPosterUrl: null,
    tagline: row.tagline,
    note: row.note,
    runtimeMinutes: row.runtime_minutes,
    episodeCount: row.episode_count,
    isReleased: row.is_released,
  }));

  return enrichEntriesWithTmdbPosters(rows);
}

function fetchFreshFranchiseEntries(franchiseId: string) {
  const existing = entriesRequests.get(franchiseId);
  if (existing) {
    return existing;
  }

  const request = fetchFranchiseEntriesFromSupabase(franchiseId).finally(() => {
    entriesRequests.delete(franchiseId);
  });

  entriesRequests.set(franchiseId, request);
  return request;
}

async function fetchUserProgressFromSupabase(
  userId: string,
  franchiseId: string
): Promise<UserFranchiseProgress[]> {
  const { data, error } = await supabase
    .from("user_franchise_progress")
    .select("entry_id, watched_at, franchise_entries!inner(franchise_id)")
    .eq("user_id", userId)
    .eq("franchise_entries.franchise_id", franchiseId);

  if (error) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("user_franchise_progress")
      .select("entry_id, watched_at")
      .eq("user_id", userId);

    if (fallbackError) {
      return [];
    }

    return (fallbackData || []).map((row) => ({
      entryId: row.entry_id,
      watchedAt: row.watched_at,
    }));
  }

  return (data || []).map((row) => ({
    entryId: row.entry_id,
    watchedAt: row.watched_at,
  }));
}

function fetchFreshUserProgress(userId: string, franchiseId: string) {
  const key = `${userId}:${franchiseId}`;
  const existing = progressRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = fetchUserProgressFromSupabase(userId, franchiseId).finally(() => {
    progressRequests.delete(key);
  });

  progressRequests.set(key, request);
  return request;
}

export async function getFranchiseCollections(): Promise<FranchiseCollection[]> {
  try {
    const cached = normalizeCachedCollections(await AsyncStorage.getItem(FRANCHISE_CATALOG_CACHE_KEY));
    if (cached.length > 0) {
      void fetchFreshFranchises()
        .then(async (fresh) => {
          await AsyncStorage.setItem(FRANCHISE_CATALOG_CACHE_KEY, JSON.stringify(fresh));
          warmCollectionImages(fresh);
        })
        .catch(() => undefined);

      warmCollectionImages(cached);
      return hydrateCollectionsWithCachedImages(cached);
    }
  } catch {
    // Cache miss.
  }

  const fresh = await fetchFreshFranchises();
  AsyncStorage.setItem(FRANCHISE_CATALOG_CACHE_KEY, JSON.stringify(fresh)).catch(() => undefined);
  warmCollectionImages(fresh);
  return hydrateCollectionsWithCachedImages(fresh);
}

export async function refreshFranchiseCollections(): Promise<FranchiseCollection[]> {
  const fresh = await fetchFreshFranchises();
  await AsyncStorage.setItem(FRANCHISE_CATALOG_CACHE_KEY, JSON.stringify(fresh));
  warmCollectionImages(fresh);
  return hydrateCollectionsWithCachedImages(fresh);
}

export async function getFranchiseEntries(franchiseId: string): Promise<FranchiseEntry[]> {
  const cacheKey = `${FRANCHISE_ENTRIES_CACHE_PREFIX}${franchiseId}`;

  try {
    const cached = normalizeCachedEntries(await AsyncStorage.getItem(cacheKey));
    if (cached.length > 0) {
      void fetchFreshFranchiseEntries(franchiseId)
        .then(async (fresh) => {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
          warmEntryImages(fresh);
        })
        .catch(() => undefined);

      warmEntryImages(cached);
      return hydrateEntriesWithCachedImages(cached);
    }
  } catch {
    // Cache miss.
  }

  const fresh = await fetchFreshFranchiseEntries(franchiseId);
  AsyncStorage.setItem(cacheKey, JSON.stringify(fresh)).catch(() => undefined);
  warmEntryImages(fresh);
  return hydrateEntriesWithCachedImages(fresh);
}

export async function refreshFranchiseEntries(franchiseId: string): Promise<FranchiseEntry[]> {
  const cacheKey = `${FRANCHISE_ENTRIES_CACHE_PREFIX}${franchiseId}`;
  const fresh = await fetchFreshFranchiseEntries(franchiseId);
  await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
  warmEntryImages(fresh);
  return hydrateEntriesWithCachedImages(fresh);
}

export async function getUserFranchiseProgress(
  userId: string,
  franchiseId: string
): Promise<UserFranchiseProgress[]> {
  const cacheKey = `${FRANCHISE_PROGRESS_CACHE_PREFIX}${franchiseId}`;

  try {
    const cached = normalizeCachedProgress(await AsyncStorage.getItem(cacheKey));
    if (cached.length > 0) {
      void fetchFreshUserProgress(userId, franchiseId)
        .then(async (fresh) => {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
        })
        .catch(() => undefined);

      return cached;
    }
  } catch {
    // Cache miss.
  }

  const fresh = await fetchFreshUserProgress(userId, franchiseId);
  AsyncStorage.setItem(cacheKey, JSON.stringify(fresh)).catch(() => undefined);
  return fresh;
}

export async function refreshUserFranchiseProgress(
  userId: string,
  franchiseId: string
): Promise<UserFranchiseProgress[]> {
  const cacheKey = `${FRANCHISE_PROGRESS_CACHE_PREFIX}${franchiseId}`;
  const fresh = await fetchFreshUserProgress(userId, franchiseId);
  await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
  return fresh;
}

export async function toggleFranchiseEntryWatched(
  userId: string,
  entryId: string,
  franchiseId: string,
  isWatched: boolean
): Promise<void> {
  if (isWatched) {
    const { error } = await supabase
      .from("user_franchise_progress")
      .insert({ user_id: userId, entry_id: entryId });

    if (error && !error.message.includes("duplicate")) {
      throw new Error(`Failed to mark as watched: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("user_franchise_progress")
      .delete()
      .eq("user_id", userId)
      .eq("entry_id", entryId);

    if (error) {
      throw new Error(`Failed to unmark: ${error.message}`);
    }
  }

  const freshProgress = await fetchFreshUserProgress(userId, franchiseId);
  const cacheKey = `${FRANCHISE_PROGRESS_CACHE_PREFIX}${franchiseId}`;
  await AsyncStorage.setItem(cacheKey, JSON.stringify(freshProgress));
}

export function prefetchFranchiseEntries(franchiseId: string) {
  const cacheKey = `${FRANCHISE_ENTRIES_CACHE_PREFIX}${franchiseId}`;
  void fetchFreshFranchiseEntries(franchiseId)
    .then(async (entries) => {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entries));
      warmEntryImages(entries);
    })
    .catch(() => undefined);
}

export async function clearFranchiseCache(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const franchiseKeys = allKeys.filter(
    (key) =>
      key === FRANCHISE_CATALOG_CACHE_KEY
      || key.startsWith(FRANCHISE_ENTRIES_CACHE_PREFIX)
      || key.startsWith(FRANCHISE_PROGRESS_CACHE_PREFIX)
  );

  if (franchiseKeys.length > 0) {
    await AsyncStorage.multiRemove(franchiseKeys);
  }
}
