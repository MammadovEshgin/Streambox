import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWatchedMediaKeySet,
  collectWatchedFranchiseEntryIds,
} from "../src/services/franchiseProgress";

const mcuEntries = [
  { id: "entry-iron-man", tmdbId: 1726, mediaType: "movie" },
  { id: "entry-avengers", tmdbId: 24428, mediaType: "movie" },
  { id: "entry-loki", tmdbId: 84958, mediaType: "tv" },
  { id: "entry-unreleased", tmdbId: null, mediaType: "movie" },
];

describe("franchiseProgress", () => {
  it("a manually logged movie marks its franchise entry watched", () => {
    const keys = buildWatchedMediaKeySet([
      { id: 1726, sourceTmdbId: 1726, mediaType: "movie" },
    ]);
    const watched = collectWatchedFranchiseEntryIds(mcuEntries, [], keys);
    assert.deepEqual([...watched], ["entry-iron-man"]);
  });

  it("a Letterboxd-imported entry (string id + sourceTmdbId) matches too", () => {
    const keys = buildWatchedMediaKeySet([
      { id: "letterboxd:the-avengers", sourceTmdbId: 24428, mediaType: "movie" },
    ]);
    const watched = collectWatchedFranchiseEntryIds(mcuEntries, [], keys);
    assert.deepEqual([...watched], ["entry-avengers"]);
  });

  it("falls back to a numeric id when sourceTmdbId is missing", () => {
    const keys = buildWatchedMediaKeySet([{ id: 84958, sourceTmdbId: null, mediaType: "tv" }]);
    const watched = collectWatchedFranchiseEntryIds(mcuEntries, [], keys);
    assert.deepEqual([...watched], ["entry-loki"]);
  });

  it("explicit franchise progress is kept (union, not replacement)", () => {
    const keys = buildWatchedMediaKeySet([
      { id: 1726, sourceTmdbId: 1726, mediaType: "movie" },
    ]);
    const watched = collectWatchedFranchiseEntryIds(
      mcuEntries,
      [{ entryId: "entry-loki" }],
      keys
    );
    assert.deepEqual([...watched].sort(), ["entry-iron-man", "entry-loki"]);
  });

  it("media type must match: a movie log never marks a tv entry", () => {
    const keys = buildWatchedMediaKeySet([{ id: 84958, sourceTmdbId: 84958, mediaType: "movie" }]);
    const watched = collectWatchedFranchiseEntryIds(mcuEntries, [], keys);
    assert.equal(watched.size, 0);
  });

  it("entries without a tmdbId and history rows without usable ids are ignored", () => {
    const keys = buildWatchedMediaKeySet([
      { id: "letterboxd:unmatched", sourceTmdbId: null, mediaType: "movie" },
    ]);
    assert.equal(keys.size, 0);
    const watched = collectWatchedFranchiseEntryIds(mcuEntries, [], keys);
    assert.equal(watched.size, 0);
  });
});
