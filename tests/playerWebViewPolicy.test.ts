import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKED_PLAYER_NAVIGATION_PATTERNS,
  PLAYER_PASSIVE_ASSET_PATTERN,
  TRUSTED_PLAYER_FRAME_PATTERNS,
  isBlockedPlayerNavigation,
  isLikelyHdFilmRuntimeStreamUrl,
  isLikelyPassivePlayerAsset,
  isLikelyUnknownDocumentNavigation,
  isTrustedPlayerFrameUrl,
  shouldAcceptDiscoveredHdFilmStream,
  shouldAllowPlayerWebViewRequest
} from "../src/screens/player/playerWebViewPolicy";

test("BLOCKED and TRUSTED pattern lists are non-empty (sanity)", () => {
  assert.ok(BLOCKED_PLAYER_NAVIGATION_PATTERNS.length > 0);
  assert.ok(TRUSTED_PLAYER_FRAME_PATTERNS.length > 0);
});

test("isBlockedPlayerNavigation flags common ad/tracker URLs", () => {
  assert.equal(isBlockedPlayerNavigation("https://doubleclick.net/foo"), true);
  assert.equal(isBlockedPlayerNavigation("https://example.com/ads/banner"), true);
  assert.equal(isBlockedPlayerNavigation("intent://app/path"), true);
  assert.equal(isBlockedPlayerNavigation("https://hdfilmcehennemi.nl/movie"), false);
});

test("isTrustedPlayerFrameUrl recognises known provider frames", () => {
  assert.equal(isTrustedPlayerFrameUrl("https://rapidrame.example/embed/abc"), true);
  assert.equal(isTrustedPlayerFrameUrl("https://hdfilmcehennemi.mobi/video/embed/xyz"), true);
  assert.equal(isTrustedPlayerFrameUrl("https://random-site.example/page"), false);
});

test("isLikelyHdFilmRuntimeStreamUrl matches the disguised HLS shapes used by Rapidrame", () => {
  // Rapidrame serves manifests under /hls/ or /hls2/ paths — recognised by path shape.
  assert.equal(
    isLikelyHdFilmRuntimeStreamUrl("https://srv9.cdn.example/hls/movie.mp4/txt/master.txt"),
    true
  );
  assert.equal(
    isLikelyHdFilmRuntimeStreamUrl("https://srv9.cdn.example/hls2/movie/master.m3u8"),
    true
  );
  assert.equal(
    isLikelyHdFilmRuntimeStreamUrl("https://random.example/playlist.m3u8"),
    true // generic playlist.m3u8 — well-known shape
  );
  assert.equal(
    isLikelyHdFilmRuntimeStreamUrl("https://random.example/movie.mp4"),
    false
  );
});

test("shouldAcceptDiscoveredHdFilmStream rejects URLs that match the ad-blocklist", () => {
  assert.equal(
    shouldAcceptDiscoveredHdFilmStream(
      "https://doubleclick.net/movie.m3u8",
      "https://rapidrame.example/",
      "https://rapidrame.example/embed/abc"
    ),
    false
  );
});

test("shouldAcceptDiscoveredHdFilmStream accepts a Rapidrame-context m3u8 stream", () => {
  assert.equal(
    shouldAcceptDiscoveredHdFilmStream(
      "https://srv9.cdn.example/hls/movie.m3u8?token=abc",
      "https://rapidrame.example/embed/abc",
      "https://rapidrame.example/embed/abc"
    ),
    true
  );
});

test("shouldAcceptDiscoveredHdFilmStream requires .m3u8 or .mp4", () => {
  assert.equal(
    shouldAcceptDiscoveredHdFilmStream(
      "https://rapidrame.example/page.html",
      "https://rapidrame.example/embed/abc",
      "https://rapidrame.example/embed/abc"
    ),
    false
  );
});

test("PLAYER_PASSIVE_ASSET_PATTERN matches media + static assets only", () => {
  assert.equal(PLAYER_PASSIVE_ASSET_PATTERN.test("https://x.example/foo.m3u8"), true);
  assert.equal(PLAYER_PASSIVE_ASSET_PATTERN.test("https://x.example/style.css"), true);
  assert.equal(PLAYER_PASSIVE_ASSET_PATTERN.test("https://x.example/page.html"), false);
});

test("isLikelyPassivePlayerAsset is a positive identity for the pattern", () => {
  assert.equal(isLikelyPassivePlayerAsset("https://x.example/foo.vtt"), true);
  assert.equal(isLikelyPassivePlayerAsset("https://x.example/page"), false);
});

test("isLikelyUnknownDocumentNavigation flags doc-like URLs and unknown extensions", () => {
  assert.equal(isLikelyUnknownDocumentNavigation("https://x.example/path"), true);
  assert.equal(isLikelyUnknownDocumentNavigation("https://x.example/index.html"), true);
  assert.equal(isLikelyUnknownDocumentNavigation("https://x.example/style.css"), false);
});

test("shouldAllowPlayerWebViewRequest lets through about:blank and blob URLs", () => {
  assert.equal(shouldAllowPlayerWebViewRequest({ url: "about:blank" }, "https://x.example/"), true);
  assert.equal(shouldAllowPlayerWebViewRequest({ url: "blob:https://x.example/abc" }, "https://x.example/"), true);
});

test("shouldAllowPlayerWebViewRequest blocks ad URLs in any frame", () => {
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://doubleclick.net/ad/foo", isTopFrame: false },
      "https://hdfilmcehennemi.nl/"
    ),
    false
  );
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://doubleclick.net/ad/foo", isTopFrame: true },
      "https://hdfilmcehennemi.nl/"
    ),
    false
  );
});

test("shouldAllowPlayerWebViewRequest allows trusted frame providers in subframes", () => {
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://rapidrame.example/embed/abc", isTopFrame: false },
      "https://hdfilmcehennemi.nl/movie"
    ),
    true
  );
});

test("shouldAllowPlayerWebViewRequest blocks top-frame jumps to unrelated hosts", () => {
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://unrelated.example/", isTopFrame: true },
      "https://hdfilmcehennemi.nl/movie"
    ),
    false
  );
});

test("shouldAllowPlayerWebViewRequest rejects non-http(s) schemes", () => {
  assert.equal(
    shouldAllowPlayerWebViewRequest({ url: "ftp://x.example/foo" }, "https://hdfilmcehennemi.nl/"),
    false
  );
});
