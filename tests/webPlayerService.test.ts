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

test("HDFilm extractHdFilmEmbedUrl recognizes lazy-loaded data-src iframes (Still Alice fix)", () => {
  // Real HTML shape from hdfilmcehennemi.nl pages that lazy-load their player
  // iframe (Still Alice / Unutma Beni was the first reported case). Before the
  // fix the regex only matched `src=`, so these titles fell through to the
  // fragile WebView path that caused the POCO F7 black screen.
  const pageHtml = [
    '<iframe class="rapidrame" data-src="https://www.hdfilmcehennemi.nl/rplayer/4u445b9hmyeb/"',
    '   width="100%" height="100%" allowfullscreen></iframe>'
  ].join("\n");

  const embedUrl = __internal.extractHdFilmEmbedUrl(pageHtml, "https://www.hdfilmcehennemi.nl/hd-unutma-beni-izle-5/");
  assert.equal(embedUrl, "https://www.hdfilmcehennemi.nl/rplayer/4u445b9hmyeb/");
});

test("HDFilm extractHdFilmEmbedUrl still finds plain src= iframes", () => {
  const pageHtml = '<iframe src="https://hdfilmcehennemi.mobi/video/embed/abc123/" allowfullscreen></iframe>';
  const embedUrl = __internal.extractHdFilmEmbedUrl(pageHtml, "https://www.hdfilmcehennemi.nl/whatever/");
  assert.equal(embedUrl, "https://hdfilmcehennemi.mobi/video/embed/abc123/");
});

test("HDFilm extractRapidrameStreamUrl unpacks inline packer.js wrapping the s_* assignment", () => {
  // Minimal rplayer-shape HTML: a packed eval(...) block that, when unpacked,
  // contains the `var s_X = dc_Y([...])` assignment the extractor needs. The
  // parts encode "https://example/x.m3u8" via the legacy rot13→b64→reverse→unmix
  // scheme so the existing decoder primitives are exercised end-to-end.
  const url = "https://example.test/hls/x.m3u8";
  // Reverse the unmix: shift each char forward by 399756995 % (i + 5).
  let mixed = "";
  for (let i = 0; i < url.length; i += 1) {
    mixed += String.fromCharCode((url.charCodeAt(i) + (399756995 % (i + 5))) % 256);
  }
  // Inverse of (rot13 → atob → reverse): reverse → btoa → rot13.
  const reversed = mixed.split("").reverse().join("");
  const b64 = Buffer.from(reversed, "binary").toString("base64");
  const rot13 = b64.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });

  // Use the trivial "no packing" packer payload — base 62, every token is a
  // distinct word so the unpacker just substitutes verbatim. We hand-write the
  // unpacked body and feed it via a "packed" wrapper that maps token "AAA" to
  // the body. This keeps the test independent of packer.js encoding details.
  const partsJson = JSON.stringify([rot13]);
  const unpackedBody =
    `var s_TEST=dc_FN(${partsJson});` +
    `jwplayer("player").setup({sources:[{file:s_TEST,type:"hls"}]});`;

  // Hand-build a packed block where a single token decodes to the index of
  // `unpackedBody` in the word list. The unpacker's digit alphabet orders
  // 0-9, a-z, A-Z, so the token "b" decodes to 11 in base 62.
  const words = new Array(12).fill("");
  words[11] = unpackedBody;
  const packedHtml =
    `eval(function(p,a,c,k,e,d){return p}('b',62,1,'${words.join("|")}'.split('|'),0,{}))`;

  const result = __internal.extractRapidrameStreamUrl(packedHtml);
  assert.equal(result, url);
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
