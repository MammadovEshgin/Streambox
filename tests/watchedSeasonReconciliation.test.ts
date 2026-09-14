import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { deriveStableUuidFromKey } from "../src/utils/uuid";
import { buildSeriesSeasonInternalId } from "../src/utils/watchHistoryOps";
import {
  buildEpisodeKey,
  hasAnyEpisodeWatched,
  isSeasonFullyWatched,
} from "../src/utils/watchedEpisodes";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const rootPath = path.resolve(process.cwd());
const userDataSyncPath = path.join(rootPath, "src", "services", "userDataSync.ts");

// ---------------------------------------------------------------------------
// Season watch-history entries were invisible in the Profile watched list for
// two independent reasons, both locked down here:
//
//  1. Their id ("series-season:1399:1") was sent to Supabase's `internal_id`,
//     a uuid column. Postgres rejected every write, the op was re-queued
//     forever, and production ended up with 2327 watch-history rows of which
//     ZERO were seasons.
//  2. Ticking episodes only touched the episode map, so a season could read as
//     watched on SeriesDetail while watch history — what Profile lists — had
//     no entry for it at all.
// ---------------------------------------------------------------------------

test("season ids hash to a valid uuid so Supabase accepts internal_id", () => {
  const seasonId = buildSeriesSeasonInternalId(1399, 1);
  assert.equal(seasonId, "series-season:1399:1");

  const derived = deriveStableUuidFromKey(seasonId);
  assert.match(derived, UUID_SHAPE, "internal_id must satisfy the uuid column type");
});

test("the derived uuid is stable, so upserts dedupe across devices and reinstalls", () => {
  const key = buildSeriesSeasonInternalId(1399, 2);
  assert.equal(deriveStableUuidFromKey(key), deriveStableUuidFromKey(key));
});

test("different seasons and different series never collide", () => {
  const ids = [
    buildSeriesSeasonInternalId(1399, 1),
    buildSeriesSeasonInternalId(1399, 2),
    buildSeriesSeasonInternalId(1400, 1),
    buildSeriesSeasonInternalId(94997, 1),
  ].map(deriveStableUuidFromKey);

  assert.equal(new Set(ids).size, ids.length);
});

test("getSyncIds hashes non-uuid string ids instead of sending them raw", () => {
  const source = fs.readFileSync(userDataSyncPath, "utf8");

  assert.equal(
    /return \{ tmdb_id: null, internal_id: sId \};\s*\n\}/.test(source),
    false,
    "a raw composite string must never be sent to the uuid internal_id column"
  );
  assert.ok(
    source.includes("internal_id: deriveStableUuidFromKey(sId)"),
    "non-uuid string ids must be hashed into a stable uuid"
  );
});

test("remote season rows are rebuilt under their readable local id, not the hash", () => {
  const source = fs.readFileSync(userDataSyncPath, "utf8");

  assert.ok(
    source.includes("rebuildLocalWatchHistoryId"),
    "remote rows must map back to the canonical local season id"
  );
  assert.ok(
    source.includes("buildSeriesSeasonInternalId(seriesId, seasonNumber)"),
    "the rebuild must reuse the shared id builder so the formats cannot drift"
  );
});

test("a season counts as watched only when every episode is ticked", () => {
  const state = {
    [buildEpisodeKey(1399, 1, 1)]: true,
    [buildEpisodeKey(1399, 1, 2)]: true,
  };

  assert.equal(isSeasonFullyWatched(state, 1399, 1, 2), true);
  assert.equal(isSeasonFullyWatched(state, 1399, 1, 3), false);
  assert.equal(hasAnyEpisodeWatched(state, 1399, 1, 3), true);
});

test("a season with no known episode count never auto-logs itself", () => {
  // Guards against a series whose episode counts haven't loaded yet silently
  // writing a "watched" entry for an empty season.
  assert.equal(isSeasonFullyWatched({}, 1399, 1, 0), false);
  assert.equal(isSeasonFullyWatched({}, 1399, 1, Number.NaN), false);
});

test("episode keys match the format the sync layer splits on", () => {
  // userDataSync rebuilds rows by splitting this key on "_" into exactly three
  // parts; a format change here would silently drop episode progress.
  const key = buildEpisodeKey(1399, 2, 10);
  assert.equal(key, "1399_2_10");
  assert.equal(key.split("_").length, 3);
});
