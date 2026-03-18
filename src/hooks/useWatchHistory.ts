import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getMovieDetails,
  getSeriesDetails,
  type CastGender,
  type MediaType,
  type MovieDetails,
  type SeriesDetails,
} from "../api/tmdb";
import { useAppSettings } from "../settings/AppSettingsContext";
import { enqueueWatchHistoryDelete, enqueueWatchHistoryUpsert, type UserMediaSyncDetails } from "../services/userDataSync";
import { WATCH_HISTORY_STORAGE_KEY } from "../services/userDataStorage";

const METADATA_VERSION = 4;

export type WatchHistoryEntry = {
  id: number | string;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  episodeCount: number | null;
  voteAverage: number;
  year: string;
  castIds: number[];
  castNames: string[];
  castProfilePaths: (string | null)[];
  castGenders: CastGender[];
  directorIds: number[];
  directorNames: string[];
  directorProfilePaths: (string | null)[];
  watchedAt: number;
  metadataVersion: number;
};

type StoredEntry = Partial<WatchHistoryEntry> & {
  id: number | string;
  mediaType: MediaType;
  title: string;
  watchedAt: number;
};

function topCast(cast: { id: number; name: string; profilePath: string | null; gender: CastGender }[]) {
  const top5 = cast.slice(0, 5);
  return {
    castIds: top5.map((member) => member.id),
    castNames: top5.map((member) => member.name),
    castProfilePaths: top5.map((member) => member.profilePath),
    castGenders: top5.map((member) => member.gender),
  };
}

function topDirectors(directors: { id: number; name: string; profilePath: string | null }[]) {
  const top5 = directors.slice(0, 5);
  return {
    directorIds: top5.map((member) => member.id),
    directorNames: top5.map((member) => member.name),
    directorProfilePaths: top5.map((member) => member.profilePath),
  };
}

function normalizeStoredEntry(entry: StoredEntry): WatchHistoryEntry {
  return {
    id: entry.id,
    mediaType: entry.mediaType,
    title: entry.title,
    posterPath: entry.posterPath ?? null,
    genres: Array.isArray(entry.genres) ? entry.genres : [],
    runtimeMinutes: entry.runtimeMinutes ?? null,
    episodeCount: typeof entry.episodeCount === "number" ? entry.episodeCount : null,
    voteAverage: typeof entry.voteAverage === "number" ? entry.voteAverage : 0,
    year: typeof entry.year === "string" ? entry.year : "",
    castIds: Array.isArray(entry.castIds) ? entry.castIds : [],
    castNames: Array.isArray(entry.castNames) ? entry.castNames : [],
    castProfilePaths: Array.isArray(entry.castProfilePaths) ? entry.castProfilePaths : [],
    castGenders: Array.isArray(entry.castGenders) ? entry.castGenders : [],
    directorIds: Array.isArray(entry.directorIds) ? entry.directorIds : [],
    directorNames: Array.isArray(entry.directorNames) ? entry.directorNames : [],
    directorProfilePaths: Array.isArray(entry.directorProfilePaths) ? entry.directorProfilePaths : [],
    watchedAt: entry.watchedAt,
    metadataVersion: typeof entry.metadataVersion === "number" ? entry.metadataVersion : 1,
  };
}

function buildMovieWatchEntry(details: MovieDetails, watchedAt: number): WatchHistoryEntry {
  return {
    id: details.id,
    mediaType: "movie",
    title: details.title,
    posterPath: details.posterPath,
    genres: details.genres,
    runtimeMinutes: details.runtimeMinutes,
    episodeCount: null,
    voteAverage: details.voteAverage,
    year: details.releaseDate ? details.releaseDate.slice(0, 4) : "",
    ...topCast(details.cast),
    ...topDirectors(details.directors),
    watchedAt,
    metadataVersion: METADATA_VERSION,
  };
}

function buildSeriesWatchEntry(details: SeriesDetails, watchedAt: number): WatchHistoryEntry {
  return {
    id: details.id,
    mediaType: "tv",
    title: details.title,
    posterPath: details.posterPath,
    genres: details.genres,
    runtimeMinutes: details.episodeRuntimeMinutes,
    episodeCount: details.numberOfEpisodes,
    voteAverage: details.voteAverage,
    year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : "",
    ...topCast(details.cast),
    ...topDirectors(details.directors),
    watchedAt,
    metadataVersion: METADATA_VERSION,
  };
}

function buildAzClassicWatchEntry(details: any, watchedAt: number): WatchHistoryEntry {
  return {
    id: details.id,
    mediaType: "movie",
    title: details.title,
    posterPath: details.posterUrl || details.posterPath || null,
    genres: details.genre ? [details.genre] : (details.genres || []),
    runtimeMinutes: details.runtimeMinutes || null,
    episodeCount: null,
    voteAverage: details.voteAverage || 0,
    year: String(details.year || ""),
    castIds: [],
    castNames: Array.isArray(details.cast) ? details.cast.map((c: any) => c.name) : [],
    castProfilePaths: Array.isArray(details.cast) ? details.cast.map((c: any) => c.photoUrl || null) : [],
    castGenders: [],
    directorIds: [],
    directorNames: Array.isArray(details.crew) ? details.crew.filter((c: any) => c.role?.toLowerCase().includes("rejissor") || c.role?.toLowerCase().includes("director")).map((c: any) => c.name) : [],
    directorProfilePaths: [],
    watchedAt,
    metadataVersion: METADATA_VERSION,
  };
}

function sortEntries(entries: WatchHistoryEntry[]) {
  return [...entries].sort((left, right) => right.watchedAt - left.watchedAt);
}

export function useWatchHistory() {
  const [entries, setEntries] = useState<WatchHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const enrichEntry = useCallback(async (entry: WatchHistoryEntry): Promise<WatchHistoryEntry> => {
    // Skip enrichment for internal media (string IDs)
    if (typeof entry.id === "string") {
      return {
        ...entry,
        metadataVersion: METADATA_VERSION,
      };
    }

    try {
      if (entry.mediaType === "movie") {
        const details = await getMovieDetails(String(entry.id));
        return {
          ...entry,
          genres: details.genres,
          runtimeMinutes: details.runtimeMinutes,
          episodeCount: null,
          voteAverage: details.voteAverage,
          year: details.releaseDate ? details.releaseDate.slice(0, 4) : entry.year,
          ...topCast(details.cast),
          ...topDirectors(details.directors),
          metadataVersion: METADATA_VERSION,
        };
      }

      const details = await getSeriesDetails(String(entry.id));
      return {
        ...entry,
        genres: details.genres,
        runtimeMinutes: details.episodeRuntimeMinutes,
        episodeCount: details.numberOfEpisodes,
        voteAverage: details.voteAverage,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : entry.year,
        ...topCast(details.cast),
        ...topDirectors(details.directors),
        metadataVersion: METADATA_VERSION,
      };
    } catch {
      return {
        ...entry,
        metadataVersion: METADATA_VERSION,
      };
    }
  }, []);

  const enrichLegacyEntries = useCallback(
    async (currentEntries: WatchHistoryEntry[]) => {
      const needsMigration = currentEntries.some((entry) => entry.metadataVersion < METADATA_VERSION);
      if (!needsMigration) {
        return;
      }

      const enriched = await Promise.all(
        currentEntries.map((entry) =>
          entry.metadataVersion < METADATA_VERSION ? enrichEntry(entry) : entry
        )
      );

      const sorted = sortEntries(enriched);
      setEntries(sorted);
      await AsyncStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
    },
    [enrichEntry]
  );

  const loadEntries = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(WATCH_HISTORY_STORAGE_KEY);
      if (!raw) {
        setEntries([]);
        return;
      }

      const parsed = JSON.parse(raw) as StoredEntry[];
      if (!Array.isArray(parsed)) {
        setEntries([]);
        return;
      }

      const normalized = sortEntries(parsed.map(normalizeStoredEntry));
      setEntries(normalized);
      void enrichLegacyEntries(normalized);
    } finally {
      setIsLoading(false);
    }
  }, [enrichLegacyEntries]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries, storageRevision]);

  const persistEntries = useCallback(async (nextEntries: WatchHistoryEntry[]) => {
    const sorted = sortEntries(nextEntries);
    setEntries(sorted);
    await AsyncStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
    notifyStorageChanged();
  }, [notifyStorageChanged]);

  const saveMovieToWatchHistory = useCallback(
    async (details: MovieDetails, watchedAt: number, auditDetails?: UserMediaSyncDetails | null) => {
      const nextEntry = buildMovieWatchEntry(details, watchedAt);
      const filtered = entries.filter((entry) => !(entry.id === details.id && entry.mediaType === "movie"));
      await persistEntries([nextEntry, ...filtered]);
      await enqueueWatchHistoryUpsert(nextEntry, {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
        ...auditDetails,
      });
    },
    [entries, persistEntries]
  );

  const saveSeriesToWatchHistory = useCallback(
    async (details: SeriesDetails, watchedAt: number, auditDetails?: UserMediaSyncDetails | null) => {
      const nextEntry = buildSeriesWatchEntry(details, watchedAt);
      const filtered = entries.filter((entry) => !(entry.id === details.id && entry.mediaType === "tv"));
      await persistEntries([nextEntry, ...filtered]);
      await enqueueWatchHistoryUpsert(nextEntry, {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
        ...auditDetails,
      });
    },
    [entries, persistEntries]
  );

  const saveAzClassicToWatchHistory = useCallback(
    async (details: any, watchedAt: number, auditDetails?: UserMediaSyncDetails | null) => {
      const nextEntry = buildAzClassicWatchEntry(details, watchedAt);
      const filtered = entries.filter((entry) => !(entry.id === details.id && entry.mediaType === "movie"));
      await persistEntries([nextEntry, ...filtered]);
      await enqueueWatchHistoryUpsert(nextEntry, {
        title: details.title,
        imdbId: details.imdbId || null,
        posterPath: details.posterUrl || details.posterPath || null,
        year: String(details.year || ""),
        ...auditDetails,
      });
    },
    [entries, persistEntries]
  );

  const removeFromWatchHistory = useCallback(
    async (id: number | string, mediaType: MediaType, auditDetails?: UserMediaSyncDetails | null) => {
      const filtered = entries.filter((entry) => !(entry.id === id && entry.mediaType === mediaType));
      await persistEntries(filtered);
      await enqueueWatchHistoryDelete(mediaType, id, auditDetails ?? {});
    },
    [entries, persistEntries]
  );

  const getWatchHistoryEntry = useCallback(
    (id: number | string, mediaType: MediaType) => entries.find((entry) => entry.id === id && entry.mediaType === mediaType) ?? null,
    [entries]
  );

  const isWatched = useCallback(
    (id: number | string, mediaType: MediaType) => entries.some((entry) => entry.id === id && entry.mediaType === mediaType),
    [entries]
  );

  const history = useMemo(() => sortEntries(entries), [entries]);

  return useMemo(
    () => ({
      history,
      isLoading,
      isWatched,
      getWatchHistoryEntry,
      saveMovieToWatchHistory,
      saveSeriesToWatchHistory,
      saveAzClassicToWatchHistory,
      removeFromWatchHistory,
      reload: loadEntries,
    }),
    [
      getWatchHistoryEntry,
      history,
      isLoading,
      isWatched,
      loadEntries,
      removeFromWatchHistory,
      saveMovieToWatchHistory,
      saveSeriesToWatchHistory,
      saveAzClassicToWatchHistory,
    ]
  );
}
