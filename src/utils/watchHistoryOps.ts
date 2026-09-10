import type { MediaType } from "../api/tmdb";
import type { WatchHistoryEntry } from "../hooks/useWatchHistory";
import type { WatchlistPruneRequest } from "../services/mediaListStore";
import type { UserMediaSyncDetails } from "../services/userDataSync";

// Pure helpers for applying a batch of watch-history mutations to the local
// entry list. Extracted from useWatchHistory so the invariant that caused the
// movies-vanished bug — a TV save must never drop unrelated (movie) entries —
// can be unit-tested without React or AsyncStorage.

export type WatchHistoryListOp =
  | { kind: "upsert"; entry: WatchHistoryEntry }
  | { kind: "remove"; id: number | string; mediaType: MediaType };

/**
 * Local id for a "watched this season" entry. Lives here rather than in
 * useWatchHistory so the sync layer can rebuild the same key when reading rows
 * back from Supabase without importing the hook (which would be circular).
 * Both sides MUST agree on this format or a season duplicates on bootstrap.
 */
export function buildSeriesSeasonInternalId(seriesId: number, seasonNumber: number): string {
  return `series-season:${seriesId}:${seasonNumber}`;
}

/**
 * Apply upserts/removals to the current entry list in order. Only entries
 * whose (id, mediaType) pair is explicitly targeted by an op are replaced or
 * removed; every other entry passes through untouched. Upserted entries are
 * placed at the front, matching the single-upsert behavior (the caller sorts
 * by watchedAt before persisting anyway).
 */
export function applyWatchHistoryOps(
  current: WatchHistoryEntry[],
  ops: WatchHistoryListOp[]
): WatchHistoryEntry[] {
  let next = [...current];
  for (const op of ops) {
    if (op.kind === "remove") {
      next = next.filter((entry) => !(entry.id === op.id && entry.mediaType === op.mediaType));
      continue;
    }

    next = next.filter(
      (entry) => !(entry.id === op.entry.id && entry.mediaType === op.entry.mediaType)
    );
    next = [op.entry, ...next];
  }

  return next;
}

export type WatchHistoryMutation =
  | { kind: "upsert"; entry: WatchHistoryEntry; auditDetails?: UserMediaSyncDetails | null }
  | { kind: "remove"; id: number | string; mediaType: MediaType; auditDetails?: UserMediaSyncDetails | null };

/** The stored TMDB id for an entry, or null when it has none (imported rows). */
function resolveEntryTmdbId(entry: Pick<WatchHistoryEntry, "id" | "sourceTmdbId">): number | null {
  if (typeof entry.sourceTmdbId === "number" && Number.isFinite(entry.sourceTmdbId) && entry.sourceTmdbId > 0) {
    return entry.sourceTmdbId;
  }

  return typeof entry.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
}

/**
 * Watchlist removals implied by a batch of watch-history upserts.
 *
 * The watchlist answers "what do I still want to see?", so a title that has
 * just been logged as watched no longer belongs in it — whether it was logged
 * by hand, through the season modal, or by the player finishing it.
 *
 * A season entry stores a synthetic string id ("series-season:<id>:<n>"), so
 * the series' own TMDB id has to come from `sourceTmdbId`; a title entry
 * carries it directly. Removals are ignored: un-marking something watched does
 * not put it back on the watchlist.
 */
export function collectWatchlistPruneRequests(
  mutations: WatchHistoryMutation[]
): WatchlistPruneRequest[] {
  const seen = new Set<string>();
  const requests: WatchlistPruneRequest[] = [];

  for (const mutation of mutations) {
    if (mutation.kind !== "upsert") continue;

    const tmdbId = resolveEntryTmdbId(mutation.entry);
    if (tmdbId === null) continue;

    const key = `${mutation.entry.mediaType}:${tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    requests.push({
      mediaType: mutation.entry.mediaType,
      tmdbId,
      details: mutation.auditDetails ?? null,
    });
  }

  return requests;
}
