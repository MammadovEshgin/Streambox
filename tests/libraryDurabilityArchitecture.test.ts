import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Source-level locks for the library durability fix (watched / watchlist /
// liked "disappearing"). Each test names the regression it guards.

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

const LIBRARY_KEY_NAMES = [
  "WATCH_HISTORY_STORAGE_KEY",
  "WATCHLIST_STORAGE_KEY",
  "SERIES_WATCHLIST_STORAGE_KEY",
  "LIKED_MOVIES_STORAGE_KEY",
  "LIKED_SERIES_STORAGE_KEY",
  "WATCHED_EPISODES_STORAGE_KEY",
  "SYNC_QUEUE_STORAGE_KEY",
];

test("library documents never go through AsyncStorage directly (2 MB read limit, 6 MB database cap)", () => {
  const files = [
    ["src", "hooks", "useWatchHistory.ts"],
    ["src", "hooks", "useSyncedMediaIdList.ts"],
    ["src", "hooks", "useWatchedEpisodes.ts"],
    ["src", "services", "mediaListStore.ts"],
    ["src", "services", "letterboxdImportService.ts"],
    ["src", "services", "userDataSync.ts"],
  ];
  for (const parts of files) {
    const source = read(...parts);
    for (const keyName of LIBRARY_KEY_NAMES) {
      const direct = new RegExp(`AsyncStorage\\.(getItem|setItem|removeItem)\\(\\s*${keyName}\\b`);
      assert.equal(direct.test(source), false, `${parts.join("/")} reads/writes ${keyName} through AsyncStorage`);
    }
  }
  const storage = read("src", "services", "userDataStorage.ts");
  for (const keyName of LIBRARY_KEY_NAMES) {
    assert.match(storage, new RegExp(`DURABLE_LIBRARY_STORAGE_KEYS = \\[[\\s\\S]*?${keyName}`), `${keyName} must be a durable key`);
  }
});

test("list writers queue their sync op inside the same lock as the local write", () => {
  const hook = read("src", "hooks", "useSyncedMediaIdList.ts");
  assert.match(hook, /withMediaListMutationLock\(storageKey, async \(\) => \{[\s\S]*?libraryStorage\.setItem[\s\S]*?await enqueueMediaLibrarySync[\s\S]*?\}\);/);
  const store = read("src", "services", "mediaListStore.ts");
  assert.match(store, /withMediaListMutationLock\(storageKey, async \(\) => \{[\s\S]*?libraryStorage\.setItem[\s\S]*?await enqueueMediaLibraryBatch[\s\S]*?return changed;/);
  const episodes = read("src", "hooks", "useWatchedEpisodes.ts");
  assert.match(episodes, /withLibraryLock\(WATCHED_EPISODES_STORAGE_KEY, async \(\) => \{[\s\S]*?libraryStorage\.setItem[\s\S]*?await enqueueEpisodeProgressBatch/);
  // Episode writes start from the STORED map, never the hook's copy.
  assert.equal(episodes.includes("{ ...watchedEpisodesRef.current }"), false);
});

test("every launch and foreground reconciles the library with the cloud", () => {
  const context = read("src", "context", "UserDataSyncContext.tsx");
  assert.equal((context.match(/reconcileUserLibraryWithCloud\(userId\)/g) ?? []).length, 2);
  const sync = read("src", "services", "userDataSync.ts");
  // The bootstrap no longer writes whole lists computed before its download.
  assert.equal(sync.includes("writeLocalUserSnapshot("), false);
  assert.match(sync, /runLibraryReconcile\(uid, fetchRemoteBootstrap\)/);
  // Flushes can't land between the download and the merge.
  assert.match(sync, /flushPromise = withSyncExclusive\(/);
  assert.match(sync, /function runLibraryReconcile[\s\S]*?withSyncExclusive\(async \(\) => \{\s*const remote = await fetchRemote\(\);/);
});

test("Cinematic Journeys logs to watch history first, with an offline fallback", () => {
  const screen = read("src", "screens", "FranchiseTimelineScreen.tsx");
  const handler = screen.slice(screen.indexOf("const handleLongPressEntry"));
  const historyAt = handler.indexOf("saveFallbackToWatchHistory(");
  const progressAt = handler.indexOf("toggleFranchiseEntryWatched(");
  assert.ok(historyAt > 0 && progressAt > historyAt, "watch history must be saved before the network progress write");
  assert.equal(handler.includes("watch history sync is best-effort"), false);
});

test("the player's auto-mark logs a fallback entry when details can't be fetched", () => {
  const hook = read("src", "hooks", "useAutoMarkWatched.ts");
  assert.match(hook, /saveFallbackToWatchHistory/);
  assert.match(hook, /withTimeout\(getMovieDetails/);
  const player = read("src", "screens", "PlayerScreen.tsx");
  assert.match(player, /useAutoMarkWatched\(\{[\s\S]{0,400}?title: route\.params\.title/);
});
