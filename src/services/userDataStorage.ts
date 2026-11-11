export const WATCHLIST_STORAGE_KEY = "streambox/watchlist";
export const SERIES_WATCHLIST_STORAGE_KEY = "streambox/series-watchlist";
export const LIKED_MOVIES_STORAGE_KEY = "streambox/liked-movies";
export const LIKED_SERIES_STORAGE_KEY = "streambox/liked-series";
export const WATCH_HISTORY_STORAGE_KEY = "streambox/watch-history";
export const RECENTLY_WATCHED_STORAGE_KEY = "streambox/recently-watched";
export const CONTINUE_WATCHING_STORAGE_KEY = "streambox/continue-watching";
export const WATCHED_EPISODES_STORAGE_KEY = "@watched_episodes";
export const MOVIE_OF_DAY_CURRENT_STORAGE_KEY = "streambox/movie-of-day/current";
export const MOVIE_OF_DAY_HISTORY_STORAGE_KEY = "streambox/movie-of-day/history";
export const SERIES_OF_DAY_CURRENT_STORAGE_KEY = "streambox/series-of-day/current";
// Watch Together: remembers the last session nickname to prefill the join sheet.
export const WATCH_TOGETHER_NICKNAME_STORAGE_KEY = "streambox/watch-together/last-nickname";
// Pending Supabase writes (services/userDataSync).
export const SYNC_QUEUE_STORAGE_KEY = "@streambox/sync-queue-v1";
// What the cloud held at the last library reconcile, per collection — the
// common ancestor that tells "deleted on another device" from "never uploaded".
export const LIBRARY_SYNC_BASE_STORAGE_KEY = "streambox/library-sync-base";

/**
 * The user's library and its sync queue. These live in files
 * (services/libraryStorage), not AsyncStorage: Android's AsyncStorage can't
 * read back a value over 2 MB and caps the whole database at 6 MB, and a long
 * watch history alone reaches that.
 */
export const DURABLE_LIBRARY_STORAGE_KEYS = [
  WATCHLIST_STORAGE_KEY,
  SERIES_WATCHLIST_STORAGE_KEY,
  LIKED_MOVIES_STORAGE_KEY,
  LIKED_SERIES_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  WATCHED_EPISODES_STORAGE_KEY,
  SYNC_QUEUE_STORAGE_KEY,
  LIBRARY_SYNC_BASE_STORAGE_KEY,
] as const;
