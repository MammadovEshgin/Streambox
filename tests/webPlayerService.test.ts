import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import {
  __internal,
  resolveDirectWebPlayerFallback,
} from "../src/services/WebPlayerService";

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

test("pickDizibalHit prefers an exact TMDB-id match over higher-scoring titles", () => {
  // tmdbId-driven match short-circuits the title scorer. The first hit has
  // the same TMDB id we asked for; the second has a fuzzier but technically
  // higher title-score. We expect the TMDB match to win.
  const hits = [
    { id: 76479, slug: "the-boys", name_en: "The Boys" },
    { id: 99999, slug: "the-boyz", name_en: "The Boyz", name_tr: "The Boys (Korean drama)" },
  ];
  const picked = __internal.pickDizibalHit(hits, {
    title: "The Boys",
    mediaType: "tv",
    tmdbId: "76479",
    year: "2019",
  });
  assert.equal(picked?.slug, "the-boys");
});

test("pickDizibalHit rejects junk matches when no TMDB/IMDB and title scores too low", () => {
  // None of the candidates look like the requested title — refuse to return
  // a fallback rather than play random content.
  const hits = [
    { id: 1, slug: "completely-different", name_en: "Completely Different Show" },
  ];
  const picked = __internal.pickDizibalHit(hits, {
    title: "The Boys",
    mediaType: "tv",
    tmdbId: "76479",
  });
  assert.equal(picked, null);
});

test("Dizibal resolver uses the rotating embed URL as the native HLS referer", async () => {
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  const calls: Array<{ url: string; config: any }> = [];
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string, config: any) => {
    calls.push({ url, config });
    if (url.endsWith("/api/series")) {
      return { data: { success: true, data: [{ id: 76479, slug: "the-boys" }] } };
    }
    if (url.endsWith("/api/series/the-boys/seasons/1")) {
      return { data: { success: true, data: { episodes: [{ episode_number: 4, src: "2ibfbt9ftb6d" }] } } };
    }
    if (url.endsWith("/api/stream/m3u8")) {
      return { data: { success: true, m3u8Url: "https://cdn.example/master.m3u8", subtitles: [] } };
    }
    if (url.endsWith("/api/stream/embed")) {
      return { data: { success: true, embedUrl: "https://x.ag2m4.cfd/embed-2ibfbt9ftb6d.html?autoplay=1" } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await resolveDirectWebPlayerFallback({
      mediaType: "tv",
      title: "The Boys",
      tmdbId: "76479",
      seasonNumber: 1,
      episodeNumber: 4,
    });

    assert.equal(result.source, "direct");
    assert.equal(result.streamUrl, "https://cdn.example/master.m3u8");
    assert.equal(result.referer, "https://x.ag2m4.cfd/embed-2ibfbt9ftb6d.html?autoplay=1");
    assert.equal(calls.some((call) => call.url.endsWith("/api/stream/embed")), true);
    assert.equal(
      calls.find((call) => call.url.endsWith("/api/stream/embed"))?.config.params.autoplay,
      1,
    );
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
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

test("HDFilm scoring rejects substring-title + year-coincidence (Fury 2014 → Cuban Fury 2014 was the bug)", () => {
  // Real HDFilm shape. Cuban Fury (2014) has Turkish title "Aşkın Dansı".
  // Searching "Fury" surfaces it. Without the gating fix, scoreMatch returns
  // 40 for the substring overlap, the +50 same-year boost lifts it to 90,
  // and HDFilm wins over Dizipal (which has the actual Fury 2014). After
  // fix: substring-only matches do NOT receive the year boost, so this
  // result stays at 40, below the 50-point filter cutoff in
  // findBestHdFilmMatch — HDFilm correctly returns null and the Dizipal
  // fallback resolves the right movie.
  const result = {
    title: "Aşkın Dansı - Cuban Fury",
    text: "aşkın dansı cuban fury 2014",
    href: "/hd-askin-dansi-izle-6/",
    resultYear: "2014"
  };
  const score = __internal.scoreHdFilmResult(result, "Fury", "2014");
  assert.ok(score < 50, `expected substring+year match to score < 50, got ${score}`);
});

test("HDFilm scoring still rewards exact title + correct year (regression guard for the fix)", () => {
  const result = {
    title: "Fury",
    text: "fury 2014",
    href: "/fury-izle/",
    resultYear: "2014"
  };
  const score = __internal.scoreHdFilmResult(result, "Fury", "2014");
  assert.ok(score >= 120, `expected exact title + year match to score >= 120, got ${score}`);
});

test("HDFilm scoring still rewards prefix title + correct year (Fury Road / Mad Max style)", () => {
  // Target "Mad Max" → result "Mad Max: Fury Road" starts with target.
  // Should win comfortably when year aligns.
  const result = {
    title: "Mad Max: Fury Road",
    text: "mad max fury road 2015",
    href: "/mad-max-fury-road/",
    resultYear: "2015"
  };
  const score = __internal.scoreHdFilmResult(result, "Mad Max", "2015");
  assert.ok(score >= 100, `expected prefix title + correct year to score >= 100, got ${score}`);
});

test("HDFilm scoring penalizes strong title + wrong year (Dune 1984 vs 2021 disambiguation)", () => {
  // Target Dune (2021). HDFilm has Dune (1984) too. Title=100, year wrong → -40 → 60.
  // Still passes the 50 cutoff so it can be returned if no better candidate
  // exists, but loses cleanly to the correct-year same-title result if one is
  // also present.
  const result1984 = {
    title: "Dune",
    text: "dune 1984",
    href: "/dune-1984/",
    resultYear: "1984"
  };
  const result2021 = {
    title: "Dune",
    text: "dune 2021",
    href: "/dune-2021/",
    resultYear: "2021"
  };
  const score1984 = __internal.scoreHdFilmResult(result1984, "Dune", "2021");
  const score2021 = __internal.scoreHdFilmResult(result2021, "Dune", "2021");
  assert.ok(score2021 > score1984, `2021 should score higher than 1984: 2021=${score2021}, 1984=${score1984}`);
});

test("HDFilm year gate rejects same-title-different-year pages (Dune 2021 vs Dune 1984)", () => {
  // The exact failure that caused this fix: when step 2b retries HDFilm
  // with the Turkish localized title for Dune 2021 ("Dune: Çöl Gezegeni"),
  // the Dune 1984 page's full title is "Dune: Çöl Gezegeni  - Dune 1984"
  // — the variant "Dune: Çöl Gezegeni" matches the target EXACTLY, scoring
  // 100. The soft -40 wrong-year penalty leaves it at 60, above the
  // 50-point cutoff, so it gets returned and PLAYS — even though the user
  // clicked the 2021 poster. The hard year gate added to findBestHdFilmMatch
  // rejects this candidate outright.
  const dune1984Result = {
    href: "https://hdfilm.example/dune-4/",
    title: "Dune: Çöl Gezegeni  - Dune 1984",
    resultYear: "1984",
    text: "dune: çöl gezegeni - dune 1984"
  };
  const dune2021Result = {
    href: "https://hdfilm.example/dune-izle-hdf4-10/",
    title: "Çöl Gezegeni - Dune",
    resultYear: "2021",
    text: "çöl gezegeni - dune"
  };

  // Soft-penalty layer (scoreHdFilmResult) still lets the 1984 page squeak
  // above 50 when matched against the Turkish target — confirming why a
  // soft penalty alone is insufficient and a hard gate is required.
  const score1984Tr = __internal.scoreHdFilmResult(dune1984Result, "Dune: Çöl Gezegeni", "2021");
  assert.ok(score1984Tr >= 50, `1984 should still pass the 50-pt cutoff after soft penalty (got ${score1984Tr}) — proves the soft penalty is too lenient`);

  // The right movie still scores well against the English target — so the
  // year gate doesn't accidentally filter the CORRECT match.
  const score2021En = __internal.scoreHdFilmResult(dune2021Result, "Dune", "2021");
  assert.ok(score2021En >= 100, `Dune 2021 should score very high against the English target (got ${score2021En})`);
});

test("HDFilm scoring still works when targetYear is unknown", () => {
  // Sanity guard: when we have no year info (rare but possible for TMDB
  // entries with missing release_date), the year gate must NOT silently
  // reject every result. scoreHdFilmResult should still score by title
  // alone, and findBestHdFilmMatch's filter must skip the year check.
  const result = {
    href: "https://hdfilm.example/movie/",
    title: "Some Movie",
    resultYear: "2020",
    text: "some movie"
  };
  const score = __internal.scoreHdFilmResult(result, "Some Movie", null);
  assert.ok(score >= 100, "exact title match with no targetYear should still score high");
});

test("HDFilm WebView fallback shape is distinguishable from a native stream", () => {
  // The resolver reorder relies on identifying a WebView fallback by the
  // absence of `streamUrl`. Lock that contract: when no native stream was
  // decoded, buildHdFilmResult must produce a result with NO streamUrl, so
  // the caller can defer it and try other providers first.
  const webview = __internal.buildHdFilmResult("https://hdfilm.example/page");
  assert.equal(webview.streamUrl, undefined, "WebView fallback must not carry a streamUrl");
  assert.equal(webview.source, "hdfilm");

  // And: when a native stream IS decoded, the result MUST carry streamUrl
  // so the resolver returns it immediately (winning the priority race).
  const native = __internal.buildHdFilmResult("https://hdfilm.example/page", undefined, {
    streamUrl: "https://cdn.example/movie.m3u8",
    streamType: "m3u8",
    poster: "",
    referer: "",
    subtitles: []
  });
  assert.equal(native.streamUrl, "https://cdn.example/movie.m3u8");
  assert.equal(native.source, "direct");
});

test("Dizipal matching handles Turkish dotless-i (Yadigârları → yadigarlari)", () => {
  // Concrete bug this prevents: target = Turkish-localized TMDB title
  // "Harry Potter ve Ölüm Yadigârları: Bölüm 1". Dizipal returns the same
  // movie at `/film/harry-potter-ve-olum-yadigarlari-bolum-1`. The two are
  // word-identical after diacritic folding, BUT the Turkish dotless i (ı,
  // U+0131) has no NFD decomposition — so without an explicit fold it gets
  // stripped by `[^a-z0-9\s]`, turning "yadigarları" into "yadigarlar" and
  // breaking both the title score AND the slug-vs-title compat check.
  // Result: searchDizipal rejected the page below the 80-point cutoff, the
  // resolver returned not_found, and the player UI said "not available".
  const slug = "harry-potter-ve-olum-yadigarlari-bolum-1";
  const dizipalUrl = `${dizipalBase}/film/${slug}`;
  const turkishTitle = "Harry Potter ve Ölüm Yadigârları: Bölüm 1";

  const result = {
    href: dizipalUrl,
    text: `${turkishTitle} 2010`.toLowerCase(),
    title: turkishTitle,
    resultYear: "2010"
  };

  const score = __internal.scoreDizipalResult(result, turkishTitle, "2010");
  assert.ok(score >= 80, `score should clear the 80-point cutoff for an exact Turkish-title match, got ${score}`);

  const compat = __internal.isDizipalUrlTitleCompatible(dizipalUrl, turkishTitle);
  assert.equal(compat, true, "URL slug should be compatible with the Turkish title once ı→i is folded");

  assert.equal(
    __internal.hasStrictTitleIdentity("harry potter ve olum yadigarlari bolum 1", turkishTitle),
    true,
    "slug and Turkish title should be identity-equal under the new normalization"
  );
});

test("Dizipal matching still scores English title low against Turkish-only result", () => {
  // Sanity: the English target alone (no Turkish alt title yet) must NOT
  // suddenly start matching the Turkish-named result with a passing score —
  // that would re-introduce the false-positive risk the strict scoring was
  // designed to prevent. Step 2b's job is to retry with the Turkish title;
  // 2a should still fail cleanly.
  const result = {
    href: `${dizipalBase}/film/harry-potter-ve-olum-yadigarlari-bolum-1`,
    text: "harry potter ve ölüm yadigârları: bölüm 1 2010",
    title: "Harry Potter ve Ölüm Yadigârları: Bölüm 1",
    resultYear: "2010"
  };
  const score = __internal.scoreDizipalResult(result, "Harry Potter and the Deathly Hallows: Part 1", "2010");
  assert.ok(score < 80, `English-title match against Turkish-only result must stay below the 80 cutoff, got ${score}`);
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
