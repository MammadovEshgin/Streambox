// Derives franchise watched-state from the global watch history so titles
// logged anywhere (manual log, Letterboxd import, detail screens) show up as
// watched on the franchise timeline without a separate long-press.
//
// Explicit user_franchise_progress rows remain the second source: the visible
// watched set is the UNION of both. Watch history syncs across devices via
// userDataSync, so the derived half is consistent everywhere without extra
// writes. Structural types keep this module free of React Native imports.

type WatchedMediaSource = {
  id: number | string;
  sourceTmdbId: number | null;
  mediaType: string;
};

type FranchiseEntryLike = {
  id: string;
  tmdbId: number | null;
  mediaType: string;
};

type FranchiseProgressLike = {
  entryId: string;
};

function resolveTmdbId(entry: WatchedMediaSource): number | null {
  if (typeof entry.sourceTmdbId === "number" && Number.isFinite(entry.sourceTmdbId) && entry.sourceTmdbId > 0) {
    return entry.sourceTmdbId;
  }

  return typeof entry.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
}

/** One key per watched title: "movie:603" / "tv:1396". */
export function buildWatchedMediaKeySet(history: WatchedMediaSource[]): Set<string> {
  const keys = new Set<string>();

  for (const entry of history) {
    const tmdbId = resolveTmdbId(entry);
    if (tmdbId !== null) {
      keys.add(`${entry.mediaType}:${tmdbId}`);
    }
  }

  return keys;
}

/** Union of explicit franchise progress and watch-history-derived matches. */
export function collectWatchedFranchiseEntryIds(
  entries: FranchiseEntryLike[],
  progress: FranchiseProgressLike[],
  watchedMediaKeys: Set<string>
): Set<string> {
  const watchedIds = new Set(progress.map((item) => item.entryId));

  for (const entry of entries) {
    if (entry.tmdbId && watchedMediaKeys.has(`${entry.mediaType}:${entry.tmdbId}`)) {
      watchedIds.add(entry.id);
    }
  }

  return watchedIds;
}
