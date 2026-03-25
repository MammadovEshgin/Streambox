import AsyncStorage from "@react-native-async-storage/async-storage";

import { AZ_CLASSICS_CACHE_KEY } from "../api/azClassics";
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
import { clearAzClassicImageCache } from "./azClassicImageCache";
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

function getSyncIds(id: string | number | null | undefined) {
  if (id === undefined || id === null) return { tmdb_id: null, internal_id: null };
  const sId = String(id).trim();
  if (sId.length === 0) return { tmdb_id: null, internal_id: null };
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sId);
  if (isUUID) return { tmdb_id: null, internal_id: sId };
  if (/^\d+$/.test(sId)) {
    const numId = parseInt(sId, 10);
    if (!isNaN(numId) && numId > 0) return { tmdb_id: numId, internal_id: null };
  }
  return { tmdb_id: null, internal_id: null };
}

type RecentlyWatchedEntry = { id: number | string; mediaType: MediaType; timestamp: number };
type MovieOfDayCurrent = { dateKey: string; movie: Record<string, unknown> | null };
type MovieOfDayHistory = { tmdbIds: (number | string)[]; imdbIds: string[] };

type LocalUserSnapshot = {
  settings: PersistedSettings;
  movieWatchlist: (number | string)[];
  seriesWatchlist: (number | string)[];
  likedMovies: (number | string)[];
  likedSeries: (number | string)[];
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
  tmdbId: number | string | null;
  imdbId: string | null;
  strategy: string | null;
  snapshot: SyncMetadata;
  updatedAt?: string;
};

type RemoteBootstrap = {
  profile?: {
    displayName?: string; bio?: string; location?: string; birthday?: string | null; joinedAt?: string;
    avatarPath?: string | null; bannerPath?: string | null; avatarVersion?: number; bannerVersion?: number;
  };
  settings?: { themeId?: string; onboardingCompletedAt?: string | null; preferences?: SyncMetadata; };
  watchlist?: RemoteMediaLibraryEntry[];
  liked?: RemoteMediaLibraryEntry[];
  recentlyViewed?: RemoteMediaLibraryEntry[];
  watchHistory?: RemoteWatchHistoryEntry[];
  episodeProgress?: RemoteEpisodeProgressEntry[];
  dailyRecommendations?: RemoteDailyRecommendationEntry[];
};

type QueuedProfileSettingsOperation = { kind: "profile_settings"; userId: string; settings: PersistedSettings; auditMetadata: SyncMetadata; };
type QueuedAssetUploadOperation = { kind: "asset_upload"; userId: string; assetKind: SyncAssetKind; localUri: string; previousPath: string | null; nextVersion: number; };
type QueuedMediaLibraryOperation = { kind: "media_library"; userId: string; operation: "upsert" | "delete"; listKind: SyncListKind; mediaType: MediaType; tmdbId: number | string; imdbId: string | null; collectedAt: string; snapshot: SyncMetadata; auditMetadata: SyncMetadata; };
type QueuedWatchHistoryUpsertOperation = { kind: "watch_history_upsert"; userId: string; entry: WatchHistoryEntry; auditMetadata: SyncMetadata; };
type QueuedWatchHistoryDeleteOperation = { kind: "watch_history_delete"; userId: string; mediaType: MediaType; tmdbId: number | string; auditMetadata: SyncMetadata; };
type QueuedEpisodeProgressOperation = { kind: "episode_progress"; userId: string; seriesTmdbId: number; seasonNumber: number; episodeNumber: number; isWatched: boolean; watchedAt: string; auditMetadata: SyncMetadata; };
type QueuedDailyRecommendationOperation = { kind: "daily_recommendation"; userId: string; recommendationKind: string; recommendationDate: string; mediaType: MediaType; tmdbId: number | null; imdbId: string | null; strategy: string | null; snapshot: SyncMetadata; };
type QueuedAuthEventOperation = { kind: "auth_event"; userId: string; actionCategory: string; actionType: string; entityType: string | null; entityKey: string | null; metadata: SyncMetadata; createdAt: string; };

type PendingSyncOperation =
  | QueuedProfileSettingsOperation | QueuedAssetUploadOperation | QueuedMediaLibraryOperation
  | QueuedWatchHistoryUpsertOperation | QueuedWatchHistoryDeleteOperation | QueuedEpisodeProgressOperation
  | QueuedDailyRecommendationOperation | QueuedAuthEventOperation;

export type UserMediaSyncDetails = { title?: string; imdbId?: string | null; posterPath?: string | null; year?: string | null; overview?: string | null; };

let flushPromise: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function resolveThemeId(value: unknown): ThemeId { return typeof value === "string" && VALID_THEME_IDS.has(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME_ID; }
function coerceMediaType(value: unknown): MediaType { return value === "tv" ? "tv" : "movie"; }
function coerceStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function coerceNumberArray(value: unknown): number[] { return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : []; }
function isLocalFileUri(uri: string | null | undefined): uri is string { return typeof uri === "string" && uri.startsWith("file://"); }
function normalizeSyncMetadata(value: SyncMetadata | null | undefined): SyncMetadata { return isRecord(value) ? value : {}; }

function normalizeMediaSnapshot(details?: UserMediaSyncDetails | null): SyncMetadata {
  if (!details) return {};
  const snapshot: SyncMetadata = {};
  if (details.title) snapshot.title = details.title;
  if (details.imdbId) snapshot.imdbId = details.imdbId;
  if (details.posterPath) snapshot.posterPath = details.posterPath;
  if (details.year) snapshot.year = details.year;
  if (details.overview) snapshot.overview = details.overview;
  return snapshot;
}

function sanitizeParallelArray<T>(values: T[] | null | undefined, targetLength: number): T[] {
  if (!Array.isArray(values) || targetLength <= 0) return [];
  return values.slice(0, targetLength);
}

function buildWatchHistorySyncArrays(entry: WatchHistoryEntry) {
  const castIds = Array.isArray(entry.castIds) ? entry.castIds : [];
  const directorIds = Array.isArray(entry.directorIds) ? entry.directorIds : [];
  return {
    castIds,
    castNames: sanitizeParallelArray(entry.castNames, castIds.length),
    castProfilePaths: sanitizeParallelArray(entry.castProfilePaths, castIds.length),
    castGenders: sanitizeParallelArray(entry.castGenders, castIds.length),
    directorIds,
    directorNames: sanitizeParallelArray(entry.directorNames, directorIds.length),
    directorProfilePaths: sanitizeParallelArray(entry.directorProfilePaths, directorIds.length),
  };
}

function formatBirthdayForDatabase(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;
  const day = Number(parts[0]); const month = Number(parts[1]); const year = Number(parts[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatBirthdayForLocal(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return "";
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function getEpisodeKey(seriesTmdbId: number, seasonNumber: number, episodeNumber: number) { return `${seriesTmdbId}_${seasonNumber}_${episodeNumber}`; }
function getBootstrapCompleteKey(userId: string) { return `${BOOTSTRAP_COMPLETE_KEY_PREFIX}${userId}`; }
function getTodayDateKey(now: Date = new Date()) {
  const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, "0"); const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePersistedSettings(raw: string | null): PersistedSettings {
  if (!raw) return createDefaultSettings(DEFAULT_THEME_ID);
  try { return normalizeSettings(JSON.parse(raw) as Partial<PersistedSettings>, DEFAULT_THEME_ID); } catch { return createDefaultSettings(DEFAULT_THEME_ID); }
}

function normalizeIdList(raw: string | null): (number | string)[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is number | string => (typeof entry === "number" && Number.isFinite(entry)) || (typeof entry === "string" && entry.trim().length > 0 && entry !== "null" && entry !== "undefined"));
  } catch { return []; }
}

function normalizeWatchHistory(raw: string | null): WatchHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).map((entry) => ({
      id: (typeof entry.id === "number" || typeof entry.id === "string") ? entry.id : 0,
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
      castProfilePaths: Array.isArray(entry.castProfilePaths) ? entry.castProfilePaths.map(v => typeof v === "string" ? v : null) : [],
      castGenders: Array.isArray(entry.castGenders) ? entry.castGenders.filter(v => v === "male" || v === "female") : [],
      directorIds: coerceNumberArray(entry.directorIds),
      directorNames: coerceStringArray(entry.directorNames),
      directorProfilePaths: Array.isArray(entry.directorProfilePaths) ? entry.directorProfilePaths.map(v => typeof v === "string" ? v : null) : [],
      watchedAt: typeof entry.watchedAt === "number" ? entry.watchedAt : Date.now(),
      metadataVersion: typeof entry.metadataVersion === "number" ? entry.metadataVersion : 1,
    })).filter(entry => (typeof entry.id === "string" ? entry.id.length > 0 : entry.id > 0) && entry.title.trim().length > 0);
  } catch { return []; }
}

function normalizeRecentlyViewed(raw: string | null): RecentlyWatchedEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).map(entry => ({
      id: (typeof entry.id === "number" || typeof entry.id === "string") ? entry.id : 0,
      mediaType: coerceMediaType(entry.mediaType),
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    })).filter(entry => typeof entry.id === "number" ? entry.id > 0 : (typeof entry.id === "string" && entry.id.trim().length > 0 && entry.id !== "null"))
    .sort((a,b) => b.timestamp - a.timestamp).slice(0, MAX_RECENTLY_VIEWED);
  } catch { return []; }
}

function normalizeWatchedEpisodes(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw); if (!isRecord(parsed)) return {};
    return Object.entries(parsed).reduce((acc, [k,v]) => { if (v === true) acc[k] = true; return acc; }, {} as Record<string, boolean>);
  } catch { return {}; }
}

function normalizeMovieOfDayCurrent(raw: string | null): MovieOfDayCurrent | null {
  if (!raw) return null;
  try { const parsed = JSON.parse(raw); if (!isRecord(parsed) || typeof parsed.dateKey !== "string") return null; return { dateKey: parsed.dateKey, movie: isRecord(parsed.movie) ? parsed.movie : null }; } catch { return null; }
}

function normalizeMovieOfDayHistory(raw: string | null): MovieOfDayHistory {
  if (!raw) return { tmdbIds: [], imdbIds: [] };
  try {
    const parsed = JSON.parse(raw); if (!isRecord(parsed)) return { tmdbIds: [], imdbIds: [] };
    return { tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds : [], imdbIds: Array.isArray(parsed.imdbIds) ? parsed.imdbIds.filter(v => typeof v === "string") : [] };
  } catch { return { tmdbIds: [], imdbIds: [] }; }
}

async function readLocalUserSnapshot(): Promise<LocalUserSnapshot> {
  const entries = await AsyncStorage.multiGet([APP_SETTINGS_STORAGE_KEY, WATCHLIST_STORAGE_KEY, SERIES_WATCHLIST_STORAGE_KEY, LIKED_MOVIES_STORAGE_KEY, LIKED_SERIES_STORAGE_KEY, WATCH_HISTORY_STORAGE_KEY, RECENTLY_WATCHED_STORAGE_KEY, WATCHED_EPISODES_STORAGE_KEY, MOVIE_OF_DAY_CURRENT_STORAGE_KEY, MOVIE_OF_DAY_HISTORY_STORAGE_KEY]);
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
  const pairs: Array<[string, string]> = [
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
  if (snapshot.movieOfDayCurrent) pairs.push([MOVIE_OF_DAY_CURRENT_STORAGE_KEY, JSON.stringify(snapshot.movieOfDayCurrent)]);
  await AsyncStorage.multiSet(pairs);
  if (!snapshot.movieOfDayCurrent) await AsyncStorage.removeItem(MOVIE_OF_DAY_CURRENT_STORAGE_KEY);
}

async function updateLocalAssetMetadata(assetKind: SyncAssetKind, nextUri: string | null, nextPath: string | null, nextVersion: number) {
  const raw = await AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  const current = normalizePersistedSettings(raw);
  const nextSettings: PersistedSettings = { 
    ...current, 
    ...(assetKind === "avatar" 
      ? { profileImageUri: nextUri, profileImageStoragePath: nextPath, profileImageVersion: nextVersion } 
      : { bannerImageUri: nextUri, bannerImageStoragePath: nextPath, bannerImageVersion: nextVersion })
  };
  await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
}

async function getCurrentUserId() { const { data: { session } } = await supabase.auth.getSession(); return session?.user.id ?? null; }
async function readPendingQueue(): Promise<PendingSyncOperation[]> { try { const raw = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; } }
async function writePendingQueue(queue: PendingSyncOperation[]) { if (queue.length === 0) await AsyncStorage.removeItem(SYNC_QUEUE_STORAGE_KEY); else await AsyncStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(queue)); }

function getQueueOperationKey(op: PendingSyncOperation): string | null {
  switch (op.kind) {
    case "profile_settings": return `${op.userId}:profile_settings`;
    case "asset_upload": return `${op.userId}:asset:${op.assetKind}`;
    case "media_library": return `${op.userId}:media:${op.listKind}:${op.mediaType}:${op.tmdbId}`;
    case "watch_history_upsert": return `${op.userId}:watch_history:${op.entry.mediaType}:${op.entry.id}`;
    case "watch_history_delete": return `${op.userId}:watch_history:${op.mediaType}:${op.tmdbId}`;
    case "episode_progress": return `${op.userId}:episode:${op.seriesTmdbId}:${op.seasonNumber}:${op.episodeNumber}`;
    case "daily_recommendation": return `${op.userId}:daily:${op.recommendationKind}:${op.recommendationDate}`;
    default: return null;
  }
}

async function enqueuePendingOperation(op: PendingSyncOperation) {
  const queue = await readPendingQueue();
  const key = getQueueOperationKey(op);
  if (!key) { queue.push(op); await writePendingQueue(queue); return; }
  const idx = queue.findIndex(q => getQueueOperationKey(q) === key);
  if (idx >= 0) queue[idx] = op; else queue.push(op);
  await writePendingQueue(queue);
}

function unionIds(p: (number | string)[], s: (number | string)[]) { return Array.from(new Set([...p, ...s])); }

function mergeWatchHistoryEntries(p: WatchHistoryEntry[], s: WatchHistoryEntry[]) {
  const m = new Map<string, WatchHistoryEntry>();
  [...p, ...s].forEach(e => {
    const k = `${e.mediaType}:${e.id}`; const ex = m.get(k);
    if (!ex || e.watchedAt > ex.watchedAt || e.metadataVersion > ex.metadataVersion) m.set(k, e);
  });
  return [...m.values()].sort((a,b) => b.watchedAt - a.watchedAt);
}

function mergeRecentlyViewedEntries(p: RecentlyWatchedEntry[], s: RecentlyWatchedEntry[]) {
  const m = new Map<string, RecentlyWatchedEntry>();
  [...p, ...s].forEach(e => { const k = `${e.mediaType}:${e.id}`; const ex = m.get(k); if (!ex || e.timestamp > ex.timestamp) m.set(k, e); });
  return [...m.values()].sort((a,b) => b.timestamp - a.timestamp).slice(0, MAX_RECENTLY_VIEWED);
}

function convertRemoteWatchHistory(entries: RemoteWatchHistoryEntry[]): WatchHistoryEntry[] {
  return entries.filter(e => e.tmdbId > 0 && e.title.trim().length > 0).map(e => ({
    id: e.tmdbId, mediaType: coerceMediaType(e.mediaType), title: e.title, posterPath: e.posterPath ?? null, genres: coerceStringArray(e.genres),
    runtimeMinutes: e.runtimeMinutes, episodeCount: e.episodeCount, voteAverage: e.voteAverage, year: e.releaseYear ? String(e.releaseYear) : "",
    castIds: coerceNumberArray(e.castIds), castNames: coerceStringArray(e.castNames), castProfilePaths: e.castProfilePaths, castGenders: e.castGenders as any,
    directorIds: coerceNumberArray(e.directorIds), directorNames: coerceStringArray(e.directorNames), directorProfilePaths: e.directorProfilePaths,
    watchedAt: Date.parse(e.watchedAt) || Date.now(), metadataVersion: e.metadataVersion || 1,
  }));
}

function convertRemoteEpisodeProgress(entries: RemoteEpisodeProgressEntry[]) {
  return entries.reduce((acc, e) => { if (e.seriesTmdbId > 0) acc[getEpisodeKey(e.seriesTmdbId, e.seasonNumber, e.episodeNumber)] = true; return acc; }, {} as Record<string, boolean>);
}

function convertRemoteDailyRecommendations(entries: RemoteDailyRecommendationEntry[]) {
  const history = { tmdbIds: [] as (number | string)[], imdbIds: [] as string[] };
  let current: MovieOfDayCurrent | null = null;
  entries.forEach(e => {
    if (e.tmdbId) { history.tmdbIds.push(e.tmdbId); history.imdbIds.push(e.imdbId ?? ""); }
    if (e.recommendationKind === MOVIE_OF_DAY_KIND) {
      if (!current || e.recommendationDate >= current.dateKey) {
        current = { dateKey: e.recommendationDate, movie: isRecord(e.snapshot.movie) ? (e.snapshot.movie as any) : null };
      }
    }
  });
  return { current, history };
}

async function resolveStorageUrl(path: string): Promise<string | null> {
  try { const { data, error } = await supabase.storage.from(PROFILE_ASSETS_BUCKET).createSignedUrl(path, SIGNED_ASSET_TTL_SECONDS); if (!error && data?.signedUrl) return data.signedUrl; } catch {}
  try { const { data } = supabase.storage.from(PROFILE_ASSETS_BUCKET).getPublicUrl(path); if (data?.publicUrl) return data.publicUrl; } catch {}
  return null;
}

async function fetchProfileAssetsFromDB() {
  const userId = await getCurrentUserId(); if (!userId) return null;
  const { data, error } = await supabase.from("user_profiles").select("avatar_path, banner_path, avatar_version, banner_version").eq("id", userId).single();
  if (error || !data) return null;
  return { avatarPath: data.avatar_path, bannerPath: data.banner_path, avatarVersion: data.avatar_version || 0, bannerVersion: data.banner_version || 0 };
}

async function resolveProfileAssetUris(overrides?: any) {
  let { avatarPath, bannerPath, avatarVersion, bannerVersion } = overrides || {};
  if (!avatarPath && !bannerPath) { const db = await fetchProfileAssetsFromDB(); if (db) { avatarPath = db.avatarPath; bannerPath = db.bannerPath; avatarVersion = db.avatarVersion; bannerVersion = db.bannerVersion; } }
  const [profileImageUri, bannerImageUri] = await Promise.all([avatarPath ? resolveStorageUrl(avatarPath) : null, bannerPath ? resolveStorageUrl(bannerPath) : null]);
  return { profileImageUri, bannerImageUri, profileImageStoragePath: avatarPath, bannerImageStoragePath: bannerPath, profileImageVersion: avatarVersion || 0, bannerImageVersion: bannerVersion || 0 };
}

async function fetchRemoteBootstrap(): Promise<RemoteBootstrap> { const { data, error } = await supabase.rpc("get_my_streambox_bootstrap"); if (error) throw error; return isRecord(data) ? (data as any) : {}; }

async function createLocalSnapshotFromRemote(remote: RemoteBootstrap, baseSettings: PersistedSettings): Promise<LocalUserSnapshot> {
  const rp = remote.profile as any;
  const assets = await resolveProfileAssetUris({ avatarPath: rp?.avatar_path, bannerPath: rp?.banner_path, avatarVersion: rp?.avatar_version, bannerVersion: rp?.banner_version });
  const settings: PersistedSettings = { 
    ...baseSettings, themeId: resolveThemeId(remote.settings?.themeId), profileName: rp?.display_name || baseSettings.profileName,
    profileBio: rp?.bio || baseSettings.profileBio, profileLocation: rp?.location || baseSettings.profileLocation, 
    profileBirthday: rp?.birthday ? formatBirthdayForLocal(rp.birthday) : baseSettings.profileBirthday, 
    joinedDate: rp?.joined_at || baseSettings.joinedDate, profileImageUri: assets.profileImageUri || baseSettings.profileImageUri, 
    bannerImageUri: assets.bannerImageUri || baseSettings.bannerImageUri, profileImageStoragePath: assets.profileImageStoragePath, 
    bannerImageStoragePath: assets.bannerImageStoragePath, profileImageVersion: assets.profileImageVersion, bannerImageVersion: assets.bannerImageVersion
  };
  const movieWatchlist = (remote.watchlist || []).filter(e => coerceMediaType(e.mediaType) === "movie").map(e => e.tmdbId);
  const seriesWatchlist = (remote.watchlist || []).filter(e => coerceMediaType(e.mediaType) === "tv").map(e => e.tmdbId);
  const likedMovies = (remote.liked || []).filter(e => coerceMediaType(e.mediaType) === "movie").map(e => e.tmdbId);
  const likedSeries = (remote.liked || []).filter(e => coerceMediaType(e.mediaType) === "tv").map(e => e.tmdbId);
  const watchHistory = convertRemoteWatchHistory(remote.watchHistory || []);
  const recentlyViewed = (remote.recentlyViewed || []).map(e => ({ id: e.tmdbId, mediaType: coerceMediaType(e.mediaType), timestamp: Date.parse(e.collectedAt) || Date.now() }));
  const movieOfDayState = convertRemoteDailyRecommendations(remote.dailyRecommendations || []);
  return { settings, movieWatchlist, seriesWatchlist, likedMovies, likedSeries, watchHistory, recentlyViewed, watchedEpisodes: convertRemoteEpisodeProgress(remote.episodeProgress || []), movieOfDayCurrent: movieOfDayState.current, movieOfDayHistory: movieOfDayState.history };
}

async function mergeInitialSnapshot(local: LocalUserSnapshot, remoteB: RemoteBootstrap) {
  const remote = await createLocalSnapshotFromRemote(remoteB, local.settings);
  return {
    settings: remote.settings,
    movieWatchlist: unionIds(remote.movieWatchlist, local.movieWatchlist),
    seriesWatchlist: unionIds(remote.seriesWatchlist, local.seriesWatchlist),
    likedMovies: unionIds(remote.likedMovies, local.likedMovies),
    likedSeries: unionIds(remote.likedSeries, local.likedSeries),
    watchHistory: mergeWatchHistoryEntries(remote.watchHistory, local.watchHistory),
    recentlyViewed: mergeRecentlyViewedEntries(remote.recentlyViewed, local.recentlyViewed),
    watchedEpisodes: { ...remote.watchedEpisodes, ...local.watchedEpisodes },
    movieOfDayCurrent: local.movieOfDayCurrent?.dateKey === getTodayDateKey() ? local.movieOfDayCurrent : remote.movieOfDayCurrent,
    movieOfDayHistory: { tmdbIds: unionIds(remote.movieOfDayHistory.tmdbIds, local.movieOfDayHistory.tmdbIds), imdbIds: Array.from(new Set([...remote.movieOfDayHistory.imdbIds, ...local.movieOfDayHistory.imdbIds])) }
  } satisfies LocalUserSnapshot;
}

function buildProfilePayload(s: PersistedSettings) { return { display_name: s.profileName, bio: s.profileBio, location_text: s.profileLocation, birthday: formatBirthdayForDatabase(s.profileBirthday), joined_at: s.joinedDate || new Date().toISOString(), avatar_path: s.profileImageStoragePath, banner_path: s.bannerImageStoragePath, avatar_version: s.profileImageVersion, banner_version: s.bannerImageVersion }; }
function buildSettingsPayload(s: PersistedSettings) { return { theme_id: s.themeId, preferences: {} }; }

function buildDailyRecommendationRows(snapshot: LocalUserSnapshot) {
  const rows: Array<Record<string, any>> = [];
  if (snapshot.movieOfDayCurrent?.movie && snapshot.movieOfDayCurrent.movie.id) {
    const ids = getSyncIds(snapshot.movieOfDayCurrent.movie.id as string | number);
    if (ids.tmdb_id || ids.internal_id) {
      rows.push({ recommendation_kind: MOVIE_OF_DAY_KIND, recommendation_date: snapshot.movieOfDayCurrent.dateKey, media_type: "movie", ...ids, imdb_id: snapshot.movieOfDayCurrent.movie.imdbId || null, strategy: "local_bootstrap", snapshot: { movie: snapshot.movieOfDayCurrent.movie } });
    }
  }
  snapshot.movieOfDayHistory.tmdbIds.forEach((id, idx) => {
    const ids = getSyncIds(id); if (!ids.tmdb_id && !ids.internal_id) return;
    const date = new Date(); date.setDate(date.getDate() - (idx + 1));
    rows.push({ recommendation_kind: MOVIE_OF_DAY_HISTORY_KIND, recommendation_date: getTodayDateKey(date), media_type: "movie", ...ids, imdb_id: snapshot.movieOfDayHistory.imdbIds[idx] || null, strategy: "legacy_history_import", snapshot: {} });
  });
  return rows;
}

async function backfillSnapshotToRemote(userId: string, snapshot: LocalUserSnapshot) {
  const profileRow = buildProfilePayload(snapshot.settings);
  const settingsRow = { user_id: userId, theme_id: snapshot.settings.themeId, preferences: {} };
  const now = new Date().toISOString();
  const buildMediaRow = (id: any, kind: string, type: string) => ({ user_id: userId, list_kind: kind, media_type: type, collected_at: now, snapshot: {}, ...getSyncIds(id) });
  const mediaRows = [
    ...snapshot.movieWatchlist.map(id => buildMediaRow(id, "watchlist", "movie")),
    ...snapshot.seriesWatchlist.map(id => buildMediaRow(id, "watchlist", "tv")),
    ...snapshot.likedMovies.map(id => buildMediaRow(id, "liked", "movie")),
    ...snapshot.likedSeries.map(id => buildMediaRow(id, "liked", "tv")),
    ...snapshot.recentlyViewed.map(e => ({ user_id: userId, list_kind: "recently_viewed", media_type: e.mediaType, collected_at: new Date(e.timestamp).toISOString(), snapshot: {}, ...getSyncIds(e.id) }))
  ];
  const watchHistoryRows = snapshot.watchHistory.map(entry => {
    const arrays = buildWatchHistorySyncArrays(entry);
    return { 
      user_id: userId, media_type: entry.mediaType, title: entry.title, poster_path: entry.posterPath, genres: entry.genres, 
      runtime_minutes: entry.runtimeMinutes, episode_count: entry.episodeCount, vote_average: entry.voteAverage, 
      release_year: entry.year ? Number(entry.year) : null, cast_ids: arrays.castIds, cast_names: arrays.castNames, 
      cast_profile_paths: arrays.castProfilePaths, cast_genders: arrays.castGenders, director_ids: arrays.directorIds, 
      director_names: arrays.directorNames, director_profile_paths: arrays.directorProfilePaths, 
      watched_at: new Date(entry.watchedAt).toISOString(), metadata_version: entry.metadataVersion, snapshot: {}, ...getSyncIds(entry.id) 
    };
  });
  const episodeRows = Object.keys(snapshot.watchedEpisodes).filter(k => snapshot.watchedEpisodes[k]).map(k => k.split("_")).filter(p => p.length === 3).map(([t,s,e]) => ({ user_id: userId, series_tmdb_id: Number(t), season_number: Number(s), episode_number: Number(e), snapshot: {} }));
  const recRows = buildDailyRecommendationRows(snapshot).map(r => ({ user_id: userId, ...r }));

  await supabase.from("user_profiles").upsert({ id: userId, ...profileRow }, { onConflict: "id" });
  await supabase.from("user_settings").upsert(settingsRow, { onConflict: "user_id" });

  const batchUpsert = async (table: string, rows: any[], conflictKeys: string) => {
    if (rows.length === 0) return;
    const tmdb = rows.filter(r => r.tmdb_id); const internal = rows.filter(r => r.internal_id);
    if (tmdb.length > 0) await supabase.from(table).upsert(tmdb, { onConflict: `${conflictKeys},tmdb_id` });
    if (internal.length > 0) await supabase.from(table).upsert(internal, { onConflict: `${conflictKeys},internal_id` });
  };

  await batchUpsert("user_media_library", mediaRows, "user_id,list_kind,media_type");
  await batchUpsert("user_watch_history", watchHistoryRows, "user_id,media_type");
  if (episodeRows.length > 0) await supabase.from("user_episode_progress").upsert(episodeRows, { onConflict: "user_id,series_tmdb_id,season_number,episode_number" });
  if (recRows.length > 0) await batchUpsert("user_daily_recommendations", recRows, "user_id,recommendation_kind,recommendation_date");
}

async function queueInitialAssetUploads(userId: string, settings: PersistedSettings) {
  const images = [{ u: settings.profileImageUri, k: "avatar" as const, p: settings.profileImageStoragePath, v: settings.profileImageVersion }, { u: settings.bannerImageUri, k: "banner" as const, p: settings.bannerImageStoragePath, v: settings.bannerImageVersion }];
  for (const img of images) { if (isLocalFileUri(img.u) && !img.p) await enqueuePendingOperation({ kind: "asset_upload", userId, assetKind: img.k, localUri: img.u, previousPath: null, nextVersion: Math.max(img.v, 0) + 1 }); }
}

function inferAssetExtension(uri: string) { const m = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/); return m?.[1] || "jpg"; }
function inferAssetContentType(uri: string) { const e = inferAssetExtension(uri); if (e === "png") return "image/png"; if (e === "webp") return "image/webp"; if (e === "heic") return "image/heic"; return "image/jpeg"; }

async function executePendingOperation(op: PendingSyncOperation) {
  switch (op.kind) {
    case "profile_settings": await supabase.rpc("sync_streambox_profile_and_settings", { profile_payload: buildProfilePayload(op.settings), settings_payload: buildSettingsPayload(op.settings), audit_metadata: op.auditMetadata }); break;
    case "asset_upload": {
      const ext = inferAssetExtension(op.localUri); const folder = op.assetKind === "avatar" ? "avatars" : "banners"; const path = `${op.userId}/${folder}/${op.assetKind}-${Date.now()}.${ext}`;
      const res = await fetch(op.localUri); const buf = await res.arrayBuffer();
      const { error } = await supabase.storage.from(PROFILE_ASSETS_BUCKET).upload(path, buf, { contentType: inferAssetContentType(op.localUri) });
      if (error) throw error;
      await supabase.rpc("sync_streambox_profile_and_settings", { profile_payload: op.assetKind === "avatar" ? { avatar_path: path, avatar_version: op.nextVersion } : { banner_path: path, banner_version: op.nextVersion }, settings_payload: {}, audit_metadata: { source: "asset_upload", assetKind: op.assetKind } });
      if (op.previousPath) await supabase.storage.from(PROFILE_ASSETS_BUCKET).remove([op.previousPath]);
      await updateLocalAssetMetadata(op.assetKind, op.localUri, path, op.nextVersion);
      break;
    }
    case "media_library": {
      const ids = getSyncIds(op.tmdbId);
      await supabase.rpc("sync_streambox_media_library_item", { p_operation: op.operation, p_list_kind: op.listKind, p_media_type: op.mediaType, p_tmdb_id: ids.tmdb_id, p_internal_id: ids.internal_id, p_imdb_id: op.imdbId, p_collected_at: op.collectedAt, p_snapshot: op.snapshot, p_audit_metadata: op.auditMetadata });
      break;
    }
    case "watch_history_upsert": {
      const ids = getSyncIds(op.entry.id); const arrays = buildWatchHistorySyncArrays(op.entry);
      await supabase.rpc("sync_streambox_watch_history_entry", { p_media_type: op.entry.mediaType, p_tmdb_id: ids.tmdb_id, p_internal_id: ids.internal_id, p_imdb_id: (op.entry as any).imdbId, p_title: op.entry.title, p_poster_path: op.entry.posterPath, p_genres: op.entry.genres, p_runtime_minutes: op.entry.runtimeMinutes, p_episode_count: op.entry.episodeCount, p_vote_average: op.entry.voteAverage, p_release_year: op.entry.year ? Number(op.entry.year) : null, p_cast_ids: arrays.castIds, p_cast_names: arrays.castNames, p_cast_profile_paths: arrays.castProfilePaths, p_cast_genders: arrays.castGenders, p_director_ids: arrays.directorIds, p_director_names: arrays.directorNames, p_director_profile_paths: arrays.directorProfilePaths, p_watched_at: new Date(op.entry.watchedAt).toISOString(), p_metadata_version: op.entry.metadataVersion, p_snapshot: {}, p_audit_metadata: op.auditMetadata });
      break;
    }
    case "watch_history_delete": { const ids = getSyncIds(op.tmdbId); await supabase.rpc("delete_streambox_watch_history_entry", { p_media_type: op.mediaType, p_tmdb_id: ids.tmdb_id, p_internal_id: ids.internal_id, p_audit_metadata: op.auditMetadata }); break; }
    case "episode_progress": await supabase.rpc("sync_streambox_episode_progress", { p_series_tmdb_id: op.seriesTmdbId, p_season_number: op.seasonNumber, p_episode_number: op.episodeNumber, p_is_watched: op.isWatched, p_watched_at: op.watchedAt, p_snapshot: {}, p_audit_metadata: op.auditMetadata }); break;
    case "daily_recommendation": {
      const ids = getSyncIds(op.tmdbId);
      await supabase.from("user_daily_recommendations").upsert({ user_id: op.userId, recommendation_kind: op.recommendationKind, recommendation_date: op.recommendationDate, media_type: op.mediaType, ...ids, imdb_id: op.imdbId, strategy: op.strategy, snapshot: op.snapshot }, { onConflict: `user_id,recommendation_kind,recommendation_date,${ids.tmdb_id ? 'tmdb_id' : 'internal_id'}` });
      break;
    }
    case "auth_event": await supabase.rpc("log_streambox_user_event", { action_category: op.actionCategory, action_type: op.actionType, entity_type: op.entityType, entity_key: op.entityKey, metadata: op.metadata }); break;
  }
}

export async function clearLocalUserDataCache() {
  const keys = [APP_SETTINGS_STORAGE_KEY, WATCHLIST_STORAGE_KEY, SERIES_WATCHLIST_STORAGE_KEY, LIKED_MOVIES_STORAGE_KEY, LIKED_SERIES_STORAGE_KEY, WATCH_HISTORY_STORAGE_KEY, RECENTLY_WATCHED_STORAGE_KEY, WATCHED_EPISODES_STORAGE_KEY, MOVIE_OF_DAY_CURRENT_STORAGE_KEY, MOVIE_OF_DAY_HISTORY_STORAGE_KEY, ACTIVE_SYNC_USER_KEY, AZ_CLASSICS_CACHE_KEY, SYNC_QUEUE_STORAGE_KEY];
  const all = await AsyncStorage.getAllKeys(); const bKeys = all.filter(k => k.startsWith(BOOTSTRAP_COMPLETE_KEY_PREFIX));
  await Promise.all([AsyncStorage.multiRemove([...keys, ...bKeys]), clearAzClassicImageCache()]);
}

export async function flushSupabaseUserDataSync(targetId?: string) {
  if (flushPromise) { await flushPromise; return; }
  flushPromise = (async () => {
    const uid = targetId || (await getCurrentUserId()); if (!uid) return;
    const q = await readPendingQueue(); if (q.length === 0) return;
    const r = q.filter(e => e.userId !== uid); const a = q.filter(e => e.userId === uid); const f: any[] = [];
    for (const op of a) { try { await executePendingOperation(op); } catch (e) { console.warn("Sync failed", e); f.push(op); } }
    await writePendingQueue([...r, ...f]);
  })().finally(() => { flushPromise = null; });
  await flushPromise;
}

export async function bootstrapSupabaseUserData() {
  const uid = await getCurrentUserId(); if (!uid) return;
  const pId = await AsyncStorage.getItem(ACTIVE_SYNC_USER_KEY); const local = await readLocalUserSnapshot(); const bDone = (await AsyncStorage.getItem(getBootstrapCompleteKey(uid))) === "1";
  if (bDone && pId === uid) {
    await flushSupabaseUserDataSync(uid); await AsyncStorage.setItem(ACTIVE_SYNC_USER_KEY, uid);
    if (!isLocalFileUri(local.settings.profileImageUri) || !isLocalFileUri(local.settings.bannerImageUri)) {
      const a = await resolveProfileAssetUris({ avatarPath: local.settings.profileImageStoragePath, bannerPath: local.settings.bannerImageStoragePath, avatarVersion: local.settings.profileImageVersion, bannerVersion: local.settings.bannerImageVersion });
      if (a.profileImageUri && !isLocalFileUri(local.settings.profileImageUri)) local.settings.profileImageUri = a.profileImageUri;
      if (a.bannerImageUri && !isLocalFileUri(local.settings.bannerImageUri)) local.settings.bannerImageUri = a.bannerImageUri;
      await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(local.settings));
    }
    return;
  }
  let rb: RemoteBootstrap; try { rb = await fetchRemoteBootstrap(); } catch { const a = await resolveProfileAssetUris(); if (a.profileImageUri) local.settings.profileImageUri = a.profileImageUri; if (a.bannerImageUri) local.settings.bannerImageUri = a.bannerImageUri; await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(local.settings)); return; }
  const merged = await mergeInitialSnapshot(local, rb); await writeLocalUserSnapshot(merged);
  await backfillSnapshotToRemote(uid, merged); await queueInitialAssetUploads(uid, merged.settings); await flushSupabaseUserDataSync(uid);
  const q = await readPendingQueue(); if (!q.some(e => e.userId === uid)) { const rb2 = await fetchRemoteBootstrap().catch(() => rb); await writeLocalUserSnapshot(await createLocalSnapshotFromRemote(rb2, merged.settings)); }
  await AsyncStorage.setItem(ACTIVE_SYNC_USER_KEY, uid); await AsyncStorage.setItem(getBootstrapCompleteKey(uid), "1");
}

export async function enqueueProfileSettingsSync(settings: PersistedSettings, audit: SyncMetadata = {}) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "profile_settings", userId: uid, settings, auditMetadata: normalizeSyncMetadata(audit) });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueProfileAssetSync(kind: SyncAssetKind, uri: string | null, prev: string | null, ver: number) {
  const uid = await getCurrentUserId(); if (!uid || !uri || !isLocalFileUri(uri)) return;
  await enqueuePendingOperation({ kind: "asset_upload", userId: uid, assetKind: kind, localUri: uri, previousPath: prev, nextVersion: Math.max(ver, 0) + 1 });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueMediaLibrarySync(i: { operation: "upsert" | "delete"; listKind: SyncListKind; mediaType: MediaType; tmdbId: number | string; details?: UserMediaSyncDetails | null; occurredAt?: string; }) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "media_library", userId: uid, operation: i.operation, listKind: i.listKind, mediaType: i.mediaType, tmdbId: i.tmdbId, imdbId: i.details?.imdbId ?? null, collectedAt: i.occurredAt ?? new Date().toISOString(), snapshot: normalizeMediaSnapshot(i.details), auditMetadata: normalizeSyncMetadata({ title: i.details?.title }) });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueWatchHistoryUpsert(e: WatchHistoryEntry, a: SyncMetadata = {}) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "watch_history_upsert", userId: uid, entry: e, auditMetadata: normalizeSyncMetadata(a) });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueWatchHistoryDelete(t: MediaType, id: number | string, a: SyncMetadata = {}) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "watch_history_delete", userId: uid, mediaType: t, tmdbId: id, auditMetadata: normalizeSyncMetadata(a) });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueEpisodeProgressSync(t: number, s: number, e: number, w: boolean, a: SyncMetadata = {}) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "episode_progress", userId: uid, seriesTmdbId: t, seasonNumber: s, episodeNumber: e, isWatched: w, watchedAt: new Date().toISOString(), auditMetadata: normalizeSyncMetadata(a) });
  void flushSupabaseUserDataSync(uid);
}

export async function enqueueDailyRecommendationSync(m: Record<string, any> | null, d: string) {
  const uid = await getCurrentUserId(); if (!uid || !m || !m.id) return;
  await enqueuePendingOperation({ kind: "daily_recommendation", userId: uid, recommendationKind: MOVIE_OF_DAY_KIND, recommendationDate: d, mediaType: "movie", tmdbId: m.id, imdbId: m.imdbId || null, strategy: "device_generated", snapshot: { movie: m } });
  void flushSupabaseUserDataSync(uid);
}

export async function logSupabaseUserEvent(cat: string, type: string, meta: SyncMetadata = {}, opts?: any) {
  const uid = await getCurrentUserId(); if (!uid) return;
  await enqueuePendingOperation({ kind: "auth_event", userId: uid, actionCategory: cat, actionType: type, entityType: opts?.entityType ?? null, entityKey: opts?.entityKey ?? null, metadata: normalizeSyncMetadata(meta), createdAt: new Date().toISOString() });
  if (opts?.flushImmediately) await flushSupabaseUserDataSync(uid); else void flushSupabaseUserDataSync(uid);
}
