import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Source-level locks for the watch-history sync architecture. The old design
// let every single upsert/remove trigger a full "replace remote with the
// in-memory list and DELETE everything else" sync — one stale list and all
// watched movies were pruned from Supabase. These tests fail if that pattern
// (or the blocking per-entry network sync) is ever reintroduced.

const rootPath = path.resolve(process.cwd());
const useWatchHistoryPath = path.join(rootPath, "src", "hooks", "useWatchHistory.ts");
const useWatchedEpisodesPath = path.join(rootPath, "src", "hooks", "useWatchedEpisodes.ts");
const userDataSyncPath = path.join(rootPath, "src", "services", "userDataSync.ts");
const seriesDetailScreenPath = path.join(rootPath, "src", "screens", "SeriesDetailScreen.tsx");

test("useWatchHistory persists locally and syncs only through the durable queue", () => {
  const source = fs.readFileSync(useWatchHistoryPath, "utf8");

  // The mutation path must not reference the full-replace prune sync at all.
  assert.equal(
    source.includes("syncCurrentWatchHistoryToSupabase"),
    false,
    "useWatchHistory must not call the full-replace watch-history sync"
  );
  // Supabase writes flow through the debounced queue batch.
  assert.equal(source.includes("enqueueWatchHistoryBatch"), true);
  // Mutations must be guarded against running from a stale, unloaded list.
  assert.equal(source.includes("hasLoadedRef"), true);
  assert.equal(source.includes("readEntriesFromStorage"), true);
});

test("userDataSync no longer exposes a full-replace-with-prune watch-history sync", () => {
  const source = fs.readFileSync(userDataSyncPath, "utf8");

  assert.equal(
    source.includes("export async function syncCurrentWatchHistoryToSupabase"),
    false,
    "the prune-style full sync must stay deleted"
  );
  // No direct DELETE against user_watch_history: remote deletions go through
  // the explicit per-entry RPC (delete_streambox_watch_history_entry) only.
  const deletesWatchHistoryTable = /from\(\s*["']user_watch_history["']\s*\)\s*\.delete/.test(source);
  assert.equal(
    deletesWatchHistoryTable,
    false,
    "user_watch_history rows must only be deleted via the per-entry RPC"
  );
  assert.equal(source.includes("delete_streambox_watch_history_entry"), true);
  // Batch enqueues exist so a multi-season save is one queue write.
  assert.equal(source.includes("export async function enqueueWatchHistoryBatch"), true);
  assert.equal(source.includes("export async function enqueueEpisodeProgressBatch"), true);
});

test("season-log confirm commits one batched save instead of a per-season awaited loop", () => {
  const source = fs.readFileSync(seriesDetailScreenPath, "utf8");

  assert.equal(source.includes("saveSeriesWatchedBatch"), true);
  assert.equal(source.includes("applySeasonEpisodeStates"), true);
});

test("watched-episodes hook batches season-level sync ops", () => {
  const source = fs.readFileSync(useWatchedEpisodesPath, "utf8");
  assert.equal(source.includes("enqueueEpisodeProgressBatch"), true);
});
