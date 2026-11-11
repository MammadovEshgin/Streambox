import { useCallback, useEffect, useMemo, useState } from "react";
import { InteractionManager } from "react-native";

import {
  getWatchHistoryMetadata,
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
import { withLibraryLock } from "../services/libraryLocks";
import { libraryStorage } from "../services/libraryStorage";
import { pruneWatchedFromWatchlist } from "../services/mediaListStore";
import { isPlayerActive } from "../services/playerActivityFlag";
import { mapWithConcurrency } from "../utils/concurrency";
import {
  applyWatchHistoryOps,
  buildSeriesSeasonInternalId,
  collectWatchlistPruneRequests,
  type WatchHistoryListOp,
  type WatchHistoryMutation,
} from "../utils/watchHistoryOps";

// 7 — cast depth raised to WATCH_ENTRY_CAST_LIMIT (20). It also re-runs the
// backfill for titles version 6 stamped current without ever getting their
// credits: that pass marked an entry done even when its request failed, and a
// long history on a busy connection failed plenty of them. Bumping this
// re-enriches existing entries in the background (see runMetadataBackfill).
// 8 — the cloud stopped truncating cast to five on upload (migration
// 20260920200000). Rows written before this are five names deep whatever
// version they carry, so 8 marks "deep cast, and it survives a sync". Entries
// that already hold a full local cast are upgraded without a refetch. Must stay
// equal to WATCH_HISTORY_CAST_SYNC_VERSION, which the sync layer uses to decide
// whether a remote row predates the deeper cast.
const METADATA_VERSION = 8;

/**
 * How many billed cast members a watch-history entry remembers.
 *
 * This was 5, which is far too shallow for an ensemble: Cate Blanchett is
 * credited 13th on The Fellowship of the Ring, so no amount of watching the
 * trilogy ever attributed it to her in the Stats "most watched actors" section,
 * and tapping her row showed a list with the films missing. Capped by
 * DETAILS_CAST_LIMIT in the TMDB client, which fetches 20.
 */
const WATCH_ENTRY_CAST_LIMIT = 20;

/** Held back until launch has settled, so the backfill never competes with the first screens. */
const METADATA_BACKFILL_START_DELAY_MS = 8_000;
/** Two requests at a time keeps a several-hundred-title backfill well inside the proxy's per-IP budget. */
const METADATA_BACKFILL_CONCURRENCY = 2;
/** Progress is written slice by slice, so closing the app mid-backfill keeps what finished. */
const METADATA_BACKFILL_BATCH_SIZE = 20;
const METADATA_BACKFILL_PLAYER_POLL_MS = 5_000;

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
  // De-duplicate before slicing: TMDB lists an actor once per credited role, so
  // anyone playing two parts used to occupy two of the few slots available AND
  // score twice in the Stats actor counts, which is how a tally could exceed
  // the number of titles it was supposed to summarise.
  const seen = new Set<number>();
  const billed: typeof cast = [];
  for (const member of cast) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    billed.push(member);
    if (billed.length >= WATCH_ENTRY_CAST_LIMIT) break;
  }

  return {
    castIds: billed.map((member) => member.id),
    castNames: billed.map((member) => member.name),
    castProfilePaths: billed.map((member) => member.profilePath),
    castGenders: billed.map((member) => member.gender),
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

export type FallbackWatchEntryInput = {
  id: number;
  mediaType: MediaType;
  title: string;
  year?: string | number | null;
  posterPath?: string | null;
  runtimeMinutes?: number | null;
  episodeCount?: number | null;
};

/**
 * A watched entry built without any network: used when the full details can't
 * be fetched at the moment of logging (offline, TMDB unreachable — Bakcell
 * drops it often). Before, those paths fetched first and silently skipped the
 * save on failure, so a film long-pressed in a Cinematic Journey, or finished
 * in the player, showed as watched there but never reached the profile.
 * metadataVersion 1 hands it to the metadata backfill, which fills in genres,
 * cast and directors once TMDB answers.
 */
export function buildFallbackWatchEntry(input: FallbackWatchEntryInput, watchedAt: number): WatchHistoryEntry {
  const year = input.year === null || input.year === undefined ? "" : String(input.year).slice(0, 4);
  return {
    id: input.id,
    sourceTmdbId: input.id,
    mediaType: input.mediaType,
    historyKind: "title",
    seasonNumber: null,
    title: input.title,
    posterPath: input.posterPath ?? null,
    genres: [],
    runtimeMinutes: input.runtimeMinutes ?? null,
    episodeCount: input.mediaType === "tv" ? input.episodeCount ?? null : null,
    voteAverage: 0,
    year: /^\d{4}$/.test(year) ? year : "",
    castIds: [],
    castNames: [],
    castProfilePaths: [],
    castGenders: [],
    directorIds: [],
    directorNames: [],
    directorProfilePaths: [],
    watchedAt,
    watchPrecision: "day",
    metadataVersion: 1,
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

// ── Shared stored copy ───────────────────────────────────────────────────────
// A dozen screens mount this hook, and every storage change in the app reloaded
// each of them: one storage read plus a parse of the whole history (twenty
// credits per title) per mounted screen, even when the change was a liked film
// and the history hadn't moved. The last parse is kept here and reused while
// the stored text is unchanged, so an unrelated change costs a string compare
// and hands every screen the same array — nothing downstream recomputes.
let storedHistoryRaw: string | null = null;
let storedHistoryEntries: WatchHistoryEntry[] = [];

function parseStoredHistory(raw: string | null): WatchHistoryEntry[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as StoredEntry[];
  if (!Array.isArray(parsed)) {
    throw new Error("Stored watch history is not a list");
  }
  return sortEntries(parsed.map(normalizeStoredEntry));
}

/**
 * The stored history for a WRITER. Throws when storage can't be read or parsed,
 * because a writer handed an empty list would persist it over the real history.
 */
async function readEntriesForMutation(): Promise<WatchHistoryEntry[]> {
  const raw = await libraryStorage.getItem(WATCH_HISTORY_STORAGE_KEY);
  if (raw !== storedHistoryRaw) {
    storedHistoryEntries = parseStoredHistory(raw);
    storedHistoryRaw = raw;
  }
  return storedHistoryEntries;
}

/** The stored history for display: an unreadable store simply shows nothing. */
async function readEntriesFromStorage(): Promise<WatchHistoryEntry[]> {
  try {
    return await readEntriesForMutation();
  } catch {
    return [];
  }
}

async function writeEntriesToStorage(entries: WatchHistoryEntry[]): Promise<WatchHistoryEntry[]> {
  const sorted = sortEntries(entries);
  const raw = JSON.stringify(sorted);
  await libraryStorage.setItem(WATCH_HISTORY_STORAGE_KEY, raw);
  storedHistoryRaw = raw;
  storedHistoryEntries = sorted;
  return sorted;
}

// Every write to the history queues here — the mutations of every mounted
// hook, the metadata backfill, the Letterboxd import and the cloud reconcile
// (one shared lock in services/libraryLocks) — and each one reads the stored
// list inside the lock. Mutations used to start from their own hook's
// in-memory copy, and the backfill from a snapshot taken minutes earlier, so
// whichever wrote last silently undid the other: a title marked watched while
// the backfill ran disappeared again when it finished.
function withWatchHistoryWriteLock<T>(task: () => Promise<T>): Promise<T> {
  return withLibraryLock(WATCH_HISTORY_STORAGE_KEY, task);
}

// ── Metadata backfill ────────────────────────────────────────────────────────
// Entries logged under an older METADATA_VERSION are refreshed in the
// background. This used to run inside every mounted hook, on every storage
// change, for the whole list at once, and saved only when the entire pass
// finished. A long history never finished — every launch restarted it from
// scratch in several screens at once, which is what made the app feel slow
// after version 6 shipped, and why the deeper cast never reached Stats. Now:
// one run per app session, started after launch settles, paused during
// playback, two requests at a time, saved slice by slice.

type MetadataPatch = Partial<WatchHistoryEntry> & { metadataVersion: number };

const metadataBackfillAttempted = new Set<string>();
let metadataBackfillRun: Promise<void> | null = null;
let metadataBackfillHasStarted = false;

function getWatchEntryKey(entry: Pick<WatchHistoryEntry, "mediaType" | "id">) {
  return `${entry.mediaType}:${entry.id}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** null = couldn't fetch right now; leave the entry for a later launch. */
async function fetchMetadataPatch(entry: WatchHistoryEntry): Promise<MetadataPatch | null> {
  // Seasons and non-TMDB ids have nothing to refetch.
  if (entry.historyKind === "season" || typeof entry.id === "string") {
    return { metadataVersion: METADATA_VERSION };
  }

  // Already as deep as a refetch could make it — the version-8 bump is about
  // the cloud no longer truncating, not about missing data. Free upgrade, so a
  // long local history does not re-download itself over TMDB.
  if (entry.castIds.length >= WATCH_ENTRY_CAST_LIMIT) {
    return { metadataVersion: METADATA_VERSION };
  }

  try {
    const metadata = await getWatchHistoryMetadata(entry.mediaType, String(entry.id));
    return {
      genres: metadata.genres,
      runtimeMinutes: metadata.runtimeMinutes,
      episodeCount: entry.mediaType === "movie" ? null : metadata.episodeCount,
      // Logged entries carry the IMDb rating, which this lighter fetch doesn't ask for.
      voteAverage: entry.voteAverage > 0 ? entry.voteAverage : metadata.voteAverage,
      year: metadata.releaseDate ? metadata.releaseDate.slice(0, 4) : entry.year,
      ...topCast(metadata.cast),
      ...topDirectors(metadata.directors),
      metadataVersion: METADATA_VERSION,
    };
  } catch (error) {
    // Gone from TMDB: nothing will ever come back, so stop asking.
    if ((error as { response?: { status?: number } })?.response?.status === 404) {
      return { metadataVersion: METADATA_VERSION };
    }
    // Offline, throttled, timed out: NOT stamped current. Version 6 stamped
    // these anyway, which is how one failed request truncated a title's cast
    // for good.
    return null;
  }
}

async function runMetadataBackfill(): Promise<boolean> {
  if (!metadataBackfillHasStarted) {
    metadataBackfillHasStarted = true;
    await sleep(METADATA_BACKFILL_START_DELAY_MS);
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));
  }

  let changed = false;
  for (;;) {
    const slice = (await readEntriesFromStorage())
      .filter((entry) => entry.metadataVersion < METADATA_VERSION && !metadataBackfillAttempted.has(getWatchEntryKey(entry)))
      .slice(0, METADATA_BACKFILL_BATCH_SIZE);
    if (slice.length === 0) return changed;

    // Don't compete with a playing stream for bandwidth.
    while (isPlayerActive()) {
      await sleep(METADATA_BACKFILL_PLAYER_POLL_MS);
    }

    slice.forEach((entry) => metadataBackfillAttempted.add(getWatchEntryKey(entry)));
    const patches = await mapWithConcurrency(slice, METADATA_BACKFILL_CONCURRENCY, fetchMetadataPatch);

    const patchByKey = new Map<string, MetadataPatch>();
    slice.forEach((entry, index) => {
      const patch = patches[index];
      if (patch) patchByKey.set(getWatchEntryKey(entry), patch);
    });
    // A whole slice failing means the network is down; try again next launch
    // instead of burning through the rest of the history.
    if (patchByKey.size === 0) return changed;

    await withWatchHistoryWriteLock(async () => {
      const latest = await readEntriesForMutation();
      let applied = false;
      const next = latest.map((entry) => {
        const patch = patchByKey.get(getWatchEntryKey(entry));
        // An entry saved since the fetch began is already current and newer.
        if (!patch || entry.metadataVersion >= METADATA_VERSION) return entry;
        applied = true;
        return { ...entry, ...patch };
      });
      if (applied) {
        await writeEntriesToStorage(next);
        changed = true;
      }
    });
  }
}

function startMetadataBackfill(onChanged: () => void) {
  if (metadataBackfillRun) return;

  metadataBackfillRun = runMetadataBackfill()
    .then((changed) => {
      // One notification for the whole run, so the screens reload once rather
      // than after every slice.
      if (changed) onChanged();
    })
    .catch(() => undefined)
    .finally(() => {
      metadataBackfillRun = null;
    });
}

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
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const loadEntries = useCallback(async () => {
    try {
      const normalized = await readEntriesForMutation();
      setEntries(normalized);
      if (normalized.some((entry) => entry.metadataVersion < METADATA_VERSION)) {
        startMetadataBackfill(notifyStorageChanged);
      }
    } catch (error) {
      // Keep what is on screen: blanking the Watched shelf on a failed read is
      // what made logged films look deleted.
      console.warn("[library] failed to read watch history:", error);
    } finally {
      setIsLoading(false);
    }
  }, [notifyStorageChanged]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries, storageRevision]);

  // Local-first: apply the whole batch to the stored list, write it once, and
  // hand Supabase work to the debounced sync queue. No network
  // round-trip happens on the save path.
  const applyWatchHistoryMutations = useCallback(
    async (mutations: WatchHistoryMutation[]) => {
      if (mutations.length === 0) {
        return;
      }

      await withWatchHistoryWriteLock(async () => {
        const currentEntries = await readEntriesForMutation();
        const listOps: WatchHistoryListOp[] = mutations.map((mutation) =>
          mutation.kind === "upsert"
            ? { kind: "upsert", entry: mutation.entry }
            : { kind: "remove", id: mutation.id, mediaType: mutation.mediaType }
        );
        const nextEntries = await writeEntriesToStorage(applyWatchHistoryOps(currentEntries, listOps));
        setEntries(nextEntries);
        notifyStorageChanged();

        const queueItems: WatchHistoryQueueItem[] = mutations.map((mutation) =>
          mutation.kind === "upsert"
            ? { operation: "upsert", entry: mutation.entry, audit: mutation.auditDetails ?? {} }
            : { operation: "delete", mediaType: mutation.mediaType, tmdbId: mutation.id, audit: mutation.auditDetails ?? {} }
        );
        await enqueueWatchHistoryBatch(queueItems);

        // Watched titles leave the watchlist. Every path that marks something
        // watched — the log sheet, the season modal, the player's auto-mark —
        // funnels through here, so this is the one place that has to know.
        const pruneRequests = collectWatchlistPruneRequests(mutations);
        if (pruneRequests.length > 0) {
          const pruned = await pruneWatchedFromWatchlist(pruneRequests);
          if (pruned.length > 0) {
            // Wakes every mounted useSyncedMediaIdList so the profile shelves
            // and the detail screen's bookmark drop the title immediately.
            notifyStorageChanged();
          }
        }
      });
    },
    [notifyStorageChanged]
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

  // Network-free save for when details can't be fetched. An already-logged
  // title keeps its rich metadata and only takes the new date.
  const saveFallbackToWatchHistory = useCallback(
    async (input: FallbackWatchEntryInput, watchedAt: number) => {
      const existing = (await readEntriesFromStorage()).find(
        (entry) => entry.historyKind === "title" && entry.mediaType === input.mediaType && entry.id === input.id
      );
      const nextEntry = existing
        ? { ...existing, watchedAt, watchPrecision: "day" as const }
        : buildFallbackWatchEntry(input, watchedAt);
      await upsertWatchHistoryEntry(nextEntry, {
        title: nextEntry.title,
        posterPath: nextEntry.posterPath,
        year: nextEntry.year || null,
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

  const rawHistory = useMemo(() => sortEntries(entries), [entries]);

  return useMemo(
    () => ({
      history: titleHistory,
      rawHistory,
      activityHistory,
      isLoading,
      isWatched,
      getWatchHistoryEntry,
      getSeriesSeasonWatchEntry,
      getSeriesSeasonWatchEntries,
      saveMovieToWatchHistory,
      saveSeriesToWatchHistory,
      saveFallbackToWatchHistory,
      saveSeriesSeasonToWatchHistory,
      saveSeriesWatchedBatch,
      removeFromWatchHistory,
      removeSeriesSeasonFromWatchHistory,
      reload: loadEntries,
    }),
    [
      activityHistory,
      getSeriesSeasonWatchEntries,
      getSeriesSeasonWatchEntry,
      getWatchHistoryEntry,
      isLoading,
      isWatched,
      loadEntries,
      rawHistory,
      removeFromWatchHistory,
      removeSeriesSeasonFromWatchHistory,
      saveFallbackToWatchHistory,
      saveMovieToWatchHistory,
      saveSeriesSeasonToWatchHistory,
      saveSeriesToWatchHistory,
      saveSeriesWatchedBatch,
      titleHistory,
    ]
  );
}
