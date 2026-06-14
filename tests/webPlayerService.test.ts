import assert from "node:assert/strict";
import test from "node:test";

import { __internal } from "../src/services/WebPlayerService";

const dizipalBase = "https://dizipal2078.com";

test("Dizipal matching rejects unrelated pages for acronym titles", () => {
  const result = {
    href: `${dizipalBase}/dizi/malcolm-in-the-middle-life-s-still-unfair`,
    text: "Malcolm in the Middle: Life's Still Unfair 2026",
    title: "Malcolm in the Middle: Life's Still Unfair",
    resultYear: "2026"
  };

  assert.equal(__internal.scoreDizipalResult(result, "M.I.A.", "2026"), 0);
  assert.equal(
    __internal.isDizipalUrlTitleCompatible(
      `${dizipalBase}/bolum/malcolm-in-the-middle-life-s-still-unfair-1-sezon-1-bolum`,
      "M.I.A."
    ),
    false
  );
});

test("Dizipal matching keeps legitimate acronym pages playable", () => {
  const result = {
    href: `${dizipalBase}/dizi/mia`,
    text: "M.I.A. 2026",
    title: "M.I.A.",
    resultYear: "2026"
  };

  assert.equal(__internal.scoreDizipalResult(result, "M.I.A.", "2026"), 150);
  assert.equal(
    __internal.isDizipalUrlTitleCompatible(`${dizipalBase}/bolum/mia-1-sezon-1-bolum`, "M.I.A."),
    true
  );
});

test("Dizipal matching allows safe acronym expansions", () => {
  assert.equal(__internal.hasStrictTitleIdentity("Missing in Action", "M.I.A."), true);
  assert.equal(__internal.isAlternateTitleSafeForDizipal("M.I.A.", "Missing in Action"), true);
  assert.equal(
    __internal.isAlternateTitleSafeForDizipal("M.I.A.", "Malcolm in the Middle: Life's Still Unfair"),
    false
  );
});

test("HDFilm Rapidrame decoder handles the current double-base64 scheme", () => {
  // Real `s_*` source array captured from the hdfilmcehennemi.mobi embed page
  // for "The Devil Wears Prada 2" (the previously-black-screen title).
  // Decode is pure, so this parts→URL mapping is stable across requests even
  // though the CDN subdomain rotates on every load.
  const parts = [
    "=0TPRRmRlp", "VVQxEN0BjU", "ZBnNvNGajF", "GSVpUbaVlZ", "4JDZZV2MXd",
    "lVaZWbxgkU", "KRHWsVzbUR", "VSCFTUhVWS", "qlnRv5mTp5", "2a0kDNsxUa",
    "0IWeWllaTZ", "ENqNnSxY2R", "P5GZMBnaUN", "kTFRWNK5GZ", "0YEWmBjUI5",
    "EOzNzYwAne", "M9yczMWMsh", "UY"
  ];

  const candidates = __internal.decodeRapidrameValueCandidates(parts);
  const decoded = candidates.find((value) => /^https?:\/\//i.test(value));

  assert.equal(
    decoded,
    "https://srv9.cdnimages2325.shop/hls/thedevilwearsprada2-2026mp4-QWnrF2cua7U.mp4/txt/master.txt"
  );
});

test("HDFilm extractRapidrameStreamUrl resolves the master.txt HLS URL from embed HTML", () => {
  // Minimal embed shape mirroring hdfilmcehennemi.mobi: a `sources` block that
  // references an `s_*` variable holding the obfuscated parts array.
  const embedHtml = [
    'var s_WnFNxFGVKJP = dc_OVbwJ0EviCS(["=0TPRRmRlp","VVQxEN0BjU","ZBnNvNGajF",',
    '"GSVpUbaVlZ","4JDZZV2MXd","lVaZWbxgkU","KRHWsVzbUR","VSCFTUhVWS","qlnRv5mTp5",',
    '"2a0kDNsxUa","0IWeWllaTZ","ENqNnSxY2R","P5GZMBnaUN","kTFRWNK5GZ","0YEWmBjUI5",',
    '"EOzNzYwAne","M9yczMWMsh","UY"]);',
    'jwplayer("player").setup({ sources: [{file: s_WnFNxFGVKJP, type: "hls"}] });'
  ].join("\n");

  assert.equal(
    __internal.extractRapidrameStreamUrl(embedHtml),
    "https://srv9.cdnimages2325.shop/hls/thedevilwearsprada2-2026mp4-QWnrF2cua7U.mp4/txt/master.txt"
  );
});

test("HDFilm Rapidrame decoder still accepts a legacy-scheme value", () => {
  // Build a value with the OLD scheme (base64 → rot13 → reverse → unmix inverse)
  // to prove the multi-scheme decoder keeps older embeds playable.
  const url = "https://legacy.example/hls/movie.mp4/txt/master.txt";

  // Inverse of unmix: shift each char FORWARD by 399756995 % (i + 5).
  let mixed = "";
  for (let i = 0; i < url.length; i += 1) {
    mixed += String.fromCharCode((url.charCodeAt(i) + (399756995 % (i + 5))) % 256);
  }
  // Inverse of (base64 → rot13 → reverse): reverse → rot13 → base64-encode.
  const reversed = mixed.split("").reverse().join("");
  const rot13 = reversed.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
  const encoded = Buffer.from(rot13, "binary").toString("base64");

  const candidates = __internal.decodeRapidrameValueCandidates([encoded]);
  assert.ok(candidates.includes(url));
});

test("HDFilm Rapidrame inspection follows master playlists before deciding native playback", () => {
  const masterPlaylist = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
    "720/index.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
    "1080/index.m3u8"
  ].join("\n");

  const result = __internal.inspectRapidramePlaylist(
    masterPlaylist,
    "https://rapidrame.example/hls2/01/00001/movie/master.m3u8"
  );

  assert.equal(result.preferNative, false);
  assert.deepEqual(result.childPlaylistUrls, [
    "https://rapidrame.example/hls2/01/00001/movie/720/index.m3u8",
    "https://rapidrame.example/hls2/01/00001/movie/1080/index.m3u8"
  ]);
});

test("HDFilm buildHdFilmResult ALWAYS goes native when a stream URL was decoded, regardless of preferNative", () => {
  // Regression guard: previously a 'normal' master playlist (preferNative=false)
  // would fall through to the WebView player. That fragile path triggered the
  // POCO F7 / HyperOS black-screen-on-pre-roll bug for titles like "Still Alice".
  const pageUrl = "https://www.hdfilmcehennemi.nl/still-alice-2014-izle/";
  const nativeFallback = {
    streamUrl: "https://srv9.cdn.example/hls/still-alice.mp4/txt/master.txt",
    streamType: "m3u8",
    poster: "",
    referer: "https://hdfilmcehennemi.mobi/video/embed/abc/?rapidrame_id=xyz",
    subtitles: [],
    preferNative: false // proper master playlist — previously WebView
  };

  const result = __internal.buildHdFilmResult(pageUrl, undefined, nativeFallback);

  assert.equal(result.source, "direct");
  assert.equal(result.url, nativeFallback.streamUrl);
  assert.equal(result.streamUrl, nativeFallback.streamUrl);
  assert.equal(result.streamType, "m3u8");
  // Original page URL is preserved so PlayerScreen can drop back to WebView if
  // the native stream itself fails (broken segment, geo block, expired token).
  assert.equal(result.webViewFallbackUrl, pageUrl);
});

test("HDFilm buildHdFilmResult goes native for the legacy preferNative=true shape too", () => {
  // The disguised-.jpg HLS case (older behavior) still goes native.
  const pageUrl = "https://www.hdfilmcehennemi.nl/some-movie/";
  const nativeFallback = {
    streamUrl: "https://srv9.cdn.example/hls/movie.mp4/txt/master.txt",
    streamType: "m3u8",
    poster: "",
    referer: "https://hdfilmcehennemi.mobi/video/embed/abc/?rapidrame_id=xyz",
    subtitles: [],
    preferNative: true
  };

  const result = __internal.buildHdFilmResult(pageUrl, undefined, nativeFallback);
  assert.equal(result.source, "direct");
  assert.equal(result.webViewFallbackUrl, pageUrl);
});

test("HDFilm buildHdFilmResult falls back to WebView only when no stream was decoded", () => {
  // Decoder couldn't extract a stream — the on-page JWPlayer is the last resort.
  const pageUrl = "https://www.hdfilmcehennemi.nl/some-movie/";
  const result = __internal.buildHdFilmResult(pageUrl, undefined, null);

  assert.equal(result.source, "hdfilm");
  assert.equal(result.url, pageUrl);
  assert.equal(result.streamUrl, undefined);
  assert.equal(result.webViewFallbackUrl, undefined);
});

test("HDFilm buildHdFilmResult propagates qualityWarning into the native result", () => {
  const result = __internal.buildHdFilmResult(
    "https://example/movie/",
    "CAM",
    {
      streamUrl: "https://x/movie.mp4/txt/master.txt",
      streamType: "m3u8",
      poster: "",
      referer: "https://x/embed",
      subtitles: [],
      preferNative: false
    }
  );
  assert.equal(result.qualityWarning, "CAM");
  assert.equal(result.source, "direct");
});

test("HDFilm Rapidrame inspection prefers native for disguised image media segments", () => {
  const mediaPlaylist = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXTINF:6.000,",
    "image0001.jpg",
    "#EXTINF:6.000,",
    "image0002.jpg"
  ].join("\n");

  const result = __internal.inspectRapidramePlaylist(
    mediaPlaylist,
    "https://rapidrame.example/hls2/01/00001/movie/1080/index.m3u8"
  );

  assert.equal(result.preferNative, true);
  assert.deepEqual(result.childPlaylistUrls, []);
});
