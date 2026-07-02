import type { MediaType } from "../api/tmdb";
import type { WatchHistoryEntry } from "../hooks/useWatchHistory";

// Pure helpers for applying a batch of watch-history mutations to the local
// entry list. Extracted from useWatchHistory so the invariant that caused the
// movies-vanished bug — a TV save must never drop unrelated (movie) entries —
// can be unit-tested without React or AsyncStorage.

export type WatchHistoryListOp =
  | { kind: "upsert"; entry: WatchHistoryEntry }
  | { kind: "remove"; id: number | string; mediaType: MediaType };

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
