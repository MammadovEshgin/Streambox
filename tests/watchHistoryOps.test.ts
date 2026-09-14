import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWatchHistoryOps,
  buildSeriesSeasonInternalId,
  collectWatchlistPruneRequests,
  type WatchHistoryListOp,
  type WatchHistoryMutation,
} from "../src/utils/watchHistoryOps";
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

// ---------------------------------------------------------------------------
// A watched title leaves the watchlist.
//
// The watchlist answers "what do I still want to see?". Keeping a film there
// after it had been watched meant every one had to be removed by hand, and the
// profile count kept climbing past titles the viewer had already seen.
// ---------------------------------------------------------------------------

test("logging a movie as watched asks for it to leave the watchlist", () => {
  const mutations: WatchHistoryMutation[] = [
    { kind: "upsert", entry: entry({ id: 550, sourceTmdbId: 550 }), auditDetails: { title: "Fight Club" } },
  ];

  assert.deepEqual(collectWatchlistPruneRequests(mutations), [
    { mediaType: "movie", tmdbId: 550, details: { title: "Fight Club" } },
  ]);
});

test("a season entry resolves to the SERIES id, not its synthetic key", () => {
  // Season rows store "series-season:<seriesId>:<n>" as their id; the watchlist
  // is keyed by the series' own TMDB id.
  const seasonId = buildSeriesSeasonInternalId(1396, 2);
  const mutations: WatchHistoryMutation[] = [
    {
      kind: "upsert",
      entry: entry({ id: seasonId, sourceTmdbId: 1396, mediaType: "tv", historyKind: "season", seasonNumber: 2 }),
    },
  ];

  assert.deepEqual(collectWatchlistPruneRequests(mutations), [
    { mediaType: "tv", tmdbId: 1396, details: null },
  ]);
});

test("un-marking something watched does not put it back on the watchlist", () => {
  const mutations: WatchHistoryMutation[] = [
    { kind: "remove", id: 550, mediaType: "movie" },
  ];
  assert.deepEqual(collectWatchlistPruneRequests(mutations), []);
});

test("a season batch asks for one removal per series, not per season", () => {
  // The season modal saves every season plus the series title in one batch.
  const mutations: WatchHistoryMutation[] = [
    { kind: "upsert", entry: entry({ id: buildSeriesSeasonInternalId(1396, 1), sourceTmdbId: 1396, mediaType: "tv", historyKind: "season" }) },
    { kind: "upsert", entry: entry({ id: buildSeriesSeasonInternalId(1396, 2), sourceTmdbId: 1396, mediaType: "tv", historyKind: "season" }) },
    { kind: "upsert", entry: entry({ id: 1396, sourceTmdbId: 1396, mediaType: "tv", historyKind: "title" }) },
  ];

  assert.deepEqual(collectWatchlistPruneRequests(mutations), [
    { mediaType: "tv", tmdbId: 1396, details: null },
  ]);
});

test("a movie and a series with the same id are tracked separately", () => {
  const mutations: WatchHistoryMutation[] = [
    { kind: "upsert", entry: entry({ id: 42, sourceTmdbId: 42, mediaType: "movie" }) },
    { kind: "upsert", entry: entry({ id: 42, sourceTmdbId: 42, mediaType: "tv" }) },
  ];

  assert.deepEqual(collectWatchlistPruneRequests(mutations).map((r) => r.mediaType), ["movie", "tv"]);
});

test("an entry with no TMDB id is skipped rather than removing a bogus row", () => {
  const mutations: WatchHistoryMutation[] = [
    { kind: "upsert", entry: entry({ id: "letterboxd-abc", sourceTmdbId: null }) },
  ];
  assert.deepEqual(collectWatchlistPruneRequests(mutations), []);
});
