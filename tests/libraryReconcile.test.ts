import assert from "node:assert/strict";
import test from "node:test";

import { reconcileCollection, type PendingIntent } from "../src/utils/libraryReconcile";
import { tmdbPosterPathFromUrl, withTimeout } from "../src/utils/watchLogging";

const key = (id: number) => String(id);
const noPending = new Map<string, PendingIntent>();

test("first reconcile on a device (no base) is a union: restores cloud items, uploads local-only, removes nothing", () => {
  const result = reconcileCollection<number>({ local: [1, 2], remote: [2, 3], keyOf: key, base: null, pending: noPending });
  assert.deepEqual(result.items, [1, 2, 3]);
  assert.deepEqual(result.restoredKeys, ["3"]);
  assert.deepEqual(result.localOnlyKeys, ["1"]);
  assert.deepEqual(result.removedKeys, []);
  assert.equal(result.changed, true);
});

test("a title lost locally but still in the cloud comes back (the disappearing-watched bug)", () => {
  const result = reconcileCollection<number>({ local: [], remote: [10, 11, 12], keyOf: key, base: new Set(["10", "11", "12"]), pending: noPending });
  assert.deepEqual(result.items, [10, 11, 12]);
  assert.equal(result.removedKeys.length, 0);
});

test("an item deleted on another device is removed here", () => {
  const result = reconcileCollection<number>({ local: [1, 2, 3], remote: [1, 2], keyOf: key, base: new Set(["1", "2", "3"]), pending: noPending });
  assert.deepEqual(result.items, [1, 2]);
  assert.deepEqual(result.removedKeys, ["3"]);
});

test("a local item the cloud has never seen is kept and reported for upload, not deleted", () => {
  const result = reconcileCollection<number>({ local: [1, 4], remote: [1], keyOf: key, base: new Set(["1"]), pending: noPending });
  assert.deepEqual(result.items, [1, 4]);
  assert.deepEqual(result.localOnlyKeys, ["4"]);
});

test("pending queue ops win: a queued delete stays deleted, a queued add stays", () => {
  const pending = new Map<string, PendingIntent>([["2", "delete"], ["5", "upsert"]]);
  const result = reconcileCollection<number>({ local: [1, 5], remote: [1, 2], keyOf: key, base: new Set(["1", "2", "5"]), pending });
  assert.deepEqual(result.items, [1, 5]);
  assert.deepEqual(result.restoredKeys, []);
  assert.deepEqual(result.localOnlyKeys, [], "a pending upsert is already queued; it isn't re-sent");
});

test("a suspiciously large deletion is suppressed: a bad cloud answer can't wipe a library", () => {
  const local = Array.from({ length: 40 }, (_, i) => i + 1);
  const result = reconcileCollection<number>({ local, remote: [1, 2], keyOf: key, base: new Set(local.map(key)), pending: noPending });
  assert.equal(result.removalsSuppressed, true);
  assert.equal(result.items.length, 40);
  assert.deepEqual(result.removedKeys, []);
});

test("small deletions are not suppressed", () => {
  const result = reconcileCollection<number>({ local: [1, 2, 3, 4], remote: [1, 2, 3], keyOf: key, base: new Set(["1", "2", "3", "4"]), pending: noPending });
  assert.equal(result.removalsSuppressed, false);
  assert.deepEqual(result.removedKeys, ["4"]);
});

test("mergeBoth decides an item both sides hold, and duplicates collapse", () => {
  type Entry = { id: number; watchedAt: number };
  const result = reconcileCollection<Entry>({
    local: [{ id: 1, watchedAt: 10 }, { id: 1, watchedAt: 10 }],
    remote: [{ id: 1, watchedAt: 20 }],
    keyOf: (e) => String(e.id),
    base: null,
    pending: noPending,
    mergeBoth: (local, remote) => ({ ...local, watchedAt: remote.watchedAt }),
  });
  assert.deepEqual(result.items, [{ id: 1, watchedAt: 20 }]);
  assert.equal(result.changed, true);
});

test("nothing changes when local already matches the cloud", () => {
  const result = reconcileCollection<number>({ local: [1, 2], remote: [2, 1], keyOf: key, base: new Set(["1", "2"]), pending: noPending });
  assert.equal(result.changed, false);
  assert.deepEqual(result.items, [1, 2]);
});

test("tmdbPosterPathFromUrl reads TMDB and proxy image URLs", () => {
  assert.equal(tmdbPosterPathFromUrl("https://image.tmdb.org/t/p/w500/abc123.jpg"), "/abc123.jpg");
  assert.equal(tmdbPosterPathFromUrl("https://tmdb.streamboxapp.stream/t/p/w342/xyz.png?x=1"), "/xyz.png");
  assert.equal(tmdbPosterPathFromUrl("https://example.com/poster.jpg"), null);
  assert.equal(tmdbPosterPathFromUrl(null), null);
});

test("withTimeout resolves fast tasks and rejects slow ones", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  await assert.rejects(withTimeout(new Promise((resolve) => setTimeout(resolve, 200)), 10), /timed out/);
});
