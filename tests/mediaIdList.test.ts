import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listIncludesMediaId,
  mediaListIdsEqual,
  normalizeMediaListId,
  parseStoredMediaIds,
  removeMediaIdFromList,
  toggleMediaIdInList,
} from "../src/utils/mediaIdList";

describe("mediaIdList — id normalization", () => {
  it("treats '603' and 603 as the same movie (route params are strings, imports store numbers)", () => {
    assert.equal(mediaListIdsEqual("603", 603), true);
    assert.equal(mediaListIdsEqual(603, "603"), true);
    assert.equal(listIncludesMediaId([550, 603, 680], "603"), true);
    assert.equal(listIncludesMediaId(["603"], 603), true);
  });

  it("normalizes numeric strings to numbers and trims whitespace", () => {
    assert.equal(normalizeMediaListId("603"), 603);
    assert.equal(normalizeMediaListId(" 603 "), 603);
    assert.equal(normalizeMediaListId(42), 42);
  });

  it("passes non-numeric internal ids through untouched", () => {
    assert.equal(normalizeMediaListId("az-001"), "az-001");
    assert.equal(mediaListIdsEqual("az-001", "az-001"), true);
    assert.equal(mediaListIdsEqual("az-001", "az-002"), false);
  });
});

describe("mediaIdList — toggle", () => {
  it("adds an absent id and reports existed=false", () => {
    const result = toggleMediaIdInList([1, 2], 3);
    assert.deepEqual(result.next, [1, 2, 3]);
    assert.equal(result.existed, false);
  });

  it("removes a present id and reports existed=true", () => {
    const result = toggleMediaIdInList([1, 2, 3], 2);
    assert.deepEqual(result.next, [1, 3]);
    assert.equal(result.existed, true);
  });

  it("removes across representations — toggling '603' removes numeric 603 (the phantom-duplicate bug)", () => {
    const result = toggleMediaIdInList([550, 603], "603");
    assert.deepEqual(result.next, [550]);
    assert.equal(result.existed, true);
  });

  it("stores the normalized (numeric) form when adding via string id", () => {
    const result = toggleMediaIdInList([550], "603");
    assert.deepEqual(result.next, [550, 603]);
  });

  it("never adds a duplicate when the id already exists in another representation", () => {
    const added = toggleMediaIdInList(["603"], 603);
    // Present as "603" → toggle REMOVES it rather than appending numeric 603.
    assert.deepEqual(added.next, []);
    assert.equal(added.existed, true);
  });
});

describe("mediaIdList — remove", () => {
  it("is a no-op (changed=false) for missing ids so callers skip write+sync", () => {
    const result = removeMediaIdFromList([1, 2], 99);
    assert.equal(result.changed, false);
    assert.equal(result.existed, false);
    assert.deepEqual(result.next, [1, 2]);
  });

  it("removes matching ids across representations", () => {
    const result = removeMediaIdFromList([550, "603", "az-001"], 603);
    assert.equal(result.changed, true);
    assert.deepEqual(result.next, [550, "az-001"]);
  });
});

describe("mediaIdList — parseStoredMediaIds", () => {
  it("filters junk while keeping valid numeric and string ids", () => {
    const raw = JSON.stringify([550, "603", "az-001", null, "", "  ", Number.NaN, {}, []]);
    assert.deepEqual(parseStoredMediaIds(raw), [550, "603", "az-001"]);
  });

  it("returns [] for null, corrupt JSON, and non-arrays", () => {
    assert.deepEqual(parseStoredMediaIds(null), []);
    assert.deepEqual(parseStoredMediaIds("{not json"), []);
    assert.deepEqual(parseStoredMediaIds(JSON.stringify({ a: 1 })), []);
  });
});

// The regression that lost user data: a hook instance holding a STALE copy of
// the list must not be able to erase items added elsewhere. The hook now
// re-reads storage inside a mutation lock and applies the change to the FRESH
// list; these cases pin the pure merge semantics that rely on.
describe("mediaIdList — stale-copy overwrite regression", () => {
  it("a toggle applied to the fresh list preserves items the stale instance never saw", () => {
    // Instance mounted when the list was [1, 2]; meanwhile a Letterboxd import
    // grew storage to [1, 2, ...300 imports]. The old code wrote [1, 2, 4].
    const freshStorageList = [1, 2, 101, 102, 103];
    const result = toggleMediaIdInList(freshStorageList, 4);
    assert.deepEqual(result.next, [1, 2, 101, 102, 103, 4]);
  });

  it("a remove applied to the fresh list only removes its target", () => {
    const freshStorageList = [1, 2, 101, 102];
    const result = removeMediaIdFromList(freshStorageList, 2);
    assert.deepEqual(result.next, [1, 101, 102]);
  });
});
