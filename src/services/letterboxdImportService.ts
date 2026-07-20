import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import JSZip from "jszip";

import { findMovieByTitleAndYear, getMovieDetails } from "../api/tmdb";
import { buildMovieWatchEntry, type WatchHistoryEntry } from "../hooks/useWatchHistory";
import { mapWithConcurrency } from "../utils/concurrency";
import { parseCsvToObjects } from "../utils/csv";
import {
  LIKED_MOVIES_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
} from "./userDataStorage";
import {
  enqueueMediaLibraryBatch,
  enqueueWatchHistoryBatch,
  syncCurrentLocalUserSnapshotToSupabase,
} from "./userDataSync";

// Letterboxd's data export contains far more than these, but watched /
// watchlist / likes / diary are everything we need to mirror the user's
// library, watch button state, and stats. Paths are matched by suffix so a
// wrapping top-level folder inside the zip doesn't matter.
const WATCHED_CSV = "watched.csv";
const WATCHLIST_CSV = "watchlist.csv";
const LIKED_FILMS_CSV = "likes/films.csv";
const DIARY_CSV = "diary.csv";

// Letterboxd is movies-only, but resolving a title to a TMDB id (search) and
// then hydrating full details (genres, cast, runtime…) are both network-bound,
// so we cap concurrency to stay friendly to the TMDB proxy.
const MATCH_CONCURRENCY = 12;
const DETAILS_CONCURRENCY = 8;

export type LetterboxdImportPhase = "reading" | "matching" | "details" | "saving";

export type LetterboxdImportProgress = {
  phase: LetterboxdImportPhase;
  completed: number;
  total: number;
};

export type LetterboxdImportResult = {
  totalFilms: number;
  matched: number;
  watchedAdded: number;
  watchlistAdded: number;
  likedAdded: number;
  unmatched: string[];
  syncedToCloud: boolean;
};

type LetterboxdFilm = {
  name: string;
  year: string;
  uri: string;
  /** ms timestamp of the best-known watched/logged date, or null. */
  watchedAt: number | null;
};

type ProgressFn = (progress: LetterboxdImportProgress) => void;

function noop() {}

function dateToTimestamp(value: string | undefined | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Anchor at local noon so the calendar day can't shift across time zones.
  const parsed = Date.parse(`${trimmed}T12:00:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function findZipEntry(zip: JSZip, suffix: string): JSZip.JSZipObject | null {
  const lowerSuffix = suffix.toLowerCase();
  for (const path of Object.keys(zip.files)) {
    const file = zip.files[path];
    if (!file.dir && path.toLowerCase().endsWith(lowerSuffix)) {
      return file;
    }
  }
  return null;
}

async function readCsvRecords(zip: JSZip, suffix: string): Promise<Record<string, string>[]> {
  const entry = findZipEntry(zip, suffix);
  if (!entry) return [];
  const text = await entry.async("string");
  return parseCsvToObjects(text);
}

function toFilm(record: Record<string, string>, watchedAt: number | null): LetterboxdFilm | null {
  const name = (record.Name ?? "").trim();
  const uri = (record["Letterboxd URI"] ?? "").trim();
  if (!name) return null;
  return {
    name,
    year: (record.Year ?? "").trim(),
    // Fall back to the title+year as a stable key when a URI is somehow absent.
    uri: uri || `${name}|${(record.Year ?? "").trim()}`,
    watchedAt,
  };
}

function filmLabel(film: LetterboxdFilm): string {
  return film.year ? `${film.name} (${film.year})` : film.name;
}

/** Stable title+year key for joining diary watched-dates to the watched list. */
function filmDateKey(name: string | undefined, year: string | undefined): string {
  return `${(name ?? "").trim().toLowerCase()}|${(year ?? "").trim()}`;
}

function parseStoredIds(raw: string | null): (number | string)[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is number | string =>
        (typeof entry === "number" && Number.isFinite(entry)) ||
        (typeof entry === "string" && entry.trim().length > 0)
    );
  } catch {
    return [];
  }
}

function parseStoredHistory(raw: string | null): WatchHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WatchHistoryEntry =>
        !!entry &&
        typeof entry === "object" &&
        (typeof (entry as WatchHistoryEntry).id === "number" ||
          typeof (entry as WatchHistoryEntry).id === "string") &&
        typeof (entry as WatchHistoryEntry).mediaType === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Parse the relevant CSVs out of a Letterboxd export zip into structured film
 * lists. Watched dates are taken from the diary (the real "watched on" date)
 * when present, otherwise from the list's own Date column.
 */
async function parseArchive(fileUri: string) {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(base64, { base64: true });

  const [watchedRows, watchlistRows, likedRows, diaryRows] = await Promise.all([
    readCsvRecords(zip, WATCHED_CSV),
    readCsvRecords(zip, WATCHLIST_CSV),
    readCsvRecords(zip, LIKED_FILMS_CSV),
    readCsvRecords(zip, DIARY_CSV),
  ]);

  // Best watched date per film from the diary. NOTE: diary rows carry the
  // diary-entry URI, not the film URI, so we join on title+year (both files
  // have those). Keep the most recent log for rewatches.
  const diaryDates = new Map<string, number>();
  for (const row of diaryRows) {
    const key = filmDateKey(row.Name, row.Year);
    const ts = dateToTimestamp(row["Watched Date"]) ?? dateToTimestamp(row.Date);
    if (!key || ts == null) continue;
    const existing = diaryDates.get(key);
    if (existing == null || ts > existing) diaryDates.set(key, ts);
  }

  const watched = watchedRows
    .map((row) => {
      const film = toFilm(row, null);
      if (!film) return null;
      film.watchedAt = diaryDates.get(filmDateKey(row.Name, row.Year)) ?? dateToTimestamp(row.Date);
      return film;
    })
    .filter((film): film is LetterboxdFilm => film !== null);

  const watchlist = watchlistRows
    .map((row) => toFilm(row, null))
    .filter((film): film is LetterboxdFilm => film !== null);

  const liked = likedRows
    .map((row) => toFilm(row, null))
    .filter((film): film is LetterboxdFilm => film !== null);

  return { watched, watchlist, liked };
}

/**
 * Import a Letterboxd export zip: resolve every film to a TMDB id, hydrate
 * watched films with full details, then merge the results into the local
 * watched / watchlist / liked stores and push the snapshot to Supabase.
 *
 * Existing local data is preserved — lists are unioned and watch-history
 * entries already present are never overwritten.
 */
export async function importLetterboxdArchive(
  fileUri: string,
  onProgress: ProgressFn = noop
): Promise<LetterboxdImportResult> {
  onProgress({ phase: "reading", completed: 0, total: 0 });
  const { watched, watchlist, liked } = await parseArchive(fileUri);

  // De-duplicate every referenced film by URI so a title that appears in
  // several lists is only looked up once.
  const uniqueFilms = new Map<string, LetterboxdFilm>();
  for (const film of [...watched, ...watchlist, ...liked]) {
    if (!uniqueFilms.has(film.uri)) uniqueFilms.set(film.uri, film);
  }
  const filmsToResolve = [...uniqueFilms.values()];

  // Phase 1 — resolve TMDB ids.
  let matchedCount = 0;
  const idByUri = new Map<string, number | null>();
  const matchResults = await mapWithConcurrency(
    filmsToResolve,
    MATCH_CONCURRENCY,
    async (film) => {
      const id = await findMovieByTitleAndYear(film.name, film.year);
      matchedCount += 1;
      onProgress({ phase: "matching", completed: matchedCount, total: filmsToResolve.length });
      return { uri: film.uri, id };
    }
  );
  for (const { uri, id } of matchResults) idByUri.set(uri, id);

  const unmatched: string[] = [];
  const seenUnmatched = new Set<string>();
  for (const film of filmsToResolve) {
    if (idByUri.get(film.uri) == null) {
      const label = filmLabel(film);
      if (!seenUnmatched.has(label)) {
        seenUnmatched.add(label);
        unmatched.push(label);
      }
    }
  }

  // Watched ids → best watchedAt (latest log wins for rewatches).
  const watchedAtById = new Map<number, number>();
  for (const film of watched) {
    const id = idByUri.get(film.uri);
    if (id == null) continue;
    const ts = film.watchedAt ?? Date.now();
    const existing = watchedAtById.get(id);
    if (existing == null || ts > existing) watchedAtById.set(id, ts);
  }

  const watchlistIds = dedupeNumbers(
    watchlist.map((film) => idByUri.get(film.uri)).filter(isResolvedId)
  );
  const likedIds = dedupeNumbers(
    liked.map((film) => idByUri.get(film.uri)).filter(isResolvedId)
  );

  // Phase 2 — hydrate watched films with full details for the stats page.
  const watchedIds = [...watchedAtById.keys()];
  let detailsCount = 0;
  const builtEntries = await mapWithConcurrency(watchedIds, DETAILS_CONCURRENCY, async (id) => {
    try {
      const details = await getMovieDetails(String(id));
      return buildMovieWatchEntry(details, watchedAtById.get(id) ?? Date.now(), "day");
    } catch {
      return null; // matched but couldn't hydrate — skip rather than store junk
    } finally {
      detailsCount += 1;
      onProgress({ phase: "details", completed: detailsCount, total: watchedIds.length });
    }
  });
  const newWatchEntries = builtEntries.filter((entry): entry is WatchHistoryEntry => entry !== null);

  // Phase 3 — merge into local storage (union lists, preserve existing).
  onProgress({ phase: "saving", completed: 0, total: 1 });
  const [watchlistRaw, likedRaw, historyRaw] = await Promise.all([
    AsyncStorage.getItem(WATCHLIST_STORAGE_KEY),
    AsyncStorage.getItem(LIKED_MOVIES_STORAGE_KEY),
    AsyncStorage.getItem(WATCH_HISTORY_STORAGE_KEY),
  ]);

  const existingWatchlist = parseStoredIds(watchlistRaw);
  const existingLiked = parseStoredIds(likedRaw);
  const existingHistory = parseStoredHistory(historyRaw);

  const watchlistSet = new Set(existingWatchlist);
  const likedSet = new Set(existingLiked);
  const watchedIdSet = new Set<number>(watchedIds);
  const historyKeys = new Set(existingHistory.map((entry) => `${entry.mediaType}:${entry.id}`));

  // A watched film shouldn't also sit in the watchlist.
  const addedWatchlist = watchlistIds.filter(
    (id) => !watchlistSet.has(id) && !watchedIdSet.has(id)
  );
  const addedLiked = likedIds.filter((id) => !likedSet.has(id));
  const addedWatchEntries = newWatchEntries.filter(
    (entry) => !historyKeys.has(`movie:${entry.id}`)
  );

  const mergedWatchlist = [...existingWatchlist, ...addedWatchlist];
  const mergedLiked = [...existingLiked, ...addedLiked];
  const mergedHistory = [...existingHistory, ...addedWatchEntries].sort(
    (left, right) => right.watchedAt - left.watchedAt
  );

  await AsyncStorage.multiSet([
    [WATCHLIST_STORAGE_KEY, JSON.stringify(mergedWatchlist)],
    [LIKED_MOVIES_STORAGE_KEY, JSON.stringify(mergedLiked)],
    [WATCH_HISTORY_STORAGE_KEY, JSON.stringify(mergedHistory)],
  ]);

  // Push the merged snapshot to Supabase. Failure here (offline / rate limit)
  // is non-fatal for the import itself — the data is saved locally — but it
  // must NOT be fire-and-forget: this one-shot push used to be the ONLY cloud
  // path for imported items, so a single failure left hundreds of movies
  // existing on this device alone, unprotected against any later local loss.
  let syncedToCloud = false;
  try {
    await syncCurrentLocalUserSnapshotToSupabase();
    syncedToCloud = true;
  } catch {
    syncedToCloud = false;
    // Durable fallback: queue every imported item as an idempotent upsert in
    // the sync queue. The standard retry machinery (flush on foreground /
    // background / next launch) keeps retrying until they reach the cloud.
    try {
      await enqueueMediaLibraryBatch([
        ...addedWatchlist.map((id) => ({
          operation: "upsert" as const,
          listKind: "watchlist" as const,
          mediaType: "movie" as const,
          tmdbId: id,
        })),
        ...addedLiked.map((id) => ({
          operation: "upsert" as const,
          listKind: "liked" as const,
          mediaType: "movie" as const,
          tmdbId: id,
        })),
      ]);
      await enqueueWatchHistoryBatch(
        addedWatchEntries.map((entry) => ({
          operation: "upsert" as const,
          entry,
          audit: { source: "letterboxd_import" },
        }))
      );
    } catch {
      // Even the queue write failed — local data is intact; the user can
      // re-run the import or the next successful sync picks the lists up.
    }
  }

  const matched = [...idByUri.values()].filter((id) => id != null).length;

  return {
    totalFilms: filmsToResolve.length,
    matched,
    watchedAdded: addedWatchEntries.length,
    watchlistAdded: addedWatchlist.length,
    likedAdded: addedLiked.length,
    unmatched,
    syncedToCloud,
  };
}

function isResolvedId(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)];
}
