import assert from "node:assert/strict";
import test from "node:test";

import {
  memoryCacheFileName,
  memoryIdFromFileName,
  selectStaleCacheFiles,
} from "../src/utils/watchMemoryCache";

test("memory id round-trips through its cache file name", () => {
  const id = "8f3c2b10-1a2b-4c3d-9e8f-000000000001";
  const file = memoryCacheFileName(id);
  assert.equal(file, `${id}.png`);
  assert.equal(memoryIdFromFileName(file), id);
});

test("memoryIdFromFileName ignores non-memory files", () => {
  assert.equal(memoryIdFromFileName("notes.txt"), null);
  assert.equal(memoryIdFromFileName(".png"), null); // empty id
  assert.equal(memoryIdFromFileName("thumbs"), null);
});

test("selectStaleCacheFiles returns only orphaned polaroids", () => {
  const files = ["a.png", "b.png", "c.png", "cover.jpg"];
  const active = ["b"];
  const stale = selectStaleCacheFiles(files, active);
  // a + c are orphaned; b is still live; the non-png is left alone.
  assert.deepEqual(stale.sort(), ["a.png", "c.png"]);
});

test("selectStaleCacheFiles is empty when everything is still active", () => {
  const files = ["a.png", "b.png"];
  assert.deepEqual(selectStaleCacheFiles(files, ["a", "b"]), []);
});

test("selectStaleCacheFiles treats an empty cache dir as nothing to prune", () => {
  assert.deepEqual(selectStaleCacheFiles([], ["a", "b"]), []);
});
