import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MediaType } from "../api/tmdb";
import type { WatchHistoryEntry } from "../hooks/useWatchHistory";
import {
  APP_SETTINGS_STORAGE_KEY,
  createDefaultSettings,
  normalizeSettings,
  type PersistedSettings,
} from "../settings/settingsStorage";
import { DEFAULT_THEME_ID, THEME_OPTIONS, type ThemeId } from "../theme/Theme";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabase";
import {
  LIKED_MOVIES_STORAGE_KEY,
  LIKED_SERIES_STORAGE_KEY,
  MOVIE_OF_DAY_CURRENT_STORAGE_KEY,
  MOVIE_OF_DAY_HISTORY_STORAGE_KEY,
  RECENTLY_WATCHED_STORAGE_KEY,
  SERIES_WATCHLIST_STORAGE_KEY,
  WATCHED_EPISODES_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
} from "./userDataStorage";

const SYNC_QUEUE_STORAGE_KEY = "@streambox/sync-queue-v1";
const ACTIVE_SYNC_USER_KEY = "@streambox/active-sync-user-id-v1";
const BOOTSTRAP_COMPLETE_KEY_PREFIX = "@streambox/bootstrap-complete-v1:";
const PROFILE_ASSETS_BUCKET = "profile-assets";
const SIGNED_ASSET_TTL_SECONDS = 60 * 60 * 24 * 365;
const MAX_RECENTLY_VIEWED = 30;
const MOVIE_OF_DAY_KIND = "movie_of_the_day";
const MOVIE_OF_DAY_HISTORY_KIND = "movie_of_the_day_history";

const VALID_THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map((option) => option.id));

type SyncListKind = "watchlist" | "liked" | "recently_viewed";
type SyncAssetKind = "avatar" | "banner";

type SyncMetadata = Record<string, unknown>;

type RecentlyWatchedEntry = {
  id: number;
  mediaType: MediaType;
  timestamp: number;
};

type MovieOfDayCurrent = {
  dateKey: string;
  movie: Record<string, unknown> | null;
};

type MovieOfDayHistory = {
  tmdbIds: number[];
  imdbIds: string[];
};

type LocalUserSnapshot = {
  settings: PersistedSettings;
  movieWatchlist: number[];
  seriesWatchlist: number[];
  likedMovies: number[];
  likedSeries: number[];
  watchHistory: WatchHistoryEntry[];
  recentlyViewed: RecentlyWatchedEntry[];
  watchedEpisodes: Record<string, boolean>;
  movieOfDayCurrent: MovieOfDayCurrent | null;
  movieOfDayHistory: MovieOfDayHistory;
};

type RemoteMediaLibraryEntry = {
  mediaType: MediaType;
  tmdbId: number;
  imdbId: string | null;
  collectedAt: string;
  snapshot: SyncMetadata;
  updatedAt?: string;
};

type RemoteWatchHistoryEntry = {
  mediaType: MediaType;
  tmdbId: number;
  imdbId: string | null;
  title: string;
  posterPath: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  episodeCount: number | null;
  voteAverage: number;
  releaseYear: number | null;
  castIds: number[];
  castNames: string[];
  castProfilePaths: (string | null)[];
  castGenders: ("male" | "female")[];
  directorIds: number[];
  directorNames: string[];
  directorProfilePaths: (string | null)[];
  watchedAt: string;
  metadataVersion: number;
  snapshot: SyncMetadata;
  updatedAt?: string;
};

type RemoteEpisodeProgressEntry = {
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string;
  snapshot: SyncMetadata;
  updatedAt?: string;
};

type RemoteDailyRecommendationEntry = {
  recommendationKind: string;
  recommendationDate: string;
  mediaType: MediaType;
  tmdbId: number | null;
  imdbId: string | null;
  strategy: string | null;
  snapshot: SyncMetadata;
  updatedAt?: string;
};

type RemoteBootstrap = {
  profile?: {
    displayName?: string;
    bio?: string;
    location?: string;
    birthday?: string | null;
    joinedAt?: string;
    avatarPath?: string | null;
    bannerPath?: string | null;
    avatarVersion?: number;
    bannerVersion?: number;
  };
  settings?: {
    themeId?: string;
    onboardingCompletedAt?: string | null;
    preferences?: SyncMetadata;
  };
  watchlist?: RemoteMediaLibraryEntry[];
  liked?: RemoteMediaLibraryEntry[];
  recentlyViewed?: RemoteMediaLibraryEntry[];
  watchHistory?: RemoteWatchHistoryEntry[];
  episodeProgress?: RemoteEpisodeProgressEntry[];
  dailyRecommendations?: RemoteDailyRecommendationEntry[];
};

type QueuedProfileSettingsOperation = {
  kind: "profile_settings";
  userId: string;
  settings: PersistedSettings;
  auditMetadata: SyncMetadata;
};

type QueuedAssetUploadOperation = {
  kind: "asset_upload";
  userId: string;
  assetKind: SyncAssetKind;
  localUri: string;
  previousPath: string | null;
  nextVersion: number;
};

type QueuedMediaLibraryOperation = {
  kind: "media_library";
  userId: string;
  operation: "upsert" | "delete";
  listKind: SyncListKind;
  mediaType: MediaType;
  tmdbId: number;
  imdbId: string | null;
  collectedAt: string;
  snapshot: SyncMetadata;
  auditMetadata: SyncMetadata;
};

type QueuedWatchHistoryUpsertOperation = {
  kind: "watch_history_upsert";
  userId: string;
  entry: WatchHistoryEntry;
  auditMetadata: SyncMetadata;
};

type QueuedWatchHistoryDeleteOperation = {
  kind: "watch_history_delete";
  userId: string;
  mediaType: MediaType;
  tmdbId: number;
  auditMetadata: SyncMetadata;
};

type QueuedEpisodeProgressOperation = {
  kind: "episode_progress";
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  isWatched: boolean;
  watchedAt: string;
  auditMetadata: SyncMetadata;
};

type QueuedDailyRecommendationOperation = {
  kind: "daily_recommendation";
  userId: string;
  recommendationKind: string;
  recommendationDate: string;
  mediaType: MediaType;
  tmdbId: number | null;
  imdbId: string | null;
  strategy: string | null;
  snapshot: SyncMetadata;
};

type QueuedAuthEventOperation = {
  kind: "auth_event";
  userId: string;
  actionCategory: string;
  actionType: string;
  entityType: string | null;
  entityKey: string | null;
  metadata: SyncMetadata;
  createdAt: string;
};

type PendingSyncOperation =
  | QueuedProfileSettingsOperation
  | QueuedAssetUploadOperation
  | QueuedMediaLibraryOperation
  | QueuedWatchHistoryUpsertOperation
  | QueuedWatchHistoryDeleteOperation
  | QueuedEpisodeProgressOperation
  | QueuedDailyRecommendationOperation
  | QueuedAuthEventOperation;

export type UserMediaSyncDetails = {
  title?: string;
  imdbId?: string | null;
  posterPath?: string | null;
  year?: string | null;
  overview?: string | null;
};

let flushPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveThemeId(value: unknown): ThemeId {
  return typeof value === "string" && VALID_THEME_IDS.has(value as ThemeId)
    ? (value as ThemeId)
    : DEFAULT_THEME_ID;
}

function coerceMediaType(value: unknown): MediaType {
  return value === "tv" ? "tv" : "movie";
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function coerceNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    : [];
}

function isLocalFileUri(uri: string | null | undefined): uri is string {
  return typeof uri === "string" && uri.startsWith("file://");
}

function normalizeSyncMetadata(value: SyncMetadata | null | undefined): SyncMetadata {
  return isRecord(value) ? value : {};
}

function normalizeMediaSnapshot(details?: UserMediaSyncDetails | null): SyncMetadata {
  if (!details) {
    return {};
  }

  const snapshot: SyncMetadata = {};
  if (details.title) snapshot.title = details.title;
  if (details.imdbId) snapshot.imdbId = details.imdbId;
  if (details.posterPath) snapshot.posterPath = details.posterPath;
  if (details.year) snapshot.year = details.year;
  if (details.overview) snapshot.overview = details.overview;
  return snapshot;
}

function formatBirthdayForDatabase(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split("/");
  if (parts.length !== 3) {
    return null;
  }

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatBirthdayForLocal(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return "";
  }

  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function getEpisodeKey(seriesTmdbId: number, seasonNumber: number, episodeNumber: number) {
  return `${seriesTmdbId}_${seasonNumber}_${episodeNumber}`;
}

function getBootstrapCompleteKey(userId: string) {
  return `${BOOTSTRAP_COMPLETE_KEY_PREFIX}${userId}`;
}

function getTodayDateKey(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePersistedSettings(raw: string | null): PersistedSettings {
  if (!raw) {
    return createDefaultSettings(DEFAULT_THEME_ID);
  }

  try {
    return normalizeSettings(JSON.parse(raw) as Partial<PersistedSettings>, DEFAULT_THEME_ID);
  } catch {
    return createDefaultSettings(DEFAULT_THEME_ID);
  }
}

function normalizeIdList(raw: string | null): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
      : [];
  } catch {
    return [];
  }
}

function normalizeWatchHistory(raw: string | null): WatchHistoryEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        id: typeof entry.id === "number" ? entry.id : 0,
        mediaType: coerceMediaType(entry.mediaType),
        title: typeof entry.title === "string" ? entry.title : "",
        posterPath: typeof entry.posterPath === "string" ? entry.posterPath : null,
        genres: coerceStringArray(entry.genres),
        runtimeMinutes: typeof entry.runtimeMinutes === "number" ? entry.runtimeMinutes : null,
        episodeCount: typeof entry.episodeCount === "number" ? entry.episodeCount : null,
        voteAverage: typeof entry.voteAverage === "number" ? entry.voteAverage : 0,
        year: typeof entry.year === "string" ? entry.year : "",
        castIds: coerceNumberArray(entry.castIds),
        castNames: coerceStringArray(entry.castNames),
        castProfilePaths: Array.isArray(entry.castProfilePaths)
          ? entry.castProfilePaths.map((value) => (typeof value === "string" ? value : null))
          : [],
        castGenders: Array.isArray(entry.castGenders)
          ? entry.castGenders.filter((value): value is "male" | "female" => value === "male" || value === "female")
          : [],
        directorIds: coerceNumberArray(entry.directorIds),
        directorNames: coerceStringArray(entry.directorNames),
        directorProfilePaths: Array.isArray(entry.directorProfilePaths)
          ? entry.directorProfilePaths.map((value) => (typeof value === "string" ? value : null))
          : [],
        watchedAt: typeof entry.watchedAt === "number" ? entry.watchedAt : Date.now(),
        metadataVersion: typeof entry.metadataVersion === "number" ? entry.metadataVersion : 1,
      }))
      .filter((entry) => entry.id > 0 && entry.title.trim().length > 0);
  } catch {
    return [];
  }
}

function normalizeRecentlyViewed(raw: string | null): RecentlyWatchedEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        id: typeof entry.id === "number" ? entry.id : 0,
        mediaType: coerceMediaType(entry.mediaType),
        timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
      }))
      .filter((entry) => entry.id > 0)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, MAX_RECENTLY_VIEWED);
  } catch {
    return [];
  }
}

function normalizeWatchedEpisodes(raw: string | null): Record<string, boolean> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, boolean>>((accumulator, [key, value]) => {
      if (value === true) {
        accumulator[key] = true;
      }
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function normalizeMovieOfDayCurrent(raw: string | null): MovieOfDayCurrent | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.dateKey !== "string") {
      return null;
    }

    return {
      dateKey: parsed.dateKey,
      movie: isRecord(parsed.movie) ? parsed.movie : null,
    };
  } catch {
    return null;
  }
}

function normalizeMovieOfDayHistory(raw: string | null): MovieOfDayHistory {
  if (!raw) {
    return { tmdbIds: [], imdbIds: [] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { tmdbIds: [], imdbIds: [] };
    }

    return {
      tmdbIds: coerceNumberArray(parsed.tmdbIds),
      imdbIds: Array.isArray(parsed.imdbIds)
        ? parsed.imdbIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
    };
  } catch {
    return { tmdbIds: [], imdbIds: [] };
  }
}

async function readLocalUserSnapshot(): Promise<LocalUserSnapshot> {
  const entries = await AsyncStorage.multiGet([
    APP_SETTINGS_STORAGE_KEY,
    WATCHLIST_STORAGE_KEY,
    SERIES_WATCHLIST_STORAGE_KEY,
    LIKED_MOVIES_STORAGE_KEY,
    LIKED_SERIES_STORAGE_KEY,
    WATCH_HISTORY_STORAGE_KEY,
    RECENTLY_WATCHED_STORAGE_KEY,
    WATCHED_EPISODES_STORAGE_KEY,
    MOVIE_OF_DAY_CURRENT_STORAGE_KEY,
    MOVIE_OF_DAY_HISTORY_STORAGE_KEY,
  ]);
  const map = new Map(entries);

  return {
    settings: normalizePersistedSettings(map.get(APP_SETTINGS_STORAGE_KEY) ?? null),
    movieWatchlist: normalizeIdList(map.get(WATCHLIST_STORAGE_KEY) ?? null),
    seriesWatchlist: normalizeIdList(map.get(SERIES_WATCHLIST_STORAGE_KEY) ?? null),
    likedMovies: normalizeIdList(map.get(LIKED_MOVIES_STORAGE_KEY) ?? null),
    likedSeries: normalizeIdList(map.get(LIKED_SERIES_STORAGE_KEY) ?? null),
    watchHistory: normalizeWatchHistory(map.get(WATCH_HISTORY_STORAGE_KEY) ?? null),
    recentlyViewed: normalizeRecentlyViewed(map.get(RECENTLY_WATCHED_STORAGE_KEY) ?? null),
    watchedEpisodes: normalizeWatchedEpisodes(map.get(WATCHED_EPISODES_STORAGE_KEY) ?? null),
    movieOfDayCurrent: normalizeMovieOfDayCurrent(map.get(MOVIE_OF_DAY_CURRENT_STORAGE_KEY) ?? null),
    movieOfDayHistory: normalizeMovieOfDayHistory(map.get(MOVIE_OF_DAY_HISTORY_STORAGE_KEY) ?? null),
  };
}

async function writeLocalUserSnapshot(snapshot: LocalUserSnapshot) {
  const setPairs: Array<[string, string]> = [
    [APP_SETTINGS_STORAGE_KEY, JSON.stringify(snapshot.settings)],
    [WATCHLIST_STORAGE_KEY, JSON.stringify(snapshot.movieWatchlist)],
    [SERIES_WATCHLIST_STORAGE_KEY, JSON.stringify(snapshot.seriesWatchlist)],
    [LIKED_MOVIES_STORAGE_KEY, JSON.stringify(snapshot.likedMovies)],
    [LIKED_SERIES_STORAGE_KEY, JSON.stringify(snapshot.likedSeries)],
    [WATCH_HISTORY_STORAGE_KEY, JSON.stringify(snapshot.watchHistory)],
    [RECENTLY_WATCHED_STORAGE_KEY, JSON.stringify(snapshot.recentlyViewed)],
    [WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(snapshot.watchedEpisodes)],
    [MOVIE_OF_DAY_HISTORY_STORAGE_KEY, JSON.stringify(snapshot.movieOfDayHistory)],
  ];

  if (snapshot.movieOfDayCurrent) {
    setPairs.push([MOVIE_OF_DAY_CURRENT_STORAGE_KEY, JSON.stringify(snapshot.movieOfDayCurrent)]);
  }

  await AsyncStorage.multiSet(setPairs);
  if (!snapshot.movieOfDayCurrent) {
    await AsyncStorage.removeItem(MOVIE_OF_DAY_CURRENT_STORAGE_KEY);
  }
}

async function updateLocalAssetMetadata(
  assetKind: SyncAssetKind,
  nextUri: string | null,
  nextPath: string | null,
  nextVersion: number
) {
  const raw = await AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  const current = normalizePersistedSettings(raw);
  const nextSettings: PersistedSettings = {
    ...current,
    ...(assetKind === "avatar"
      ? {
          profileImageUri: nextUri,
          profileImageStoragePath: nextPath,
          profileImageVersion: nextVersion,
        }
      : {
          bannerImageUri: nextUri,
          bannerImageStoragePath: nextPath,
          bannerImageVersion: nextVersion,
        }),
  };

  await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
}

async function getCurrentUserId() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

async function readPendingQueue(): Promise<PendingSyncOperation[]> {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingSyncOperation[]) : [];
  } catch {
    return [];
  }
}

async function writePendingQueue(queue: PendingSyncOperation[]) {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
    return;
  }

  await AsyncStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function getQueueOperationKey(operation: PendingSyncOperation): string | null {
  switch (operation.kind) {
    case "profile_settings":
      return `${operation.userId}:profile_settings`;
    case "asset_upload":
      return `${operation.userId}:asset:${operation.assetKind}`;
    case "media_library":
      return `${operation.userId}:media:${operation.listKind}:${operation.mediaType}:${operation.tmdbId}`;
    case "watch_history_upsert":
      return `${operation.userId}:watch_history:${operation.entry.mediaType}:${operation.entry.id}`;
    case "watch_history_delete":
      return `${operation.userId}:watch_history:${operation.mediaType}:${operation.tmdbId}`;
    case "episode_progress":
      return `${operation.userId}:episode:${operation.seriesTmdbId}:${operation.seasonNumber}:${operation.episodeNumber}`;
    case "daily_recommendation":
      return `${operation.userId}:daily:${operation.recommendationKind}:${operation.recommendationDate}`;
    default:
      return null;
  }
}

function mergePendingOperation(current: PendingSyncOperation, next: PendingSyncOperation): PendingSyncOperation {
  if (current.kind === "profile_settings" && next.kind === "profile_settings") {
    return {
      ...next,
      auditMetadata: {
        ...current.auditMetadata,
        ...next.auditMetadata,
      },
    };
  }

  return next;
}

async function enqueuePendingOperation(operation: PendingSyncOperation) {
  const queue = await readPendingQueue();
  const operationKey = getQueueOperationKey(operation);

  if (!operationKey) {
    queue.push(operation);
    await writePendingQueue(queue);
    return;
  }

  const existingIndex = queue.findIndex((queuedOperation) => getQueueOperationKey(queuedOperation) === operationKey);
  if (existingIndex >= 0) {
    queue[existingIndex] = mergePendingOperation(queue[existingIndex], operation);
  } else {
    queue.push(operation);
  }

  await writePendingQueue(queue);
}

function unionIds(primary: number[], secondary: number[]) {
  return Array.from(new Set([...primary, ...secondary]));
}

function mergeWatchHistoryEntries(primary: WatchHistoryEntry[], secondary: WatchHistoryEntry[]) {
  const merged = new Map<string, WatchHistoryEntry>();

  [...primary, ...secondary].forEach((entry) => {
    const key = `${entry.mediaType}:${entry.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      return;
    }

    if (entry.watchedAt > existing.watchedAt || entry.metadataVersion > existing.metadataVersion) {
      merged.set(key, entry);
    }
  });

  return [...merged.values()].sort((left, right) => right.watchedAt - left.watchedAt);
}

function mergeRecentlyViewedEntries(primary: RecentlyWatchedEntry[], secondary: RecentlyWatchedEntry[]) {
  const merged = new Map<string, RecentlyWatchedEntry>();

  [...primary, ...secondary].forEach((entry) => {
    const key = `${entry.mediaType}:${entry.id}`;
    const existing = merged.get(key);
    if (!existing || entry.timestamp > existing.timestamp) {
      merged.set(key, entry);
    }
  });

  return [...merged.values()].sort((left, right) => right.timestamp - left.timestamp).slice(0, MAX_RECENTLY_VIEWED);
}

function mergeWatchedEpisodeMaps(primary: Record<string, boolean>, secondary: Record<string, boolean>) {
  return {
    ...secondary,
    ...primary,
  };
}

function convertRemoteWatchHistory(entries: RemoteWatchHistoryEntry[]): WatchHistoryEntry[] {
  return entries
    .filter((entry) => entry.tmdbId > 0 && entry.title.trim().length > 0)
    .map((entry) => ({
      id: entry.tmdbId,
      mediaType: coerceMediaType(entry.mediaType),
      title: entry.title,
      posterPath: entry.posterPath ?? null,
      genres: coerceStringArray(entry.genres),
      runtimeMinutes: typeof entry.runtimeMinutes === "number" ? entry.runtimeMinutes : null,
      episodeCount: typeof entry.episodeCount === "number" ? entry.episodeCount : null,
      voteAverage: typeof entry.voteAverage === "number" ? entry.voteAverage : 0,
      year: typeof entry.releaseYear === "number" ? String(entry.releaseYear) : "",
      castIds: coerceNumberArray(entry.castIds),
      castNames: coerceStringArray(entry.castNames),
      castProfilePaths: Array.isArray(entry.castProfilePaths)
        ? entry.castProfilePaths.map((value) => (typeof value === "string" ? value : null))
        : [],
      castGenders: Array.isArray(entry.castGenders)
        ? entry.castGenders.filter((value): value is "male" | "female" => value === "male" || value === "female")
        : [],
      directorIds: coerceNumberArray(entry.directorIds),
      directorNames: coerceStringArray(entry.directorNames),
      directorProfilePaths: Array.isArray(entry.directorProfilePaths)
        ? entry.directorProfilePaths.map((value) => (typeof value === "string" ? value : null))
        : [],
      watchedAt: Date.parse(entry.watchedAt) || Date.now(),
      metadataVersion: typeof entry.metadataVersion === "number" ? entry.metadataVersion : 1,
    }));
}

function convertRemoteEpisodeProgress(entries: RemoteEpisodeProgressEntry[]) {
  return entries.reduce<Record<string, boolean>>((accumulator, entry) => {
    if (entry.seriesTmdbId > 0 && entry.seasonNumber > 0 && entry.episodeNumber > 0) {
      accumulator[getEpisodeKey(entry.seriesTmdbId, entry.seasonNumber, entry.episodeNumber)] = true;
    }
    return accumulator;
  }, {});
}

function convertRemoteDailyRecommendations(entries: RemoteDailyRecommendationEntry[]) {
  const history = {
    tmdbIds: [] as number[],
    imdbIds: [] as string[],
  };
  let current: MovieOfDayCurrent | null = null;

  entries.forEach((entry) => {
    if (typeof entry.tmdbId === "number" && entry.tmdbId > 0 && !history.tmdbIds.includes(entry.tmdbId)) {
      history.tmdbIds.push(entry.tmdbId);
      history.imdbIds.push(entry.imdbId ?? "");
    }

    if (entry.recommendationKind === MOVIE_OF_DAY_KIND) {
      const nextMovie = isRecord(entry.snapshot.movie)
        ? (entry.snapshot.movie as Record<string, unknown>)
        : typeof entry.tmdbId === "number" && entry.tmdbId > 0
          ? {
              id: entry.tmdbId,
              title: typeof entry.snapshot.title === "string" ? entry.snapshot.title : "",
            }
          : null;

      if (!current || entry.recommendationDate >= current.dateKey) {
        current = {
          dateKey: entry.recommendationDate,
          movie: nextMovie,
        };
      }
    }
  });

  return {
    current,
    history,
  };
}

// ---------------------------------------------------------------------------
//  Profile-asset URL resolution (bulletproof, multi-strategy)
// ---------------------------------------------------------------------------

/**
 * Resolve a displayable URL for a storage object.  Tries in order:
 *   1. Signed URL  (works for private buckets)
 *   2. Public URL  (works for public buckets)
 *   3. Direct download URL construction (last resort)
 * Returns `null` only when every strategy fails.
 */
async function resolveStorageUrl(storagePath: string): Promise<string | null> {
  // Strategy 1 — signed URL (handles private buckets)
  try {
    const { data, error } = await supabase.storage
      .from(PROFILE_ASSETS_BUCKET)
      .createSignedUrl(storagePath, SIGNED_ASSET_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    console.warn("[asset-resolve] signed-url failed:", error?.message);
  } catch (e) {
    console.warn("[asset-resolve] signed-url threw:", e);
  }

  // Strategy 2 — public URL (handles public buckets, no auth needed)
  try {
    const { data } = supabase.storage
      .from(PROFILE_ASSETS_BUCKET)
      .getPublicUrl(storagePath);
    if (data?.publicUrl) {
      // Verify the URL is actually reachable (public buckets only)
      const probe = await fetch(data.publicUrl, { method: "HEAD" });
      if (probe.ok) {
        return data.publicUrl;
      }
      console.warn("[asset-resolve] public-url not reachable:", probe.status);
    }
  } catch (e) {
    console.warn("[asset-resolve] public-url threw:", e);
  }

  // Strategy 3 — download binary and save to local cache file
  try {
    const { data: dlData, error: dlError } = await supabase.storage
      .from(PROFILE_ASSETS_BUCKET)
      .download(storagePath);
    if (!dlError && dlData) {
      const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (cacheDir) {
        const safeFileName = storagePath.replace(/[^a-zA-Z0-9._-]/g, "_");
        const localPath = `${cacheDir}streambox-assets/${safeFileName}`;
        await FileSystem.makeDirectoryAsync(`${cacheDir}streambox-assets/`, { intermediates: true });
        // Convert blob → base64 → write to file
        const base64 = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = typeof reader.result === "string" ? reader.result : null;
            // Strip the data:…;base64, prefix
            resolve(result ? result.split(",")[1] ?? null : null);
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(dlData);
        });
        if (base64) {
          await FileSystem.writeAsStringAsync(localPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return localPath;
        }
      }
    }
    console.warn("[asset-resolve] download failed:", dlError?.message);
  } catch (e) {
    console.warn("[asset-resolve] download threw:", e);
  }

  return null;
}

/**
 * Query the user_profiles table directly — the single source of truth for
 * avatar / banner storage paths and their version counters.
 * This is independent of the bootstrap RPC and immune to its field-naming.
 */
async function fetchProfileAssetsFromDB(): Promise<{
  avatarPath: string | null;
  bannerPath: string | null;
  avatarVersion: number;
  bannerVersion: number;
}> {
  const empty = { avatarPath: null, bannerPath: null, avatarVersion: 0, bannerVersion: 0 };
  try {
    const userId = await getCurrentUserId();
    if (!userId) return empty;

    const { data, error } = await supabase
      .from("user_profiles")
      .select("avatar_path, banner_path, avatar_version, banner_version")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.warn("[asset-resolve] user_profiles query failed:", error?.message);
      return empty;
    }

    return {
      avatarPath: typeof data.avatar_path === "string" && data.avatar_path.length > 0 ? data.avatar_path : null,
      bannerPath: typeof data.banner_path === "string" && data.banner_path.length > 0 ? data.banner_path : null,
      avatarVersion: typeof data.avatar_version === "number" ? data.avatar_version : 0,
      bannerVersion: typeof data.banner_version === "number" ? data.banner_version : 0,
    };
  } catch (e) {
    console.warn("[asset-resolve] user_profiles query threw:", e);
    return empty;
  }
}

/**
 * Resolve displayable URIs for both avatar and banner in parallel.
 * Uses the database as the single source of truth for storage paths,
 * then resolves each path to a displayable URL via the multi-strategy
 * resolver.  Falls back gracefully at every step.
 */
async function resolveProfileAssetUris(overrides?: {
  avatarPath?: string | null;
  bannerPath?: string | null;
  avatarVersion?: number;
  bannerVersion?: number;
}): Promise<{
  profileImageUri: string | null;
  bannerImageUri: string | null;
  profileImageStoragePath: string | null;
  bannerImageStoragePath: string | null;
  profileImageVersion: number;
  bannerImageVersion: number;
}> {
  // 1. Get storage paths — prefer overrides from bootstrap, fall back to direct DB query
  let avatarPath = overrides?.avatarPath ?? null;
  let bannerPath = overrides?.bannerPath ?? null;
  let avatarVersion = overrides?.avatarVersion ?? 0;
  let bannerVersion = overrides?.bannerVersion ?? 0;

  if (!avatarPath && !bannerPath) {
    const db = await fetchProfileAssetsFromDB();
    avatarPath = db.avatarPath;
    bannerPath = db.bannerPath;
    avatarVersion = db.avatarVersion;
    bannerVersion = db.bannerVersion;
  }

  // 2. Resolve storage paths → displayable URLs in parallel
  const [profileImageUri, bannerImageUri] = await Promise.all([
    avatarPath ? resolveStorageUrl(avatarPath) : Promise.resolve(null),
    bannerPath ? resolveStorageUrl(bannerPath) : Promise.resolve(null),
  ]);

  return {
    profileImageUri,
    bannerImageUri,
    profileImageStoragePath: avatarPath,
    bannerImageStoragePath: bannerPath,
    profileImageVersion: avatarVersion,
    bannerImageVersion: bannerVersion,
  };
}

// ---------------------------------------------------------------------------

async function fetchRemoteBootstrap(): Promise<RemoteBootstrap> {
  const { data, error } = await supabase.rpc("get_my_streambox_bootstrap");
  if (error) {
    throw error;
  }

  return isRecord(data) ? (data as RemoteBootstrap) : {};
}

async function createLocalSnapshotFromRemote(remote: RemoteBootstrap, baseSettings: PersistedSettings): Promise<LocalUserSnapshot> {
  // Extract any asset hints the bootstrap RPC might return (camelCase or snake_case)
  const rp = remote.profile as Record<string, unknown> | undefined;
  const rpcAvatarPath = (rp?.avatarPath ?? rp?.avatar_path ?? null) as string | null;
  const rpcBannerPath = (rp?.bannerPath ?? rp?.banner_path ?? null) as string | null;
  const rpcAvatarVersion = (typeof rp?.avatarVersion === "number" ? rp.avatarVersion
    : typeof rp?.avatar_version === "number" ? rp.avatar_version : null) as number | null;
  const rpcBannerVersion = (typeof rp?.bannerVersion === "number" ? rp.bannerVersion
    : typeof rp?.banner_version === "number" ? rp.banner_version : null) as number | null;

  // Resolve asset URIs (uses DB as source of truth, multi-strategy URL resolution)
  const needsAvatarResolve = !isLocalFileUri(baseSettings.profileImageUri);
  const needsBannerResolve = !isLocalFileUri(baseSettings.bannerImageUri);
  const assets = needsAvatarResolve || needsBannerResolve
    ? await resolveProfileAssetUris({
        avatarPath: rpcAvatarPath,
        bannerPath: rpcBannerPath,
        avatarVersion: rpcAvatarVersion ?? undefined,
        bannerVersion: rpcBannerVersion ?? undefined,
      })
    : null;

  const nextSettings: PersistedSettings = normalizeSettings(
    {
      ...baseSettings,
      themeId: resolveThemeId(remote.settings?.themeId),
      profileName: typeof remote.profile?.displayName === "string" && remote.profile.displayName.trim().length > 0
        ? remote.profile.displayName.trim()
        : baseSettings.profileName,
      profileBio: typeof remote.profile?.bio === "string" ? remote.profile.bio : baseSettings.profileBio,
      profileLocation: typeof remote.profile?.location === "string" ? remote.profile.location : baseSettings.profileLocation,
      profileBirthday:
        typeof remote.profile?.birthday === "string" ? formatBirthdayForLocal(remote.profile.birthday) : baseSettings.profileBirthday,
      joinedDate: typeof remote.profile?.joinedAt === "string" ? remote.profile.joinedAt : baseSettings.joinedDate,
      profileImageStoragePath: assets?.profileImageStoragePath ?? baseSettings.profileImageStoragePath,
      bannerImageStoragePath: assets?.bannerImageStoragePath ?? baseSettings.bannerImageStoragePath,
      profileImageVersion: assets?.profileImageVersion ?? baseSettings.profileImageVersion,
      bannerImageVersion: assets?.bannerImageVersion ?? baseSettings.bannerImageVersion,
      profileImageUri: baseSettings.profileImageUri,
      bannerImageUri: baseSettings.bannerImageUri,
    },
    DEFAULT_THEME_ID
  );

  // Apply resolved remote URIs — local file:// URIs always win over remote
  if (assets) {
    if (assets.profileImageUri && !isLocalFileUri(baseSettings.profileImageUri)) {
      nextSettings.profileImageUri = assets.profileImageUri;
    }
    if (assets.bannerImageUri && !isLocalFileUri(baseSettings.bannerImageUri)) {
      nextSettings.bannerImageUri = assets.bannerImageUri;
    }
  }

  const watchlistEntries = Array.isArray(remote.watchlist) ? remote.watchlist : [];
  const likedEntries = Array.isArray(remote.liked) ? remote.liked : [];
  const recentlyViewedEntries = Array.isArray(remote.recentlyViewed) ? remote.recentlyViewed : [];
  const watchHistoryEntries = Array.isArray(remote.watchHistory) ? remote.watchHistory : [];
  const episodeProgressEntries = Array.isArray(remote.episodeProgress) ? remote.episodeProgress : [];
  const dailyRecommendations = Array.isArray(remote.dailyRecommendations) ? remote.dailyRecommendations : [];
  const movieOfDayState = convertRemoteDailyRecommendations(dailyRecommendations);

  return {
    settings: nextSettings,
    movieWatchlist: watchlistEntries.filter((entry) => coerceMediaType(entry.mediaType) === "movie").map((entry) => entry.tmdbId),
    seriesWatchlist: watchlistEntries.filter((entry) => coerceMediaType(entry.mediaType) === "tv").map((entry) => entry.tmdbId),
    likedMovies: likedEntries.filter((entry) => coerceMediaType(entry.mediaType) === "movie").map((entry) => entry.tmdbId),
    likedSeries: likedEntries.filter((entry) => coerceMediaType(entry.mediaType) === "tv").map((entry) => entry.tmdbId),
    watchHistory: convertRemoteWatchHistory(watchHistoryEntries),
    recentlyViewed: recentlyViewedEntries
      .map((entry) => ({
        id: entry.tmdbId,
        mediaType: coerceMediaType(entry.mediaType),
        timestamp: Date.parse(entry.collectedAt) || Date.now(),
      }))
      .filter((entry) => entry.id > 0),
    watchedEpisodes: convertRemoteEpisodeProgress(episodeProgressEntries),
    movieOfDayCurrent: movieOfDayState.current,
    movieOfDayHistory: movieOfDayState.history,
  };
}

async function mergeInitialSnapshot(localSnapshot: LocalUserSnapshot, remoteBootstrap: RemoteBootstrap) {
  const remoteSnapshot = await createLocalSnapshotFromRemote(remoteBootstrap, localSnapshot.settings);

  return {
    settings: normalizeSettings(
      {
        ...remoteSnapshot.settings,
        themeId: typeof remoteBootstrap.settings?.themeId === "string"
          ? resolveThemeId(remoteBootstrap.settings.themeId)
          : localSnapshot.settings.themeId,
        profileName:
          typeof remoteBootstrap.profile?.displayName === "string" && remoteBootstrap.profile.displayName.trim().length > 0
            ? remoteSnapshot.settings.profileName
            : localSnapshot.settings.profileName,
        profileBio: typeof remoteBootstrap.profile?.bio === "string" ? remoteSnapshot.settings.profileBio : localSnapshot.settings.profileBio,
        profileLocation:
          typeof remoteBootstrap.profile?.location === "string"
            ? remoteSnapshot.settings.profileLocation
            : localSnapshot.settings.profileLocation,
        profileBirthday:
          typeof remoteBootstrap.profile?.birthday === "string"
            ? remoteSnapshot.settings.profileBirthday
            : localSnapshot.settings.profileBirthday,
        joinedDate:
          typeof remoteBootstrap.profile?.joinedAt === "string"
            ? remoteSnapshot.settings.joinedDate
            : localSnapshot.settings.joinedDate,
        profileImageUri:
          typeof remoteBootstrap.profile?.avatarPath === "string"
            ? remoteSnapshot.settings.profileImageUri
            : localSnapshot.settings.profileImageUri,
        bannerImageUri:
          typeof remoteBootstrap.profile?.bannerPath === "string"
            ? remoteSnapshot.settings.bannerImageUri
            : localSnapshot.settings.bannerImageUri,
        profileImageStoragePath:
          typeof remoteBootstrap.profile?.avatarPath === "string"
            ? remoteSnapshot.settings.profileImageStoragePath
            : localSnapshot.settings.profileImageStoragePath,
        bannerImageStoragePath:
          typeof remoteBootstrap.profile?.bannerPath === "string"
            ? remoteSnapshot.settings.bannerImageStoragePath
            : localSnapshot.settings.bannerImageStoragePath,
        profileImageVersion:
          typeof remoteBootstrap.profile?.avatarVersion === "number"
            ? remoteSnapshot.settings.profileImageVersion
            : localSnapshot.settings.profileImageVersion,
        bannerImageVersion:
          typeof remoteBootstrap.profile?.bannerVersion === "number"
            ? remoteSnapshot.settings.bannerImageVersion
            : localSnapshot.settings.bannerImageVersion,
      },
      DEFAULT_THEME_ID
    ),
    movieWatchlist: unionIds(remoteSnapshot.movieWatchlist, localSnapshot.movieWatchlist),
    seriesWatchlist: unionIds(remoteSnapshot.seriesWatchlist, localSnapshot.seriesWatchlist),
    likedMovies: unionIds(remoteSnapshot.likedMovies, localSnapshot.likedMovies),
    likedSeries: unionIds(remoteSnapshot.likedSeries, localSnapshot.likedSeries),
    watchHistory: mergeWatchHistoryEntries(remoteSnapshot.watchHistory, localSnapshot.watchHistory),
    recentlyViewed: mergeRecentlyViewedEntries(remoteSnapshot.recentlyViewed, localSnapshot.recentlyViewed),
    watchedEpisodes: mergeWatchedEpisodeMaps(remoteSnapshot.watchedEpisodes, localSnapshot.watchedEpisodes),
    movieOfDayCurrent: localSnapshot.movieOfDayCurrent?.dateKey === getTodayDateKey()
      ? localSnapshot.movieOfDayCurrent
      : remoteSnapshot.movieOfDayCurrent,
    movieOfDayHistory: {
      tmdbIds: unionIds(remoteSnapshot.movieOfDayHistory.tmdbIds, localSnapshot.movieOfDayHistory.tmdbIds),
      imdbIds: Array.from(
        new Set([
          ...remoteSnapshot.movieOfDayHistory.imdbIds.filter((value) => value.trim().length > 0),
          ...localSnapshot.movieOfDayHistory.imdbIds.filter((value) => value.trim().length > 0),
        ])
      ),
    },
  } satisfies LocalUserSnapshot;
}

function buildProfilePayload(settings: PersistedSettings) {
  return {
    displayName: settings.profileName,
    bio: settings.profileBio,
    location: settings.profileLocation,
    birthday: formatBirthdayForDatabase(settings.profileBirthday),
    joinedAt: settings.joinedDate || new Date().toISOString(),
    avatarPath: settings.profileImageStoragePath,
    bannerPath: settings.bannerImageStoragePath,
    avatarVersion: settings.profileImageVersion,
    bannerVersion: settings.bannerImageVersion,
  };
}

function buildSettingsPayload(settings: PersistedSettings) {
  return {
    themeId: settings.themeId,
    preferences: {},
  };
}

function buildDailyRecommendationRows(snapshot: LocalUserSnapshot) {
  const rows: Array<Record<string, unknown>> = [];
  if (snapshot.movieOfDayCurrent?.movie && typeof snapshot.movieOfDayCurrent.movie.id === "number") {
    rows.push({
      recommendation_kind: MOVIE_OF_DAY_KIND,
      recommendation_date: snapshot.movieOfDayCurrent.dateKey,
      media_type: "movie",
      tmdb_id: snapshot.movieOfDayCurrent.movie.id,
      imdb_id: typeof snapshot.movieOfDayCurrent.movie.imdbId === "string" ? snapshot.movieOfDayCurrent.movie.imdbId : null,
      strategy: "local_bootstrap",
      snapshot: {
        movie: snapshot.movieOfDayCurrent.movie,
      },
    });
  }

  snapshot.movieOfDayHistory.tmdbIds.forEach((tmdbId, index) => {
    if (tmdbId <= 0) {
      return;
    }

    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - (index + 1));
    rows.push({
      recommendation_kind: MOVIE_OF_DAY_HISTORY_KIND,
      recommendation_date: getTodayDateKey(baseDate),
      media_type: "movie",
      tmdb_id: tmdbId,
      imdb_id: snapshot.movieOfDayHistory.imdbIds[index] ?? null,
      strategy: "legacy_history_import",
      snapshot: {},
    });
  });

  return rows;
}

async function backfillSnapshotToRemote(userId: string, snapshot: LocalUserSnapshot) {
  const profileRow = {
    id: userId,
    display_name: snapshot.settings.profileName,
    bio: snapshot.settings.profileBio,
    location_text: snapshot.settings.profileLocation,
    birthday: formatBirthdayForDatabase(snapshot.settings.profileBirthday),
    joined_at: snapshot.settings.joinedDate || new Date().toISOString(),
    avatar_path: snapshot.settings.profileImageStoragePath,
    banner_path: snapshot.settings.bannerImageStoragePath,
    avatar_version: snapshot.settings.profileImageVersion,
    banner_version: snapshot.settings.bannerImageVersion,
  };
  const settingsRow = {
    user_id: userId,
    theme_id: snapshot.settings.themeId,
    preferences: {},
  };

  const now = new Date().toISOString();
  const mediaRows = [
    ...snapshot.movieWatchlist.map((tmdbId) => ({ user_id: userId, list_kind: "watchlist", media_type: "movie", tmdb_id: tmdbId, collected_at: now, snapshot: {} })),
    ...snapshot.seriesWatchlist.map((tmdbId) => ({ user_id: userId, list_kind: "watchlist", media_type: "tv", tmdb_id: tmdbId, collected_at: now, snapshot: {} })),
    ...snapshot.likedMovies.map((tmdbId) => ({ user_id: userId, list_kind: "liked", media_type: "movie", tmdb_id: tmdbId, collected_at: now, snapshot: {} })),
    ...snapshot.likedSeries.map((tmdbId) => ({ user_id: userId, list_kind: "liked", media_type: "tv", tmdb_id: tmdbId, collected_at: now, snapshot: {} })),
    ...snapshot.recentlyViewed.map((entry) => ({
      user_id: userId,
      list_kind: "recently_viewed",
      media_type: entry.mediaType,
      tmdb_id: entry.id,
      collected_at: entry.timestamp ? new Date(entry.timestamp).toISOString() : now,
      snapshot: {},
    })),
  ];

  const watchHistoryRows = snapshot.watchHistory.map((entry) => ({
    user_id: userId,
    media_type: entry.mediaType,
    tmdb_id: entry.id,
    title: entry.title,
    poster_path: entry.posterPath,
    genres: entry.genres,
    runtime_minutes: entry.runtimeMinutes,
    episode_count: entry.episodeCount,
    vote_average: entry.voteAverage,
    release_year: entry.year ? Number(entry.year) : null,
    cast_ids: entry.castIds,
    cast_names: entry.castNames,
    cast_profile_paths: entry.castProfilePaths,
    cast_genders: entry.castGenders,
    director_ids: entry.directorIds,
    director_names: entry.directorNames,
    director_profile_paths: entry.directorProfilePaths,
    watched_at: new Date(entry.watchedAt).toISOString(),
    metadata_version: entry.metadataVersion,
    snapshot: {},
  }));

  const episodeRows = Object.keys(snapshot.watchedEpisodes)
    .filter((key) => snapshot.watchedEpisodes[key] === true)
    .map((key) => key.split("_"))
    .filter((parts) => parts.length === 3)
    .map(([seriesTmdbId, seasonNumber, episodeNumber]) => ({
      user_id: userId,
      series_tmdb_id: Number(seriesTmdbId),
      season_number: Number(seasonNumber),
      episode_number: Number(episodeNumber),
      snapshot: {},
    }))
    .filter((entry) => entry.series_tmdb_id > 0 && entry.season_number > 0 && entry.episode_number > 0);

  const recommendationRows = buildDailyRecommendationRows(snapshot).map((row) => ({
    user_id: userId,
    ...row,
  }));

  const { error: profileError } = await supabase.from("user_profiles").upsert(profileRow, { onConflict: "id" });
  if (profileError) throw profileError;

  const { error: settingsError } = await supabase.from("user_settings").upsert(settingsRow, { onConflict: "user_id" });
  if (settingsError) throw settingsError;

  if (mediaRows.length > 0) {
    const { error } = await supabase.from("user_media_library").upsert(mediaRows, { onConflict: "user_id,list_kind,media_type,tmdb_id" });
    if (error) throw error;
  }

  if (watchHistoryRows.length > 0) {
    const { error } = await supabase.from("user_watch_history").upsert(watchHistoryRows, { onConflict: "user_id,media_type,tmdb_id" });
    if (error) throw error;
  }

  if (episodeRows.length > 0) {
    const { error } = await supabase.from("user_episode_progress").upsert(episodeRows, { onConflict: "user_id,series_tmdb_id,season_number,episode_number" });
    if (error) throw error;
  }

  if (recommendationRows.length > 0) {
    const { error } = await supabase.from("user_daily_recommendations").upsert(recommendationRows, { onConflict: "user_id,recommendation_kind,recommendation_date" });
    if (error) throw error;
  }
}

async function queueInitialAssetUploads(userId: string, settings: PersistedSettings) {
  const profileImageUri = settings.profileImageUri;
  if (isLocalFileUri(profileImageUri) && !settings.profileImageStoragePath) {
    await enqueuePendingOperation({
      kind: "asset_upload",
      userId,
      assetKind: "avatar",
      localUri: profileImageUri,
      previousPath: null,
      nextVersion: Math.max(settings.profileImageVersion, 0) + 1,
    });
  }

  const bannerImageUri = settings.bannerImageUri;
  if (isLocalFileUri(bannerImageUri) && !settings.bannerImageStoragePath) {
    await enqueuePendingOperation({
      kind: "asset_upload",
      userId,
      assetKind: "banner",
      localUri: bannerImageUri,
      previousPath: null,
      nextVersion: Math.max(settings.bannerImageVersion, 0) + 1,
    });
  }
}

function inferAssetExtension(uri: string) {
  const match = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const ext = match?.[1] ?? "jpg";
  if (["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    return ext;
  }
  return "jpg";
}

function inferAssetContentType(uri: string) {
  const extension = inferAssetExtension(uri);
  switch (extension) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

async function executePendingOperation(operation: PendingSyncOperation) {
  switch (operation.kind) {
    case "profile_settings": {
      const { error } = await supabase.rpc("sync_streambox_profile_and_settings", {
        profile_payload: buildProfilePayload(operation.settings),
        settings_payload: buildSettingsPayload(operation.settings),
        audit_metadata: operation.auditMetadata,
      });
      if (error) throw error;
      return;
    }
    case "asset_upload": {
      const extension = inferAssetExtension(operation.localUri);
      const folder = operation.assetKind === "avatar" ? "avatars" : "banners";
      const objectPath = `${operation.userId}/${folder}/${operation.assetKind}-${Date.now()}.${extension}`;
      const response = await fetch(operation.localUri);
      const fileBuffer = await response.arrayBuffer();
      const { error: uploadError } = await supabase.storage.from(PROFILE_ASSETS_BUCKET).upload(objectPath, fileBuffer, {
        contentType: inferAssetContentType(operation.localUri),
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const profilePayload = operation.assetKind === "avatar"
        ? { avatarPath: objectPath, avatarVersion: operation.nextVersion }
        : { bannerPath: objectPath, bannerVersion: operation.nextVersion };
      const { error: syncError } = await supabase.rpc("sync_streambox_profile_and_settings", {
        profile_payload: profilePayload,
        settings_payload: {},
        audit_metadata: {
          source: "asset_upload",
          assetKind: operation.assetKind,
        },
      });
      if (syncError) throw syncError;

      if (operation.previousPath && operation.previousPath !== objectPath) {
        await supabase.storage.from(PROFILE_ASSETS_BUCKET).remove([operation.previousPath]);
      }

      await updateLocalAssetMetadata(operation.assetKind, operation.localUri, objectPath, operation.nextVersion);
      return;
    }
    case "media_library": {
      const { error } = await supabase.rpc("sync_streambox_media_library_item", {
        p_operation: operation.operation,
        p_list_kind: operation.listKind,
        p_media_type: operation.mediaType,
        p_tmdb_id: operation.tmdbId,
        p_imdb_id: operation.imdbId,
        p_collected_at: operation.collectedAt,
        p_snapshot: operation.snapshot,
        p_audit_metadata: operation.auditMetadata,
      });
      if (error) throw error;
      return;
    }
    case "watch_history_upsert": {
      const { entry } = operation;
      const { error } = await supabase.rpc("sync_streambox_watch_history_entry", {
        p_media_type: entry.mediaType,
        p_tmdb_id: entry.id,
        p_imdb_id: operation.auditMetadata.imdbId ?? null,
        p_title: entry.title,
        p_poster_path: entry.posterPath,
        p_genres: entry.genres,
        p_runtime_minutes: entry.runtimeMinutes,
        p_episode_count: entry.episodeCount,
        p_vote_average: entry.voteAverage,
        p_release_year: entry.year ? Number(entry.year) : null,
        p_cast_ids: entry.castIds,
        p_cast_names: entry.castNames,
        p_cast_profile_paths: entry.castProfilePaths,
        p_cast_genders: entry.castGenders,
        p_director_ids: entry.directorIds,
        p_director_names: entry.directorNames,
        p_director_profile_paths: entry.directorProfilePaths,
        p_watched_at: new Date(entry.watchedAt).toISOString(),
        p_metadata_version: entry.metadataVersion,
        p_snapshot: {},
        p_audit_metadata: operation.auditMetadata,
      });
      if (error) throw error;
      return;
    }
    case "watch_history_delete": {
      const { error } = await supabase.rpc("delete_streambox_watch_history_entry", {
        p_media_type: operation.mediaType,
        p_tmdb_id: operation.tmdbId,
        p_audit_metadata: operation.auditMetadata,
      });
      if (error) throw error;
      return;
    }
    case "episode_progress": {
      const { error } = await supabase.rpc("sync_streambox_episode_progress", {
        p_series_tmdb_id: operation.seriesTmdbId,
        p_season_number: operation.seasonNumber,
        p_episode_number: operation.episodeNumber,
        p_is_watched: operation.isWatched,
        p_watched_at: operation.watchedAt,
        p_snapshot: {},
        p_audit_metadata: operation.auditMetadata,
      });
      if (error) throw error;
      return;
    }
    case "daily_recommendation": {
      const { error } = await supabase.from("user_daily_recommendations").upsert(
        {
          user_id: operation.userId,
          recommendation_kind: operation.recommendationKind,
          recommendation_date: operation.recommendationDate,
          media_type: operation.mediaType,
          tmdb_id: operation.tmdbId,
          imdb_id: operation.imdbId,
          strategy: operation.strategy,
          snapshot: operation.snapshot,
        },
        { onConflict: "user_id,recommendation_kind,recommendation_date" }
      );
      if (error) throw error;
      return;
    }
    case "auth_event": {
      const { error } = await supabase.rpc("log_streambox_user_event", {
        action_category: operation.actionCategory,
        action_type: operation.actionType,
        entity_type: operation.entityType,
        entity_key: operation.entityKey,
        metadata: operation.metadata,
      });
      if (error) throw error;
    }
  }
}


export async function clearLocalUserDataCache() {
  const keysToRemove = [
    APP_SETTINGS_STORAGE_KEY,
    WATCHLIST_STORAGE_KEY,
    SERIES_WATCHLIST_STORAGE_KEY,
    LIKED_MOVIES_STORAGE_KEY,
    LIKED_SERIES_STORAGE_KEY,
    WATCH_HISTORY_STORAGE_KEY,
    RECENTLY_WATCHED_STORAGE_KEY,
    WATCHED_EPISODES_STORAGE_KEY,
    MOVIE_OF_DAY_CURRENT_STORAGE_KEY,
    MOVIE_OF_DAY_HISTORY_STORAGE_KEY,
    ACTIVE_SYNC_USER_KEY,
  ];
  const allKeys = await AsyncStorage.getAllKeys();
  const bootstrapKeys = allKeys.filter((key) => key.startsWith(BOOTSTRAP_COMPLETE_KEY_PREFIX));
  await AsyncStorage.multiRemove([...keysToRemove, ...bootstrapKeys]);
}
export async function flushSupabaseUserDataSync(targetUserId?: string) {
  if (flushPromise) {
    await flushPromise;
    return;
  }

  flushPromise = (async () => {
    const activeUserId = targetUserId ?? (await getCurrentUserId());
    if (!activeUserId) {
      return;
    }

    const queue = await readPendingQueue();
    if (queue.length === 0) {
      return;
    }

    const retainedQueue = queue.filter((entry) => entry.userId !== activeUserId);
    const activeQueue = queue.filter((entry) => entry.userId === activeUserId);
    const failedQueue: PendingSyncOperation[] = [];

    for (const operation of activeQueue) {
      try {
        await executePendingOperation(operation);
      } catch (error) {
        console.warn("Supabase sync operation failed", error);
        failedQueue.push(operation);
      }
    }

    await writePendingQueue([...retainedQueue, ...failedQueue]);
  })().finally(() => {
    flushPromise = null;
  });

  await flushPromise;
}

export async function bootstrapSupabaseUserData() {
  const userId = await getCurrentUserId();
  if (!userId) {
    console.warn("[bootstrap] no userId — skipping");
    return;
  }

  const previousUserId = await AsyncStorage.getItem(ACTIVE_SYNC_USER_KEY);
  const localSnapshot = await readLocalUserSnapshot();
  const bootstrapComplete = (await AsyncStorage.getItem(getBootstrapCompleteKey(userId))) === "1";

  console.log("[bootstrap] userId:", userId, "previousUserId:", previousUserId, "bootstrapComplete:", bootstrapComplete);

  if (bootstrapComplete && previousUserId === userId) {
    console.log("[bootstrap] fast path — flush only");
    await flushSupabaseUserDataSync(userId);
    await AsyncStorage.setItem(ACTIVE_SYNC_USER_KEY, userId);
    // Fast path still needs to ensure profile assets are resolved
    const settings = localSnapshot.settings;
    if (!isLocalFileUri(settings.profileImageUri) || !isLocalFileUri(settings.bannerImageUri)) {
        console.log("[bootstrap] fast path — resolving remote assets");
        const assets = await resolveProfileAssetUris({
          avatarPath: settings.profileImageStoragePath,
          bannerPath: settings.bannerImageStoragePath,
          avatarVersion: settings.profileImageVersion,
          bannerVersion: settings.bannerImageVersion,
        });
        let changed = false;
        if (assets.profileImageUri && !isLocalFileUri(settings.profileImageUri)) {
          settings.profileImageUri = assets.profileImageUri;
          settings.profileImageStoragePath = assets.profileImageStoragePath;
          changed = true;
        }
        if (assets.bannerImageUri && !isLocalFileUri(settings.bannerImageUri)) {
          settings.bannerImageUri = assets.bannerImageUri;
          settings.bannerImageStoragePath = assets.bannerImageStoragePath;
          changed = true;
        }
        if (changed) {
          await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        }
      }
      return;
    }
  let remoteBootstrap: RemoteBootstrap;
  try {
    remoteBootstrap = await fetchRemoteBootstrap();
    console.log("[bootstrap] RPC returned profile keys:", remote_profile_keys(remoteBootstrap));
  } catch (error) {
    console.warn("[bootstrap] RPC failed:", error);
    // RPC failed — still try to resolve assets directly from DB
    console.log("[bootstrap] attempting direct asset resolution despite RPC failure");
    const assets = await resolveProfileAssetUris();
    if (assets.profileImageUri || assets.bannerImageUri) {
      const settings = localSnapshot.settings;
      if (assets.profileImageUri) settings.profileImageUri = assets.profileImageUri;
      if (assets.bannerImageUri) settings.bannerImageUri = assets.bannerImageUri;
      if (assets.profileImageStoragePath) settings.profileImageStoragePath = assets.profileImageStoragePath;
      if (assets.bannerImageStoragePath) settings.bannerImageStoragePath = assets.bannerImageStoragePath;
      settings.profileImageVersion = assets.profileImageVersion;
      settings.bannerImageVersion = assets.bannerImageVersion;
      await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }

    if (previousUserId && previousUserId !== userId) {
      await clearLocalUserDataCache();
      await writeLocalUserSnapshot({
        settings: createDefaultSettings(DEFAULT_THEME_ID),
        movieWatchlist: [],
        seriesWatchlist: [],
        likedMovies: [],
        likedSeries: [],
        watchHistory: [],
        recentlyViewed: [],
        watchedEpisodes: {},
        movieOfDayCurrent: null,
        movieOfDayHistory: { tmdbIds: [], imdbIds: [] },
      });
    }
    await AsyncStorage.setItem(ACTIVE_SYNC_USER_KEY, userId);
    return;
  }

  const canMergeLocal = !bootstrapComplete && (!previousUserId || previousUserId === userId);
  console.log("[bootstrap] canMergeLocal:", canMergeLocal);

  if (canMergeLocal) {
    const mergedSnapshot = await mergeInitialSnapshot(localSnapshot, remoteBootstrap);
    await writeLocalUserSnapshot(mergedSnapshot);
    await backfillSnapshotToRemote(userId, mergedSnapshot);
    await queueInitialAssetUploads(userId, mergedSnapshot.settings);
    await flushSupabaseUserDataSync(userId);

    const queueAfterBootstrap = await readPendingQueue();
    if (!queueAfterBootstrap.some((entry) => entry.userId === userId)) {
      const refreshedBootstrap = await fetchRemoteBootstrap().catch(() => remoteBootstrap);
      const canonicalSnapshot = await createLocalSnapshotFromRemote(refreshedBootstrap, mergedSnapshot.settings);
      await writeLocalUserSnapshot(canonicalSnapshot);
    }
  } else {
    console.log("[bootstrap] else branch — full remote restore");
    const baseSettings = previousUserId === userId ? localSnapshot.settings : createDefaultSettings(DEFAULT_THEME_ID);
    const remoteSnapshot = await createLocalSnapshotFromRemote(remoteBootstrap, baseSettings);
    console.log("[bootstrap] resolved profileImageUri:", remoteSnapshot.settings.profileImageUri ? "SET" : "NULL");
    console.log("[bootstrap] resolved bannerImageUri:", remoteSnapshot.settings.bannerImageUri ? "SET" : "NULL");
    await writeLocalUserSnapshot(remoteSnapshot);
  }

  await AsyncStorage.setItem(ACTIVE_SYNC_USER_KEY, userId);
  await AsyncStorage.setItem(getBootstrapCompleteKey(userId), "1");
}

/** Helper to log which keys the RPC returned for the profile object */
function remote_profile_keys(bootstrap: RemoteBootstrap): string {
  if (!bootstrap.profile) return "(no profile)";
  return Object.keys(bootstrap.profile).join(", ");
}

export async function enqueueProfileSettingsSync(settings: PersistedSettings, auditMetadata: SyncMetadata = {}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  await enqueuePendingOperation({
    kind: "profile_settings",
    userId,
    settings,
    auditMetadata: normalizeSyncMetadata(auditMetadata),
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueProfileAssetSync(
  assetKind: SyncAssetKind,
  localUri: string | null,
  previousPath: string | null,
  currentVersion: number
) {
  const userId = await getCurrentUserId();
  if (!userId || !localUri || !isLocalFileUri(localUri)) {
    return;
  }

  await enqueuePendingOperation({
    kind: "asset_upload",
    userId,
    assetKind,
    localUri,
    previousPath,
    nextVersion: Math.max(currentVersion, 0) + 1,
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueMediaLibrarySync(
  input: {
    operation: "upsert" | "delete";
    listKind: SyncListKind;
    mediaType: MediaType;
    tmdbId: number;
    details?: UserMediaSyncDetails | null;
    occurredAt?: string;
  }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  const metadata = normalizeSyncMetadata({
    title: input.details?.title,
    imdbId: input.details?.imdbId,
    posterPath: input.details?.posterPath,
    year: input.details?.year,
  });

  await enqueuePendingOperation({
    kind: "media_library",
    userId,
    operation: input.operation,
    listKind: input.listKind,
    mediaType: input.mediaType,
    tmdbId: input.tmdbId,
    imdbId: input.details?.imdbId ?? null,
    collectedAt: input.occurredAt ?? new Date().toISOString(),
    snapshot: normalizeMediaSnapshot(input.details),
    auditMetadata: metadata,
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueWatchHistoryUpsert(entry: WatchHistoryEntry, auditMetadata: SyncMetadata = {}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  await enqueuePendingOperation({
    kind: "watch_history_upsert",
    userId,
    entry,
    auditMetadata: normalizeSyncMetadata(auditMetadata),
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueWatchHistoryDelete(
  mediaType: MediaType,
  tmdbId: number,
  auditMetadata: SyncMetadata = {}
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  await enqueuePendingOperation({
    kind: "watch_history_delete",
    userId,
    mediaType,
    tmdbId,
    auditMetadata: normalizeSyncMetadata(auditMetadata),
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueEpisodeProgressSync(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  isWatched: boolean,
  auditMetadata: SyncMetadata = {}
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  await enqueuePendingOperation({
    kind: "episode_progress",
    userId,
    seriesTmdbId,
    seasonNumber,
    episodeNumber,
    isWatched,
    watchedAt: new Date().toISOString(),
    auditMetadata: normalizeSyncMetadata(auditMetadata),
  });
  void flushSupabaseUserDataSync(userId);
}

export async function enqueueDailyRecommendationSync(movie: Record<string, unknown> | null, dateKey: string) {
  const userId = await getCurrentUserId();
  if (!userId || !movie || typeof movie.id !== "number") {
    return;
  }

  await enqueuePendingOperation({
    kind: "daily_recommendation",
    userId,
    recommendationKind: MOVIE_OF_DAY_KIND,
    recommendationDate: dateKey,
    mediaType: "movie",
    tmdbId: movie.id,
    imdbId: typeof movie.imdbId === "string" ? movie.imdbId : null,
    strategy: "device_generated",
    snapshot: { movie },
  });
  void flushSupabaseUserDataSync(userId);
}

export async function logSupabaseUserEvent(
  actionCategory: string,
  actionType: string,
  metadata: SyncMetadata = {},
  options?: {
    entityType?: string | null;
    entityKey?: string | null;
    flushImmediately?: boolean;
  }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return;
  }

  await enqueuePendingOperation({
    kind: "auth_event",
    userId,
    actionCategory,
    actionType,
    entityType: options?.entityType ?? null,
    entityKey: options?.entityKey ?? null,
    metadata: normalizeSyncMetadata(metadata),
    createdAt: new Date().toISOString(),
  });

  if (options?.flushImmediately) {
    await flushSupabaseUserDataSync(userId);
    return;
  }

  void flushSupabaseUserDataSync(userId);
}





