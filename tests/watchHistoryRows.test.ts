import assert from "node:assert/strict";
import test from "node:test";

import { buildWatchHistorySyncArrays, clampIntOrNull } from "../src/utils/watchHistoryRows";

// Minimal entry factory — only the cast/director fields matter here.
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    mediaType: "movie",
    title: "X",
    watchedAt: 0,
    castIds: [],
    castNames: [],
    castProfilePaths: [],
    castGenders: [],
    directorIds: [],
    directorNames: [],
    directorProfilePaths: [],
    ...overrides,
  } as unknown as Parameters<typeof buildWatchHistorySyncArrays>[0];
}

function assertMatchingCardinality(arrays: ReturnType<typeof buildWatchHistorySyncArrays>) {
  const castLen = arrays.castIds.length;
  assert.equal(arrays.castNames.length, castLen);
  assert.equal(arrays.castProfilePaths.length, castLen);
  assert.equal(arrays.castGenders.length, castLen);
  const dirLen = arrays.directorIds.length;
  assert.equal(arrays.directorNames.length, dirLen);
  assert.equal(arrays.directorProfilePaths.length, dirLen);
}

test("cast arrays keep matching cardinality even when genders are missing (the import bug)", () => {
  // 3 cast, but only 1 known gender — the old code filtered nulls and shrank
  // the gender array, violating the DB cardinality CHECK and failing the upsert.
  const arrays = buildWatchHistorySyncArrays(
    entry({
      castIds: [10, 20, 30],
      castNames: ["A", "B", "C"],
      castProfilePaths: ["/a.jpg", null, "/c.jpg"],
      castGenders: ["female", null, null],
    })
  );
  assertMatchingCardinality(arrays);
  assert.deepEqual(arrays.castGenders, ["female", null, null]);
});

test("unknown / invalid gender values become null, never a foreign value", () => {
  const arrays = buildWatchHistorySyncArrays(
    entry({ castIds: [1, 2], castGenders: ["male", "non-binary"] })
  );
  assert.deepEqual(arrays.castGenders, ["male", null]);
});

test("caps cast and director arrays at 5 entries", () => {
  const arrays = buildWatchHistorySyncArrays(
    entry({
      castIds: [1, 2, 3, 4, 5, 6, 7],
      castNames: ["a", "b", "c", "d", "e", "f", "g"],
      directorIds: [1, 2, 3, 4, 5, 6],
    })
  );
  assert.equal(arrays.castIds.length, 5);
  assert.equal(arrays.directorIds.length, 5);
  assertMatchingCardinality(arrays);
});

test("pads short name/path arrays so cardinality holds", () => {
  const arrays = buildWatchHistorySyncArrays(
    entry({ castIds: [1, 2, 3], castNames: ["only-one"], castProfilePaths: [] })
  );
  assertMatchingCardinality(arrays);
  assert.deepEqual(arrays.castNames, ["only-one", "", ""]);
  assert.deepEqual(arrays.castProfilePaths, [null, null, null]);
});

test("drops non-numeric cast ids while keeping arrays aligned", () => {
  const arrays = buildWatchHistorySyncArrays(
    entry({ castIds: [1, "bad", 3] as unknown[], castNames: ["a", "b", "c"] })
  );
  assert.deepEqual(arrays.castIds, [1, 3]);
  assertMatchingCardinality(arrays);
});

test("clampIntOrNull keeps in-range values and nulls the rest", () => {
  assert.equal(clampIntOrNull(2021, 1878, 2100), 2021);
  assert.equal(clampIntOrNull("2021", 1878, 2100), 2021);
  assert.equal(clampIntOrNull(1700, 1878, 2100), null);
  assert.equal(clampIntOrNull(3000, 1878, 2100), null);
  assert.equal(clampIntOrNull("", 1878, 2100), null);
  assert.equal(clampIntOrNull(undefined, 1, 5000), null);
  assert.equal(clampIntOrNull(120.6, 1, 5000), 121);
});
