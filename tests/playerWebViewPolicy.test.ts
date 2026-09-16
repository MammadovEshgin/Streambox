import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKED_PLAYER_NAVIGATION_PATTERNS,
  PLAYER_PASSIVE_ASSET_PATTERN,
  TRUSTED_PLAYER_FRAME_HOST_TOKENS,
  TRUSTED_PLAYER_FRAME_PATTERNS,
  hostMatchesTrustedToken,
  isBlockedPlayerNavigation,
  isLikelyHdFilmRuntimeStreamUrl,
  isLikelyPassivePlayerAsset,
  isLikelyUnknownDocumentNavigation,
  isTrustedHdFilmRuntimeContext,
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

test("hostMatchesTrustedToken anchors brand tokens to hostname labels", () => {
  assert.equal(hostMatchesTrustedToken("dizipal2131.com", "dizipal"), true); // rotated domain
  assert.equal(hostMatchesTrustedToken("cdn.dizipal.net", "dizipal"), true);
  assert.equal(hostMatchesTrustedToken("notdizipal.com", "dizipal"), false);
  assert.equal(hostMatchesTrustedToken("m.ok.ru", "ok.ru"), true);
  assert.equal(hostMatchesTrustedToken("ok.ru.evil.example", "ok.ru"), false);
  assert.equal(hostMatchesTrustedToken("voe.sx", "voe."), true);
  assert.equal(hostMatchesTrustedToken("voetest.example", "voe."), false);
  assert.equal(hostMatchesTrustedToken("", "dizipal"), false);
});

test("TRUSTED_PLAYER_FRAME_HOST_TOKENS drops the path-only hints", () => {
  assert.equal(TRUSTED_PLAYER_FRAME_HOST_TOKENS.includes("hls"), false);
  assert.equal(TRUSTED_PLAYER_FRAME_HOST_TOKENS.includes("m3u8"), false);
  assert.equal(TRUSTED_PLAYER_FRAME_HOST_TOKENS.includes("dizipal"), true);
});

test("a trusted token in the query string or path no longer makes a frame trusted", () => {
  // Before this change these were all `true` — a page could steer the top frame
  // anywhere by putting a magic word in the URL.
  assert.equal(isTrustedPlayerFrameUrl("https://attacker.example/watch?src=hls"), false);
  assert.equal(isTrustedPlayerFrameUrl("https://attacker.example/x.m3u8"), false);
  assert.equal(isTrustedPlayerFrameUrl("https://attacker.example/dizipal/embed"), false);
  assert.equal(isTrustedPlayerFrameUrl("https://attacker.example/?ref=rapidrame"), false);
  assert.equal(isTrustedPlayerFrameUrl("rapidrame"), false); // not a URL at all
});

test("rotated provider domains stay trusted", () => {
  assert.equal(isTrustedPlayerFrameUrl("https://dizipal2131.com/film/x"), true);
  assert.equal(isTrustedPlayerFrameUrl("https://www.hdfilmcehennemi.nl/"), true);
});

test("top-frame navigation to a host that merely mentions a token is blocked", () => {
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://attacker.example/?x=hls", isTopFrame: true },
      "https://hdfilmcehennemi.nl/movie"
    ),
    false
  );
  // Subframes keep the legacy leniency: they cannot steer the top frame.
  assert.equal(
    shouldAllowPlayerWebViewRequest(
      { url: "https://player.example/hls/embed", isTopFrame: false },
      "https://hdfilmcehennemi.nl/movie"
    ),
    true
  );
});

test("a page-supplied referer with a token in the query is not trusted HDFilm context", () => {
  assert.equal(isTrustedHdFilmRuntimeContext("https://attacker.example/?r=rapidrame"), false);
  assert.equal(isTrustedHdFilmRuntimeContext("https://rapidrame.example/embed/abc"), true);
  assert.equal(isTrustedHdFilmRuntimeContext("https://hdfilmcehennemi.mobi/video/embed/x"), true);
  // The main site is not an embed context (same as the regex this replaced).
  assert.equal(isTrustedHdFilmRuntimeContext("https://www.hdfilmcehennemi.nl/film"), false);
  // A bare .m3u8 on an unknown CDN with an untrusted referer: nothing vouches for it.
  assert.equal(
    shouldAcceptDiscoveredHdFilmStream(
      "https://cdn.attacker.example/x.m3u8",
      "https://attacker.example/?r=rapidrame",
      "https://attacker.example/?r=rapidrame"
    ),
    false
  );
});
