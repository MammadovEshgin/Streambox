import assert from "node:assert/strict";
import test from "node:test";

import {
  getDayNumber,
  getRecentlyPickedIds,
  parseRecentPicks,
  pickRotatingIndex,
  withRecentPick,
} from "../src/utils/dailyRotation";

const SEED = "movie:2f8c1a7e-0000-4000-8000-000000000001";

function datesFrom(startIso: string, days: number): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start.getTime() + offset * 86_400_000);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

test("consecutive days NEVER land on the same shortlist entry", () => {
  // The whole point of the fix: the hero was "stuck on one movie" because a
  // hash-modulo pick can repeat across days. Over a full year, on every
  // shortlist size the app can produce, today and tomorrow must differ.
  for (let length = 2; length <= 12; length += 1) {
    const dates = datesFrom("2026-01-01", 365);
    for (let index = 1; index < dates.length; index += 1) {
      const yesterday = pickRotatingIndex(length, dates[index - 1], SEED);
      const today = pickRotatingIndex(length, dates[index], SEED);
      assert.notEqual(
        today,
        yesterday,
        `length ${length}: ${dates[index - 1]} and ${dates[index]} both picked ${today}`
      );
    }
  }
});

test("the same day always returns the same entry", () => {
  // Re-running the pick mid-day (language switch, cache eviction, app restart)
  // must not move the hero.
  assert.equal(pickRotatingIndex(6, "2026-08-10", SEED), pickRotatingIndex(6, "2026-08-10", SEED));
});

test("a full cycle of days visits every shortlist entry exactly once", () => {
  const length = 6;
  const seen = datesFrom("2026-03-01", length).map((date) => pickRotatingIndex(length, date, SEED));
  assert.equal(new Set(seen).size, length, `expected all ${length} entries, got ${seen.join(",")}`);
});

test("different users get different titles on the same day", () => {
  const date = "2026-08-10";
  const indexes = new Set(
    ["user-a", "user-b", "user-c", "user-d", "user-e", "user-f"].map((user) =>
      pickRotatingIndex(6, date, `movie:${user}`)
    )
  );
  assert.ok(indexes.size > 1, "a per-user offset must actually separate accounts");
});

test("degenerate shortlists are handled without throwing", () => {
  assert.equal(pickRotatingIndex(1, "2026-08-10", SEED), 0);
  assert.equal(pickRotatingIndex(0, "2026-08-10", SEED), 0);
  // A malformed date key must still produce a usable index, not NaN.
  const index = pickRotatingIndex(6, "not-a-date", SEED);
  assert.ok(Number.isInteger(index) && index >= 0 && index < 6);
});

test("day numbers advance by exactly one per calendar day, across month ends", () => {
  assert.equal(getDayNumber("2026-03-01") - getDayNumber("2026-02-28"), 1);
  assert.equal(getDayNumber("2027-01-01") - getDayNumber("2026-12-31"), 1);
  // 2028 is a leap year.
  assert.equal(getDayNumber("2028-03-01") - getDayNumber("2028-02-29"), 1);
});

test("recent picks keep a bounded, de-duplicated history", () => {
  let history = parseRecentPicks(null);
  assert.deepEqual(history, []);

  history = withRecentPick(history, "2026-08-08", 11, 3);
  history = withRecentPick(history, "2026-08-09", 22, 3);
  history = withRecentPick(history, "2026-08-10", 33, 3);
  history = withRecentPick(history, "2026-08-11", 44, 3);
  assert.deepEqual(
    history.map((entry) => entry.id),
    [44, 33, 22],
    "history must stay at the limit, newest first"
  );

  // Re-picking within the same day replaces that day's entry, never appends.
  history = withRecentPick(history, "2026-08-11", 55, 3);
  assert.deepEqual(history.map((entry) => entry.id), [55, 33, 22]);
});

test("the exclusion set covers previous days but never today", () => {
  const history = [
    { dateKey: "2026-08-10", id: 33 },
    { dateKey: "2026-08-09", id: 22 },
  ];
  assert.deepEqual(getRecentlyPickedIds(history, "2026-08-10"), [22]);
  assert.deepEqual(getRecentlyPickedIds(history, "2026-08-11"), [33, 22]);
});

test("malformed stored history is discarded rather than trusted", () => {
  const parsed = parseRecentPicks([
    { dateKey: "2026-08-10", id: 33 },
    { dateKey: "2026-08-09" },
    { id: 22 },
    null,
    "nonsense",
    { dateKey: "2026-08-08", id: Number.NaN },
  ]);
  assert.deepEqual(parsed, [{ dateKey: "2026-08-10", id: 33 }]);
});
