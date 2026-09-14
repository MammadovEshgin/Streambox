import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem } from "../src/api/tmdb";
import {
  applyShelfFilters,
  buildHydratedShelfRecords,
  parseSortableYear,
  toNewestFirstIds,
  type ProfileShelfRecord,
} from "../src/utils/profileShelf";

function movie(title: string, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id: title,
    title,
    posterPath: null,
    backdropPath: null,
    rating: 7,
    overview: "",
    year: "2020",
    mediaType: "movie",
    ...extra,
  } as MediaItem;
}

// ---------------------------------------------------------------------------
// "Recently added" showed the oldest bookmarks first.
//
// Stored watchlist/liked lists are append-ordered: `[...list, id]`. The screens
// reverse them into display order, and the sort then walks that order forwards.
// ---------------------------------------------------------------------------

test("a stored id list reads newest-first once reversed", () => {
  // Saved oldest → newest, which is the order AsyncStorage holds.
  assert.deepEqual(toNewestFirstIds([101, 202, 303]), [303, 202, 101]);
  // Non-destructive: the caller's array is untouched.
  const stored = [1, 2, 3];
  toNewestFirstIds(stored);
  assert.deepEqual(stored, [1, 2, 3]);
});

test("recently added puts the newest bookmark first", () => {
  const storedIds = ["oldest", "middle", "newest"];
  const displayOrder = toNewestFirstIds(storedIds);
  const records = buildHydratedShelfRecords(displayOrder.map((id) => movie(id)));

  const sorted = applyShelfFilters(records, { sortBy: "recent", genre: null });
  assert.deepEqual(sorted.map((item) => item.title), ["newest", "middle", "oldest"]);
});

test("watched items still sort by when they were watched", () => {
  const records: ProfileShelfRecord[] = [
    { item: movie("seen first"), order: 0, watchedAt: 1_000, genres: [] },
    { item: movie("seen last"), order: 1, watchedAt: 9_000, genres: [] },
    { item: movie("seen middle"), order: 2, watchedAt: 5_000, genres: [] },
  ];

  const sorted = applyShelfFilters(records, { sortBy: "recent", genre: null });
  assert.deepEqual(sorted.map((item) => item.title), ["seen last", "seen middle", "seen first"]);
});

test("watched items with identical timestamps keep their list order", () => {
  const records: ProfileShelfRecord[] = [
    { item: movie("a"), order: 0, watchedAt: 5_000, genres: [] },
    { item: movie("b"), order: 1, watchedAt: 5_000, genres: [] },
  ];
  assert.deepEqual(
    applyShelfFilters(records, { sortBy: "recent", genre: null }).map((item) => item.title),
    ["a", "b"]
  );
});

// ---------------------------------------------------------------------------
// The other sorts.
// ---------------------------------------------------------------------------

test("an undated title sorts last by year instead of poisoning the comparator", () => {
  // `Number("----")` is NaN, and a comparator that returns NaN leaves the whole
  // list in an arbitrary order — not just the undated entry.
  assert.equal(parseSortableYear("----"), 0);
  assert.equal(parseSortableYear(undefined), 0);
  assert.equal(parseSortableYear("1968"), 1968);

  const records = buildHydratedShelfRecords([
    movie("undated", { year: "----" }),
    movie("old", { year: "1968" }),
    movie("new", { year: "2024" }),
  ]);

  assert.deepEqual(
    applyShelfFilters(records, { sortBy: "year", genre: null }).map((item) => item.title),
    ["new", "old", "undated"]
  );
});

test("highest rated sorts descending", () => {
  const records = buildHydratedShelfRecords([
    movie("mid", { rating: 6.5 }),
    movie("best", { rating: 9.1 }),
    movie("worst", { rating: 3.2 }),
  ]);
  assert.deepEqual(
    applyShelfFilters(records, { sortBy: "rating", genre: null }).map((item) => item.title),
    ["best", "mid", "worst"]
  );
});

test("title sort is alphabetical", () => {
  const records = buildHydratedShelfRecords([movie("Zodiac"), movie("Amelie"), movie("Memento")]);
  assert.deepEqual(
    applyShelfFilters(records, { sortBy: "title", genre: null }).map((item) => item.title),
    ["Amelie", "Memento", "Zodiac"]
  );
});

test("a genre filter narrows the list without disturbing the order", () => {
  const records: ProfileShelfRecord[] = [
    { item: movie("newest horror"), order: 0, genres: ["Horror"] },
    { item: movie("a drama"), order: 1, genres: ["Drama"] },
    { item: movie("older horror"), order: 2, genres: ["Horror", "Drama"] },
  ];

  assert.deepEqual(
    applyShelfFilters(records, { sortBy: "recent", genre: "Horror" }).map((item) => item.title),
    ["newest horror", "older horror"]
  );
});

test("filtering never mutates the records it was handed", () => {
  const records = buildHydratedShelfRecords([movie("b"), movie("a")]);
  applyShelfFilters(records, { sortBy: "title", genre: null });
  assert.deepEqual(records.map((record) => record.item.title), ["b", "a"]);
});
