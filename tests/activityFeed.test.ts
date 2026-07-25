import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_GROUP_MIN,
  type ActivityEventType,
  type ActivityItem,
  activityFeedCursor,
  groupActivityFeed,
  mergeActivityPages,
} from "../src/utils/activityFeed";

let nextId = 1;
function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  const id = overrides.activityId ?? nextId++;
  return {
    activityId: id,
    actorId: "actor-a",
    username: "eshgin",
    displayName: "Eshgin",
    avatarPath: null,
    eventType: "watched",
    mediaType: "movie",
    tmdbId: 1000 + id,
    title: `Film ${id}`,
    posterPath: null,
    createdAt: new Date(1_750_000_000_000 - id * 1000).toISOString(),
    ...overrides,
  };
}

function run(actorId: string, eventType: ActivityEventType, count: number): ActivityItem[] {
  return Array.from({ length: count }, () => item({ actorId, eventType }));
}

test("a run below the threshold renders as singles", () => {
  const items = run("actor-a", "watched", ACTIVITY_GROUP_MIN - 1);
  const rows = groupActivityFeed(items);
  assert.equal(rows.length, ACTIVITY_GROUP_MIN - 1);
  assert.ok(rows.every((row) => row.kind === "single"));
});

test("a run at/above the threshold collapses into one group with the newest head", () => {
  const items = run("actor-a", "watched", 12);
  const rows = groupActivityFeed(items);
  assert.equal(rows.length, 1);
  const group = rows[0];
  assert.equal(group.kind, "group");
  if (group.kind === "group") {
    assert.equal(group.count, 12);
    assert.equal(group.items.length, 12);
    assert.equal(group.eventType, "watched");
    assert.equal(group.actorId, "actor-a");
    // Head is the newest (first) item.
    assert.equal(group.latestCreatedAt, items[0].createdAt);
  }
});

test("grouping only collapses CONSECUTIVE same-actor + same-type runs", () => {
  const items = [
    ...run("actor-a", "watched", 5), // group
    ...run("actor-b", "watched", 1), // single (different actor breaks the run)
    ...run("actor-a", "liked", 4), // group (different type)
    ...run("actor-a", "watched", 2), // singles (too short)
  ];
  const rows = groupActivityFeed(items);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["group", "single", "group", "single", "single"]
  );
});

test("interleaved actors never group", () => {
  const items = [
    item({ actorId: "a", eventType: "watched" }),
    item({ actorId: "b", eventType: "watched" }),
    item({ actorId: "a", eventType: "watched" }),
    item({ actorId: "b", eventType: "watched" }),
  ];
  const rows = groupActivityFeed(items);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.kind === "single"));
});

test("empty input yields no rows; custom minGroupSize honored", () => {
  assert.deepEqual(groupActivityFeed([]), []);
  const items = run("actor-a", "watched", 2);
  const rows = groupActivityFeed(items, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "group");
});

test("activityFeedCursor returns the oldest row's (createdAt, id)", () => {
  const items = [item({ activityId: 9 }), item({ activityId: 5 }), item({ activityId: 2 })];
  const cursor = activityFeedCursor(items);
  assert.deepEqual(cursor, { before: items[2].createdAt, beforeId: 2 });
  assert.equal(activityFeedCursor([]), null);
});

test("mergeActivityPages de-duplicates by activityId and preserves order", () => {
  const page1 = [item({ activityId: 1 }), item({ activityId: 2 })];
  const page2 = [item({ activityId: 2 }), item({ activityId: 3 })]; // 2 repeats at the boundary
  const merged = mergeActivityPages(page1, page2);
  assert.deepEqual(
    merged.map((i) => i.activityId),
    [1, 2, 3]
  );
  assert.equal(mergeActivityPages(page1, []), page1);
});
