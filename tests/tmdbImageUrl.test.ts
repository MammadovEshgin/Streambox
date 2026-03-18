import assert from "node:assert/strict";
import test from "node:test";

import { getTmdbImageUrl } from "../src/api/tmdb";

test("returns direct file URIs unchanged", () => {
  const localUri = "file:///data/user/0/app/cache/poster.jpg";

  assert.equal(getTmdbImageUrl(localUri, "w342"), localUri);
});

test("builds TMDB URLs for relative poster paths", () => {
  assert.equal(
    getTmdbImageUrl("/poster.jpg", "w342"),
    "https://image.tmdb.org/t/p/w342/poster.jpg"
  );
});
