import assert from "node:assert/strict";
import test from "node:test";

import { mediaListKey } from "../src/utils/mediaListKey";

test("a media row is keyed by type and id", () => {
  assert.equal(mediaListKey({ mediaType: "movie", id: 12444 }, 0), "movie-12444");
  assert.equal(mediaListKey({ mediaType: "tv", id: "49010" }, 3), "tv-49010");
});

test("a row the list no longer holds gets a key instead of crashing the screen", () => {
  // 2026-10-25: "Cannot read property 'mediaType' of undefined" in a keyExtractor.
  assert.equal(mediaListKey(undefined, 7), "missing-7");
  assert.equal(mediaListKey(null, 2), "missing-2");
});
