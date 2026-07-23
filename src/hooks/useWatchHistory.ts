import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getMovieDetails,
  getSeriesDetails,
  type CastGender,
  type MediaType,
  type MovieDetails,
  type SeriesDetails,
  type SeriesSeason,
} from "../api/tmdb";
import { useAppSettings } from "../settings/AppSettingsContext";
import {
  enqueueWatchHistoryBatch,
  type WatchHistoryQueueItem,
  type UserMediaSyncDetails,
} from "../services/userDataSync";
import { WATCH_HISTORY_STORAGE_KEY } from "../services/userDataStorage";
import { mapWithConcurrency } from "../utils/concurrency";
import { applyWatchHistoryOps, type WatchHistoryListOp } from "../utils/watchHistoryOps";

const METADATA_VERSION = 5;
const LEGACY_METADATA_MIGRATION_CONCURRENCY = 4;

export type WatchPrecision = "day" | "month" | "none";
export type WatchHistoryKind = "title" | "season";

export type WatchHistoryEntry = {
  id: number | string;
  sourceTmdbId: number | null;
  mediaType: MediaType;
  historyKind: WatchHistoryKind;
  seasonNumber: number | null;
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
  watchPrecision: WatchPrecision;
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

function normalizeWatchPrecision(value: unknown): WatchPrecision {
  if (value === "month") return "month";
  if (value === "none") return "none";
  return "day";
}

function normalizeWatchHistoryKind(value: unknown): WatchHistoryKind {
  return value === "season" ? "season" : "title";
}

function buildSeriesSeasonInternalId(seriesId: number, seasonNumber: number) {
  return `series-season:${seriesId}:${seasonNumber}`;
}

export function buildSeriesSeasonWatchTitle(seriesTitle: string, seasonName: string | null, seasonNumber: number) {
  const normalizedSeasonName = seasonName?.trim();
  if (normalizedSeasonName && normalizedSeasonName.length > 0) {
    return `${seriesTitle} - ${normalizedSeasonName}`;
  }

  return `${seriesTitle} - Season ${seasonNumber}`;
}

function resolveSourceTmdbId(entry: Pick<WatchHistoryEntry, "id" | "sourceTmdbId">) {
  if (typeof entry.sourceTmdbId === "number" && Number.isFinite(entry.sourceTmdbId) && entry.sourceTmdbId > 0) {
    return entry.sourceTmdbId;
  }

  return typeof entry.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
}

function normalizeStoredEntry(entry: StoredEntry): WatchHistoryEntry {
  const historyKind = normalizeWatchHistoryKind(entry.historyKind);
  const sourceTmdbId =
    typeof entry.sourceTmdbId === "number" && Number.isFinite(entry.sourceTmdbId)
      ? entry.sourceTmdbId
      : typeof entry.id === "number" && Number.isFinite(entry.id)
        ? entry.id
        : null;

  return {
    id: entry.id,
    sourceTmdbId,
    mediaType: entry.mediaType,
    historyKind,
    seasonNumber:
      typeof entry.seasonNumber === "number" && Number.isFinite(entry.seasonNumber)
        ? entry.seasonNumber
        : null,
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
    watchPrecision: normalizeWatchPrecision(entry.watchPrecision),
    metadataVersion: typeof entry.metadataVersion === "number" ? entry.metadataVersion : 1,
  };
}

export function buildMovieWatchEntry(
  details: MovieDetails,
  watchedAt: number,
  watchPrecision: WatchPrecision
): WatchHistoryEntry {
  return {
    id: details.id,
    sourceTmdbId: details.id,
    mediaType: "movie",
    historyKind: "title",
    seasonNumber: null,
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
    watchPrecision,
    metadataVersion: METADATA_VERSION,
  };
}

function buildSeriesWatchEntry(
  details: SeriesDetails,
  watchedAt: number,
  watchPrecision: WatchPrecision
): WatchHistoryEntry {
  return {
    id: details.id,
    sourceTmdbId: details.id,
    mediaType: "tv",
    historyKind: "title",
    seasonNumber: null,
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
    watchPrecision,
    metadataVersion: METADATA_VERSION,
  };
}

function buildSeriesSeasonWatchEntry(
  details: SeriesDetails,
  season: SeriesSeason,
  watchedAt: number,
  watchPrecision: WatchPrecision
): WatchHistoryEntry {
  return {
    id: buildSeriesSeasonInternalId(details.id, season.seasonNumber),
    sourceTmdbId: details.id,
    mediaType: "tv",
    historyKind: "season",
    seasonNumber: season.seasonNumber,
    title: buildSeriesSeasonWatchTitle(details.title, season.name ?? null, season.seasonNumber),
    posterPath: season.posterPath ?? details.posterPath,
    genres: details.genres,
    runtimeMinutes: details.episodeRuntimeMinutes,
    episodeCount: season.episodeCount,
    voteAverage: details.voteAverage,
    year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : "",
    ...topCast(details.cast),
    ...topDirectors(details.directors),
    watchedAt,
    watchPrecision,
    metadataVersion: METADATA_VERSION,
  };
}

function getSortTimestamp(entry: WatchHistoryEntry) {
  return entry.watchedAt;
}

function sortEntries(entries: WatchHistoryEntry[]) {
  return [...entries].sort((left, right) => getSortTimestamp(right) - getSortTimestamp(left));
}

async function readEntriesFromStorage(): Promise<WatchHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(WATCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEntry[];
    if (!Array.isArray(parsed)) return [];
    return sortEntries(parsed.map(normalizeStoredEntry));
  } catch {
    return [];
  }
}

type WatchHistoryMutation =
  | { kind: "upsert"; entry: WatchHistoryEntry; auditDetails?: UserMediaSyncDetails | null }
  | { kind: "remove"; id: number | string; mediaType: MediaType; auditDetails?: UserMediaSyncDetails | null };

export type SeriesSeasonWatchedSave = {
  season: SeriesSeason;
  watchedAt: number;
  precision: Extract<WatchPrecision, "month" | "none">;
};

export type SeriesWatchedBatchInput = {
  seasonsToSave: SeriesSeasonWatchedSave[];
  seasonNumbersToRemove: number[];
  titleAction: "save" | "remove" | "none";
  titleWatchedAt?: number;
};

export function useWatchHistory() {
  const [entries, setEntries] = useState<WatchHistoryEntry[]>([]);
  const entriesRef = useRef<WatchHistoryEntry[]>([]);
  // Guards against mutating from a stale in-memory list: until the first load
  // (or persist) completes, entriesRef is [] and using it as the mutation base
  // would overwrite storage with a partial set (the movies-vanished bug).
  const hasLoadedRef = useRef(false);
  // Serializes mutations so two overlapping saves can't interleave their
  // read-modify-write cycles.
  const mutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const enrichEntry = useCallback(async (entry: WatchHistoryEntry): Promise<WatchHistoryEntry> => {
    if (entry.historyKind === "season") {
      return {
        ...entry,
        metadataVersion: METADATA_VERSION,
      };
    }

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

      const enriched = await mapWithConcurrency(
        currentEntries,
        LEGACY_METADATA_MIGRATION_CONCURRENCY,
        async (entry) => entry.metadataVersion < METADATA_VERSION ? enrichEntry(entry) : entry
      );

      const sorted = sortEntries(enriched);
      entriesRef.current = sorted;
      setEntries(sorted);
      await AsyncStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
    },
    [enrichEntry]
  );

  const loadEntries = useCallback(async () => {
    try {
      const normalized = await readEntriesFromStorage();
      entriesRef.current = normalized;
      hasLoadedRef.current = true;
      setEntries(normalized);
      void enrichLegacyEntries(normalized);
    } finally {
      setIsLoading(false);
    }
  }, [enrichLegacyEntries]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries, storageRevision]);

  const persistEntries = useCallback(
    async (nextEntries: WatchHistoryEntry[]) => {
      const sorted = sortEntries(nextEntries);
      entriesRef.current = sorted;
      setEntries(sorted);
      await AsyncStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(sorted));
      notifyStorageChanged();
    },
    [notifyStorageChanged]
  );

  // Local-first: apply the whole batch to the authoritative entry list, write
  // AsyncStorage once, and hand Supabase work to the debounced sync queue.
  // No network round-trip happens on the save path anymore.
  const applyWatchHistoryMutations = useCallback(
    async (mutations: WatchHistoryMutation[]) => {
      if (mutations.length === 0) {
        return;
      }

      const run = mutationChainRef.current.then(async () => {
        const currentEntries = hasLoadedRef.current
          ? entriesRef.current
          : await readEntriesFromStorage();
        const listOps: WatchHistoryListOp[] = mutations.map((mutation) =>
          mutation.kind === "upsert"
            ? { kind: "upsert", entry: mutation.entry }
            : { kind: "remove", id: mutation.id, mediaType: mutation.mediaType }
        );
        const nextEntries = applyWatchHistoryOps(currentEntries, listOps);
        await persistEntries(nextEntries);
        hasLoadedRef.current = true;
        const queueItems: WatchHistoryQueueItem[] = mutations.map((mutation) =>
          mutation.kind === "upsert"
            ? { operation: "upsert", entry: mutation.entry, audit: mutation.auditDetails ?? {} }
            : { operation: "delete", mediaType: mutation.mediaType, tmdbId: mutation.id, audit: mutation.auditDetails ?? {} }
        );
        await enqueueWatchHistoryBatch(queueItems);
      });
      mutationChainRef.current = run.catch(() => undefined);
      await run;
    },
    [persistEntries]
  );

  const upsertWatchHistoryEntry = useCallback(
    async (nextEntry: WatchHistoryEntry, auditDetails?: UserMediaSyncDetails | null) => {
      await applyWatchHistoryMutations([{ kind: "upsert", entry: nextEntry, auditDetails }]);
    },
    [applyWatchHistoryMutations]
  );

  const saveMovieToWatchHistory = useCallback(
    async (
      details: MovieDetails,
      watchedAt: number,
      auditDetails?: UserMediaSyncDetails | null,
      options?: { precision?: WatchPrecision }
    ) => {
      const nextEntry = buildMovieWatchEntry(details, watchedAt, options?.precision ?? "day");
      await upsertWatchHistoryEntry(nextEntry, {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
        ...auditDetails,
      });
    },
    [upsertWatchHistoryEntry]
  );

  const saveSeriesToWatchHistory = useCallback(
    async (
      details: SeriesDetails,
      watchedAt: number,
      auditDetails?: UserMediaSyncDetails | null,
      options?: { precision?: WatchPrecision }
    ) => {
      const nextEntry = buildSeriesWatchEntry(details, watchedAt, options?.precision ?? "day");
      await upsertWatchHistoryEntry(nextEntry, {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
        ...auditDetails,
      });
    },
    [upsertWatchHistoryEntry]
  );

  const saveSeriesSeasonToWatchHistory = useCallback(
    async (
      details: SeriesDetails,
      season: SeriesSeason,
      watchedAt: number,
      watchPrecision: Extract<WatchPrecision, "month" | "none">,
      auditDetails?: UserMediaSyncDetails | null
    ) => {
      const nextEntry = buildSeriesSeasonWatchEntry(details, season, watchedAt, watchPrecision);
      await upsertWatchHistoryEntry(nextEntry, {
        title: nextEntry.title,
        imdbId: details.imdbId,
        posterPath: nextEntry.posterPath,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
        ...auditDetails,
      });
    },
    [upsertWatchHistoryEntry]
  );

  // One-shot save for the season-log modal: every season upsert/removal plus
  // the series title entry lands in a single local write and a single queued
  // sync batch, instead of N sequential awaited round-trips.
  const saveSeriesWatchedBatch = useCallback(
    async (
      details: SeriesDetails,
      input: SeriesWatchedBatchInput,
      auditDetails?: UserMediaSyncDetails | null
    ) => {
      const baseAudit: UserMediaSyncDetails = {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
        ...auditDetails,
      };

      const mutations: WatchHistoryMutation[] = [];
      for (const seasonNumber of input.seasonNumbersToRemove) {
        mutations.push({
          kind: "remove",
          id: buildSeriesSeasonInternalId(details.id, seasonNumber),
          mediaType: "tv",
          auditDetails: baseAudit,
        });
      }

      for (const { season, watchedAt, precision } of input.seasonsToSave) {
        const entry = buildSeriesSeasonWatchEntry(details, season, watchedAt, precision);
        mutations.push({
          kind: "upsert",
          entry,
          auditDetails: { ...baseAudit, title: entry.title, posterPath: entry.posterPath },
        });
      }

      if (input.titleAction === "save") {
        const entry = buildSeriesWatchEntry(details, input.titleWatchedAt ?? Date.now(), "none");
        mutations.push({ kind: "upsert", entry, auditDetails: baseAudit });
      } else if (input.titleAction === "remove") {
        mutations.push({ kind: "remove", id: details.id, mediaType: "tv", auditDetails: baseAudit });
      }

      await applyWatchHistoryMutations(mutations);
    },
    [applyWatchHistoryMutations]
  );

  const removeFromWatchHistory = useCallback(
    async (id: number | string, mediaType: MediaType, auditDetails?: UserMediaSyncDetails | null) => {
      await applyWatchHistoryMutations([{ kind: "remove", id, mediaType, auditDetails }]);
    },
    [applyWatchHistoryMutations]
  );

  const removeSeriesSeasonFromWatchHistory = useCallback(
    async (
      seriesId: number,
      seasonNumber: number,
      auditDetails?: UserMediaSyncDetails | null
    ) => {
      await removeFromWatchHistory(buildSeriesSeasonInternalId(seriesId, seasonNumber), "tv", auditDetails);
    },
    [removeFromWatchHistory]
  );

  const titleHistory = useMemo(
    () => sortEntries(entries.filter((entry) => entry.historyKind === "title")),
    [entries]
  );

  const activityHistory = useMemo(
    () =>
      sortEntries(
        entries.filter((entry) => {
          if (entry.watchPrecision === "none") {
            return false;
          }

          if (entry.mediaType === "movie") {
            return true;
          }

          return entry.historyKind === "season";
        })
      ),
    [entries]
  );

  const getWatchHistoryEntry = useCallback(
    (id: number | string, mediaType: MediaType) =>
      titleHistory.find((entry) => entry.id === id && entry.mediaType === mediaType) ?? null,
    [titleHistory]
  );

  const getSeriesSeasonWatchEntry = useCallback(
    (seriesId: number, seasonNumber: number) =>
      entries.find(
        (entry) =>
          entry.mediaType === "tv" &&
          entry.historyKind === "season" &&
          resolveSourceTmdbId(entry) === seriesId &&
          entry.seasonNumber === seasonNumber
      ) ?? null,
    [entries]
  );

  const getSeriesSeasonWatchEntries = useCallback(
    (seriesId: number) =>
      sortEntries(
        entries.filter(
          (entry) =>
            entry.mediaType === "tv" &&
            entry.historyKind === "season" &&
            resolveSourceTmdbId(entry) === seriesId
        )
      ),
    [entries]
  );

  const isWatched = useCallback(
    (id: number | string, mediaType: MediaType) => {
      if (mediaType === "movie") {
        return entries.some((entry) => entry.mediaType === "movie" && entry.id === id);
      }

      if (typeof id === "number") {
        return entries.some(
          (entry) => entry.mediaType === "tv" && resolveSourceTmdbId(entry) === id
        );
      }

      return entries.some((entry) => entry.mediaType === "tv" && entry.id === id);
    },
    [entries]
  );

  return useMemo(
    () => ({
      history: titleHistory,
      rawHistory: sortEntries(entries),
      activityHistory,
      isLoading,
      isWatched,
      getWatchHistoryEntry,
      getSeriesSeasonWatchEntry,
      getSeriesSeasonWatchEntries,
      saveMovieToWatchHistory,
      saveSeriesToWatchHistory,
      saveSeriesSeasonToWatchHistory,
      saveSeriesWatchedBatch,
      removeFromWatchHistory,
      removeSeriesSeasonFromWatchHistory,
      reload: loadEntries,
    }),
    [
      activityHistory,
      entries,
      getSeriesSeasonWatchEntries,
      getSeriesSeasonWatchEntry,
      getWatchHistoryEntry,
      isLoading,
      isWatched,
      loadEntries,
      removeFromWatchHistory,
      removeSeriesSeasonFromWatchHistory,
      saveMovieToWatchHistory,
      saveSeriesSeasonToWatchHistory,
      saveSeriesToWatchHistory,
      saveSeriesWatchedBatch,
      titleHistory,
    ]
  );
}
