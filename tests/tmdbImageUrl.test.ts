import assert from "node:assert/strict";
import test from "node:test";

import { getTmdbImageUrl } from "../src/api/tmdb";
import { alternateTmdbImageUrl, toProxiedTmdbImageUrl, toTmdbImageCacheUrl } from "../src/api/tmdbImageHost";

test("returns direct file URIs unchanged", () => {
  const localUri = "file:///data/user/0/app/cache/poster.jpg";

  assert.equal(getTmdbImageUrl(localUri, "w342"), localUri);
});

test("builds TMDB image URLs on the proxy, which every carrier reaches", () => {
  // From 2026-10-16 image.tmdb.org's Azerbaijani DNS answers (79.127.134.x)
  // refused connections, and posters waited out a 10s connect timeout.
  assert.equal(getTmdbImageUrl("/poster.jpg", "w342"), "https://tmdb.streamboxapp.stream/t/p/w342/poster.jpg");
  assert.equal(
    getTmdbImageUrl("https://image.tmdb.org/t/p/w500/abc_D-1.jpg", "w342"),
    "https://tmdb.streamboxapp.stream/t/p/w500/abc_D-1.jpg"
  );
});

test("only TMDB image paths move to the proxy", () => {
  for (const url of [
    "https://media.themoviedb.org/t/p/w600_and_h900_bestv2/abc.jpg",
    "https://image.tmdb.org/t/p/w342/../../3/movie/550",
    "https://cdn.imags.me/uploads/posters/dune.jpg",
  ]) {
    assert.equal(toProxiedTmdbImageUrl(url), url);
    assert.equal(alternateTmdbImageUrl(url), null);
  }
});

test("a failed image is retried on the other host, under one cache key", () => {
  const proxied = "https://tmdb.streamboxapp.stream/t/p/w185/abc.jpg";
  const direct = "https://image.tmdb.org/t/p/w185/abc.jpg";
  assert.equal(alternateTmdbImageUrl(proxied), direct);
  assert.equal(alternateTmdbImageUrl(direct), proxied);
  assert.equal(toTmdbImageCacheUrl(direct), proxied);
  assert.equal(toTmdbImageCacheUrl(`${proxied}?x=1`), proxied);
});
