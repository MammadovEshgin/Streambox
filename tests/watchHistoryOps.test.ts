import assert from "node:assert/strict";
import test from "node:test";

import { applyWatchHistoryOps, type WatchHistoryListOp } from "../src/utils/watchHistoryOps";
import type { WatchHistoryEntry } from "../src/hooks/useWatchHistory";

// Minimal entry factory — only identity + kind fields matter for op application.
function entry(overrides: Partial<WatchHistoryEntry> = {}): WatchHistoryEntry {
  return {
    id: 1,
    sourceTmdbId: 1,
    mediaType: "movie",
    historyKind: "title",
    seasonNumber: null,
    title: "X",
    posterPath: null,
    genres: [],
    runtimeMinutes: null,
    episodeCount: null,
    voteAverage: 0,
    year: "",
    castIds: [],
    castNames: [],
    castProfilePaths: [],
    castGenders: [],
    directorIds: [],
    directorNames: [],
    directorProfilePaths: [],
    watchedAt: 0,
    watchPrecision: "day",
    metadataVersion: 5,
    ...overrides,
  } as WatchHistoryEntry;
}

function seasonEntry(seriesId: number, seasonNumber: number): WatchHistoryEntry {
  return entry({
    id: `series-season:${seriesId}:${seasonNumber}`,
    sourceTmdbId: seriesId,
    mediaType: "tv",
    historyKind: "season",
    seasonNumber,
    title: `Series ${seriesId} - Season ${seasonNumber}`,
  });
}

test("a TV season batch never touches movie entries (the vanished-movies regression)", () => {
  // The bug: saving Game of Thrones seasons wiped all watched MOVIES because
  // the old sync pruned every row missing from the (possibly partial) list it
  // was handed. The batch op application must be surgical: only entries whose
  // (id, mediaType) an op explicitly targets may change.
  const movie1 = entry({ id: 27205, title: "Inception", watchedAt: 100 });
  const movie2 = entry({ id: 155, title: "The Dark Knight", watchedAt: 200 });
  const current = [movie1, movie2];

  const got = 1399;
  const ops: WatchHistoryListOp[] = [
    { kind: "upsert", entry: seasonEntry(got, 1) },
    { kind: "upsert", entry: seasonEntry(got, 2) },
    { kind: "upsert", entry: seasonEntry(got, 3) },
    { kind: "upsert", entry: entry({ id: got, mediaType: "tv", title: "Game of Thrones", watchPrecision: "none" }) },
  ];

  const next = applyWatchHistoryOps(current, ops);

  // Both movies survive untouched (same object references — not rebuilt).
  assert.ok(next.includes(movie1), "Inception must survive a TV batch");
  assert.ok(next.includes(movie2), "The Dark Knight must survive a TV batch");
  // All three seasons AND the title entry landed in one batch.
  assert.equal(next.filter((e) => e.mediaType === "tv" && e.historyKind === "season").length, 3);
  assert.equal(next.filter((e) => e.mediaType === "tv" && e.historyKind === "title").length, 1);
  assert.equal(next.length, 6);
});

test("removals only touch the targeted (id, mediaType) pair", () => {
  // A movie and a series can share the same numeric TMDB id — removing the
  // series must not collaterally remove the movie.
  const movie = entry({ id: 500, mediaType: "movie", title: "Reservoir Dogs" });
  const series = entry({ id: 500, mediaType: "tv", title: "Some Series" });

  const next = applyWatchHistoryOps(
    [movie, series],
    [{ kind: "remove", id: 500, mediaType: "tv" }]
  );

  assert.deepEqual(next, [movie]);
});

test("upsert replaces an existing entry with the same identity instead of duplicating", () => {
  const original = seasonEntry(1399, 1);
  const updated = { ...seasonEntry(1399, 1), watchPrecision: "month" as const, watchedAt: 999 };

  const next = applyWatchHistoryOps([original], [{ kind: "upsert", entry: updated }]);

  assert.equal(next.length, 1);
  assert.equal(next[0].watchPrecision, "month");
  assert.equal(next[0].watchedAt, 999);
});

test("mixed batch applies removals and upserts in order over the same list", () => {
  // Season 1 unmarked, seasons 2..3 saved, title kept — one pass.
  const got = 1399;
  const current = [
    seasonEntry(got, 1),
    entry({ id: 27205, title: "Inception" }),
  ];

  const next = applyWatchHistoryOps(current, [
    { kind: "remove", id: `series-season:${got}:1`, mediaType: "tv" },
    { kind: "upsert", entry: seasonEntry(got, 2) },
    { kind: "upsert", entry: seasonEntry(got, 3) },
  ]);

  assert.equal(next.some((e) => e.id === `series-season:${got}:1`), false);
  assert.equal(next.some((e) => e.id === `series-season:${got}:2`), true);
  assert.equal(next.some((e) => e.id === `series-season:${got}:3`), true);
  assert.equal(next.some((e) => e.id === 27205 && e.mediaType === "movie"), true);
});

test("an empty batch is a no-op", () => {
  const movie = entry({ id: 27205 });
  const next = applyWatchHistoryOps([movie], []);
  assert.deepEqual(next, [movie]);
});
