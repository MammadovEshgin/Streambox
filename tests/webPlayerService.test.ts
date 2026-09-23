import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { beforeEach } from "node:test";
import axios from "axios";

import {
  __internal,
  isNativeResult,
  preferResolution,
  resolveDirectWebPlayerFallback,
  resolveNativeAlternativeToHdFilm,
  resolveWebPlayerUrl,
  type WebPlayerResult,
} from "../src/services/WebPlayerService";

const dizipalBase = "https://dizipal2078.com";

// The resolver remembers which providers answered nothing and skips them for a
// cooldown (see "unreachable provider" below). That memory is module state, so
// one test's dead provider would silently skip the next test's requests.
beforeEach(() => {
  __internal.resetProviderSilence();
  __internal.resetDizipalSearchCredentials();
});

test("Dizipal direct-slug builds the page slug the way Dizipal does", () => {
  // "From" (2022) exists at /dizi/from but Dizipal's ajax-search never surfaces
  // it (buried under multi-word "…from…" titles), so the resolver falls back to
  // the deterministic slug. These must match Dizipal's own slug convention.
  assert.equal(__internal.slugifyForDizipal("From"), "from");
  assert.equal(__internal.slugifyForDizipal("Stranger Things"), "stranger-things");
  assert.equal(__internal.slugifyForDizipal("Alcatraz'dan Kaçış"), "alcatrazdan-kacis");
  assert.equal(__internal.slugifyForDizipal("  Notes from the Last Row  "), "notes-from-the-last-row");
  // The slug-built URL must still pass the title-compatibility guard for "From".
  assert.equal(
    __internal.isDizipalUrlTitleCompatible("https://dizipal2083.com/dizi/from-dizi-izle", "From"),
    true
  );
});

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

// ---------------------------------------------------------------------------
// Native-retry decision logic — the resolver retries the native pipeline after
// a degraded first pass and must (a) recognise a real native stream to stop on,
// and (b) never return something worse than the first pass already found.
// ---------------------------------------------------------------------------

function nativeResult(overrides: Partial<WebPlayerResult> = {}): WebPlayerResult {
  return { url: "https://provider/page", source: "dizipal_direct", streamUrl: "https://cdn/x.m3u8", ...overrides };
}

const webViewFallback: WebPlayerResult = { url: "https://hdfilmcehennemi/page", source: "hdfilm" };
const notFound: WebPlayerResult = { url: "", source: "not_found" };

test("isNativeResult accepts only a real playable stream", () => {
  assert.equal(isNativeResult(nativeResult()), true);
  assert.equal(isNativeResult(nativeResult({ source: "direct" })), true);

  // The degraded outcomes the retry exists to escape.
  assert.equal(isNativeResult(webViewFallback), false);
  assert.equal(isNativeResult(notFound), false);
  assert.equal(isNativeResult({ url: "https://embed", source: "dizipal_embed" }), false);
  // dizipal_html5 is a WebView HLS retry, not a native expo-video stream.
  assert.equal(isNativeResult({ url: "https://e", source: "dizipal_html5", streamUrl: "https://cdn/y.m3u8" }), false);
  // dizipal_direct with no stream URL isn't playable natively.
  assert.equal(isNativeResult({ url: "https://p", source: "dizipal_direct" }), false);
});

test("preferResolution keeps the retry from ever downgrading the first pass", () => {
  // Retry found native — always take it.
  assert.equal(isNativeResult(preferResolution(webViewFallback, nativeResult())), true);
  assert.equal(isNativeResult(preferResolution(notFound, nativeResult())), true);

  // Retry came back worse than the first pass — keep the first pass.
  assert.equal(preferResolution(webViewFallback, notFound), webViewFallback);
  assert.equal(preferResolution(nativeResult(), notFound).streamUrl, "https://cdn/x.m3u8");
  assert.equal(preferResolution(nativeResult(), webViewFallback).streamUrl, "https://cdn/x.m3u8");

  // A watchable page still beats "Not Available".
  assert.equal(preferResolution(notFound, webViewFallback), webViewFallback);
  // Two equal-rank results: keep the first (no pointless churn).
  assert.equal(preferResolution(webViewFallback, { url: "https://other", source: "hdfilm" }), webViewFallback);
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

test("HDFilm Rapidrame decoder self-heals when the provider rotates ONLY the unmix constant", () => {
  // The provider's most common change is bumping the unmix modulus inside the
  // inline dc_*() body (observed 399756995 → 112511818) while keeping the
  // reverse→base64→rot13 wrapping. We parse that number live, so even a brand
  // new constant the app has never seen must decode. Use one NOT in the known
  // list to prove the rescue comes from the parsed value, not a baked-in guess.
  const url = "https://rotated.example/hls/movie.mp4/txt/master.txt";
  const NOVEL_CONSTANT = 271828182;

  // Build the parts with the CURRENT scheme: inverse of
  // rot13(atob(reverse(joined))) then unmix(C) ⇒ reverse(btoa(rot13(mix(url)))).
  let mixed = "";
  for (let i = 0; i < url.length; i += 1) {
    mixed += String.fromCharCode((url.charCodeAt(i) + (NOVEL_CONSTANT % (i + 5))) % 256);
  }
  const rot13 = mixed.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
  const b64 = Buffer.from(rot13, "binary").toString("base64");
  const encoded = b64.split("").reverse().join("");

  // Without the parsed constant the known list can't recover it…
  assert.ok(!__internal.decodeRapidrameValueCandidates([encoded]).includes(url));
  // …but passing the live-parsed constant does.
  assert.ok(
    __internal.decodeRapidrameValueCandidates([encoded], { constant: NOVEL_CONSTANT, offset: 5 }).includes(url)
  );

  // End-to-end: extractRapidrameStreamUrl reads the constant from the dc_*()
  // body in the embed HTML, so the whole flow self-heals with no release.
  const embedHtml = [
    `function dc_TESTROT(value_parts){let v=value_parts.join('');v=v.split('').reverse().join('');v=atob(v);`,
    `let unmix='';for(let i=0;i<v.length;i++){let charCode=v.charCodeAt(i);charCode=(charCode-(${NOVEL_CONSTANT} % (i + 5))+256)%256;unmix+=String.fromCharCode(charCode)}return unmix}`,
    `var s_TESTROT = dc_TESTROT(${JSON.stringify([encoded])});`,
    'jwplayer("player").setup({ sources: [{file: s_TESTROT, type: "hls"}] });'
  ].join("\n");

  assert.equal(__internal.extractRapidrameStreamUrl(embedHtml), url);
});

test("HDFilm decoder interprets a per-request randomized dc_*() body (reverse count, caesar shift, unmix constant + offset all novel)", () => {
  // The provider now randomizes the decoder on EVERY embed request: the number
  // of reverses, the Caesar shift amount, the unmix constant and the `(i + N)`
  // offset all change. No static scheme can match, so the extractor interprets
  // the live dc_*() body. This fixture uses parameters absent from every static
  // scheme (shift 7, offset 13, novel constant) to prove the decode is driven
  // by the parsed body, not a baked-in guess. Mirrors "The Big Short" breakage.
  const url = "https://srv10.cdnimages40.shop/hls/randomized-scheme.mp4/txt/master.txt";
  const CONSTANT = 3708627584;
  const OFFSET = 13;
  const SHIFT = 7;

  const caesar = (value: string, shift: number) => {
    const n = ((shift % 26) + 26) % 26;
    return value.replace(/[a-zA-Z]/g, (ch) => {
      const code = ch.charCodeAt(0);
      const base = code <= 90 ? 65 : 97;
      return String.fromCharCode(((code - base + n) % 26) + base);
    });
  };
  const btoaBin = (value: string) => Buffer.from(value, "binary").toString("base64");

  // Scheme to replay on decode: join → reverse → atob → caesar(+SHIFT) → atob → unmix.
  // Build the parts by inverting it end-to-end.
  let mixed = "";
  for (let i = 0; i < url.length; i += 1) {
    mixed += String.fromCharCode((url.charCodeAt(i) + (CONSTANT % (i + OFFSET))) % 256);
  }
  const joined = btoaBin(caesar(btoaBin(mixed), -SHIFT)).split("").reverse().join("");
  const parts = [joined.slice(0, 12), joined.slice(12)];

  const embedHtml = [
    `function dc_RANDO(value_parts){`,
    `let result = value_parts.join('');`,
    `result = result.split('').reverse().join('');`,
    `result = atob(result);`,
    `result = result.replace(/[a-zA-Z]/g, function(c){var o=c.charCodeAt(0),base=(o<=90)?65:97;return String.fromCharCode((o - base + ${SHIFT}) % 26 + base);});`,
    `result = atob(result);`,
    `let unmix='';for(let i=0;i<result.length;i++){let charCode=result.charCodeAt(i);charCode=((charCode-(${CONSTANT} % (i + ${OFFSET}))) % 256 + 256) % 256;unmix+=String.fromCharCode(charCode);}return unmix;}`,
    `var s_RANDO = dc_RANDO(${JSON.stringify(parts)});`,
    'jwplayer("player").setup({ sources: [{file: s_RANDO, type: "hls"}] });'
  ].join("\n");

  // The static schemes can't produce it (novel shift + offset)…
  assert.ok(!__internal.decodeRapidrameValueCandidates(parts).includes(url));
  // …but interpreting the live dc_*() body does, end to end.
  assert.equal(__internal.decodeRapidrameByInterpretingDcBody(embedHtml, "s_RANDO", parts), url);
  assert.equal(__internal.extractRapidrameStreamUrl(embedHtml), url);
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

// ---------------------------------------------------------------------------
// Dizibal, rebuilt Sept 2026: /ara/oneri search → title/episode page →
// pilavyer s.php player config (or a direct MP4). The old /api/* routes 404.
// Shapes below are trimmed copies of live responses from 2026-09-22.
// ---------------------------------------------------------------------------

const dizibalSuggest = (movies: object[], series: object[] = []) => ({ movies, series, people: [], searchUrl: "" });

const dizibalEmbedPage = (slug: string, host = "https://pilavyerplay.top") => `
  <div class="tb-box" data-player data-player-type="embed" data-duration="2400">
    <div data-pv="${slug}" class="absolute inset-0 h-full w-full"></div>
    <script src="${host}/assets/js/core.js" async></script>
  </div>`;

const dizibalPlayerPage = (stream: string, subs: object[] = []) =>
  `<script>window.__PLAYER__ = ${JSON.stringify({ v: "b0ef", stream, subs, audios: [] })};</script>
   <script src="https://pilavyerplay.top/assets/js/player.js"></script>`;

const dizibalTitlePage = (type: "Movie" | "TVSeries", name: string, alternateName: string) =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"DiziBal"}]}</script>
   <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": type, name, alternateName }] })}</script>`;

test("Dizibal suggestions: year rules out a same-named title, exact names rank first", () => {
  const response = dizibalSuggest(
    [{ title: "Criminal Minds Movie", url: "https://dizibal.org/movie/cm", meta: "Film · 2005" }],
    [
      { title: "Criminal: Birleşik Krallık", url: "https://dizibal.org/series/criminal-birlesik-krallik", meta: "Dizi · 2019" },
      { title: "Criminal Minds: Beyond Borders", url: "https://dizibal.org/series/cm-bb", meta: "Dizi · 2016" },
      { title: "Criminal Minds", url: "https://dizibal.org/series/criminal-minds", meta: "Dizi · 2005" },
    ],
  );
  const ranked = __internal.rankDizibalSuggestions(response, { mediaType: "tv", title: "Criminal Minds", year: "2005" });
  // A tv request never considers films; other years are not candidates at all.
  assert.deepEqual(ranked.map((c) => c.url), ["https://dizibal.org/series/criminal-minds"]);
  assert.equal(ranked[0].titleScore, 100);
});

test("Dizibal suggestions: a movie request also sees anime films, which are listed as anime series", () => {
  const response = dizibalSuggest([], [
    { title: "Jujutsu Kaisen", url: "https://dizibal.org/anime/jujutsu-kaisen", meta: "Anime · 2020" },
    { title: "Jujutsu Kaisen 0 Movie", url: "https://dizibal.org/anime/jujutsu-kaisen-0-movie", meta: "Anime · 2021" },
    { title: "Some Show", url: "https://dizibal.org/series/some-show", meta: "Dizi · 2021" },
  ]);
  const ranked = __internal.rankDizibalSuggestions(response, { mediaType: "movie", title: "Jujutsu Kaisen 0", year: "2021" });
  assert.equal(ranked[0].url, "https://dizibal.org/anime/jujutsu-kaisen-0-movie");
  assert.ok(ranked[0].titleScore >= 70);
  assert.equal(ranked.some((c) => c.url.includes("/series/")), false, "live-action series are never films");
});

test("Dizibal page parsers read the title identity, the player box and the player config", () => {
  assert.deepEqual(
    __internal.readDizibalPageNames(dizibalTitlePage("Movie", "Siyah Telefon 2", "Black Phone 2")),
    ["Siyah Telefon 2", "Black Phone 2"],
  );

  assert.deepEqual(__internal.extractDizibalPlayerBox(dizibalEmbedPage("qYgBz2qocvO7PPHkxrf5Mg", "https://play2.pilavyerplay.top")), {
    type: "embed", slug: "qYgBz2qocvO7PPHkxrf5Mg", playerOrigin: "https://play2.pilavyerplay.top",
  });
  assert.deepEqual(
    __internal.extractDizibalPlayerBox(`<div data-player data-player-type="direct"><video playsinline controls crossorigin
      data-src="https://dizibal.org/video/bolum/181" poster="x.webp"></video></div>`),
    { type: "direct", src: "https://dizibal.org/video/bolum/181" },
  );
  assert.deepEqual(__internal.extractDizibalPlayerBox(`<div data-player data-player-type="none"></div>`), { type: "none" });

  const config = __internal.extractPilavyerPlayerConfig(dizibalPlayerPage("https://pilavyerplay.top/api/stream.php?v=b0ef&token=t", [
    { sid: "a", lang: "tr", label: "Türkçe Altyazı", src: "https://pilavyerplay.top/api/sub.php?v=b0ef&sid=a&token=t" },
    { sid: "b", lang: "", label: "", src: "javascript:alert(1)" },
  ]));
  assert.equal(config?.stream, "https://pilavyerplay.top/api/stream.php?v=b0ef&token=t");
  assert.deepEqual(config?.subtitles, [
    { url: "https://pilavyerplay.top/api/sub.php?v=b0ef&sid=a&token=t", label: "Türkçe Altyazı", lang: "tr" },
  ]);
  assert.equal(__internal.extractPilavyerPlayerConfig("<title>Video bulunamadı</title>"), null);
});

test("Dizibal resolver: search → episode page → origin-locked player config → HLS + subtitles", async () => {
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  const calls: Array<{ url: string; config: any }> = [];
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string, config: any) => {
    calls.push({ url, config });
    if (url.endsWith("/ara/oneri")) {
      return { data: dizibalSuggest([], [{ title: "Criminal Minds", url: "https://dizibal.org/series/criminal-minds", meta: "Dizi · 2005" }]) };
    }
    if (url === "https://dizibal.org/series/criminal-minds/season/1/episode/1") return { data: dizibalEmbedPage("qYgBz2") };
    if (url === "https://pilavyerplay.top/assets/js/s.php?s=qYgBz2") {
      return { data: dizibalPlayerPage("https://pilavyerplay.top/api/stream.php?v=b0ef&token=t", [
        { lang: "tr", label: "Türkçe Altyazı", src: "https://pilavyerplay.top/api/sub.php?sid=a" },
      ]) };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await resolveDirectWebPlayerFallback({
      mediaType: "tv", title: "Criminal Minds", year: "2005", seasonNumber: 1, episodeNumber: 1,
    });
    assert.equal(result.source, "direct");
    assert.equal(result.streamType, "m3u8");
    assert.equal(result.streamUrl, "https://pilavyerplay.top/api/stream.php?v=b0ef&token=t");
    assert.equal(result.referer, "https://pilavyerplay.top/");
    assert.deepEqual(result.subtitles, [{ url: "https://pilavyerplay.top/api/sub.php?sid=a", label: "Türkçe Altyazı", lang: "tr" }]);
    // s.php answers 403 "Erişim engellendi" unless the Referer is the Dizibal origin.
    const player = calls.find((call) => call.url.includes("/s.php"));
    assert.equal(player?.config.headers.Referer, "https://dizibal.org/");
    assert.equal(calls.find((call) => call.url.endsWith("/ara/oneri"))?.config.params.q, "Criminal Minds");
    // The retired JSON API must never be called again.
    assert.equal(calls.some((call) => call.url.includes("/api/")), false);
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizibal resolver confirms a Turkish-titled film by its page's English name", async () => {
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  const pages: string[] = [];
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/ara/oneri")) {
      return { data: dizibalSuggest([
        { title: "Siyah Kuğu 2", url: "https://dizibal.org/movie/siyah-kugu-2", meta: "Film · 2025" },
        { title: "Siyah Telefon 2", url: "https://dizibal.org/movie/siyah-telefon-2", meta: "Film · 2025" },
        { title: "Siyah Telefon", url: "https://dizibal.org/movie/siyah-telefon", meta: "Film · 2021" },
      ]) };
    }
    if (url === "https://dizibal.org/movie/siyah-kugu-2") {
      pages.push(url);
      return { data: dizibalTitlePage("Movie", "Siyah Kuğu 2", "Black Swan 2") + dizibalEmbedPage("wrong") };
    }
    if (url === "https://dizibal.org/movie/siyah-telefon-2") {
      pages.push(url);
      return { data: dizibalTitlePage("Movie", "Siyah Telefon 2", "Black Phone 2") + dizibalEmbedPage("MKM4") };
    }
    if (url.endsWith("/s.php?s=MKM4")) return { data: dizibalPlayerPage("https://pilavyerplay.top/api/stream.php?v=bp2") };
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await resolveDirectWebPlayerFallback({ mediaType: "movie", title: "Black Phone 2", year: "2025" });
    assert.equal(result.streamUrl, "https://pilavyerplay.top/api/stream.php?v=bp2");
    // The decoy page is opened and rejected by its English name; the 2021 film
    // is out of year tolerance and never opened; the matched page is reused as
    // the watch page instead of being fetched twice.
    assert.deepEqual(pages, ["https://dizibal.org/movie/siyah-kugu-2", "https://dizibal.org/movie/siyah-telefon-2"]);
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("a title no provider has is answered after ONE pass, not two", async () => {
  // The resolver used to re-run the whole ladder whenever the first pass found
  // nothing, doubling the wait before "Not available" for a title that simply
  // is not there. A second pass can only change the answer if the published
  // provider domains moved, so with the config unchanged there must be no
  // repeat of the same requests.
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;
  const requested: string[] = [];

  // Key by URL *and* params: one pass legitimately hits /ajax-search twice
  // with different queries, and that is not a repeat. "Not there" means every
  // provider ANSWERED: empty searches, 404 pages. A request that got no answer
  // is a different case — see the next test.
  const notFound = () => Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
  axios.get = (async (url: string, config?: any) => {
    requested.push(`${url} ${JSON.stringify(config?.params ?? {})}`);
    if (url.includes("/search/")) return { data: { results: [] } };
    if (url.endsWith("/ajax-search")) return { data: { success: true, results: [] } };
    throw notFound();
  }) as typeof axios.get;
  axios.post = (async () => { throw notFound(); }) as typeof axios.post;

  try {
    const result = await resolveWebPlayerUrl({ mediaType: "movie", title: "Nothing Anywhere 9471", year: "2031" });
    assert.equal(result.source, "not_found");
    const duplicates = requested.filter((url, index) => requested.indexOf(url) !== index);
    assert.deepEqual(duplicates, [], "no request may be made twice — that is a second pass");
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("a miss caused by a request that got no answer is retried before 'Not available'", async () => {
  // Every fetcher reads a timeout as "no results", so a pass in which one
  // request dropped looked exactly like a title no provider has: "Not
  // available", and the viewer's second tap played it. That pass proved
  // nothing, so the resolver takes the second tap itself.
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;
  const searches: string[] = [];
  let dropped = false;

  axios.get = (async (url: string) => {
    if (url.includes("/search/")) {
      searches.push(url);
      if (!dropped) {
        dropped = true;
        throw Object.assign(new Error("timeout of 6000ms exceeded"), { code: "ECONNABORTED" });
      }
      return { data: { results: [] } };
    }
    if (url.endsWith("/ajax-search")) return { data: { success: true, results: [] } };
    throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
  }) as typeof axios.get;
  axios.post = (async () => {
    throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
  }) as typeof axios.post;

  try {
    const result = await resolveWebPlayerUrl({ mediaType: "movie", title: "Dropped Request 5521", year: "2031" });
    assert.equal(result.source, "not_found");
    const firstQuery = searches[0];
    assert.ok(
      searches.filter((url) => url === firstQuery).length >= 2,
      "the pass that lost a request must be run again"
    );
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("a slow pass is awaited, not abandoned and restarted", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "services", "WebPlayerService.ts"), "utf8");
  const resolve = source.slice(
    source.indexOf("export async function resolveWebPlayerUrl("),
    source.indexOf("async function resolveWebPlayerUrlInner(")
  );
  assert.ok(resolve.length > 0, "resolveWebPlayerUrl should be locatable");
  // The same in-flight promise is waited on again for the rest of the budget.
  assert.match(resolve, /const pending = startResolvePass\(request\);/);
  assert.match(resolve, /await awaitResolveWithin\(pending, remainingForPass\)/);
  // And a clean miss is retried only when the published domains changed; a
  // pass that lost a request is always retried.
  assert.match(resolve, /if \(!sawTransientFailure && summariseProviderBaseUrls\(\) === baseUrlsBefore\) return first;/);
});

test("a failed HDFilm stream is replaced by another provider's native stream, never a page", async () => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.post = (async () => { throw new Error("offline"); }) as typeof axios.post;
  axios.get = (async (url: string) => {
    if (url.includes("dizipal")) throw new Error("dizipal unreachable");
    if (url.endsWith("/ara/oneri")) {
      return { data: dizibalSuggest([], [{ title: "The Boys", url: "https://dizibal.org/series/the-boys", meta: "Dizi · 2019" }]) };
    }
    if (url === "https://dizibal.org/series/the-boys/season/1/episode/4") return { data: dizibalEmbedPage("tb14") };
    if (url.endsWith("/s.php?s=tb14")) return { data: dizibalPlayerPage("https://cdn.example/master.m3u8") };
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  const request = { mediaType: "tv" as const, title: "The Boys", tmdbId: "76479", seasonNumber: 1, episodeNumber: 4 };
  try {
    const alternative = await resolveNativeAlternativeToHdFilm(request);
    assert.equal(isNativeResult(alternative), true);
    assert.equal(alternative.streamUrl, "https://cdn.example/master.m3u8");

    axios.get = (async () => { throw new Error("offline"); }) as typeof axios.get;
    const nothing = await resolveNativeAlternativeToHdFilm(request);
    assert.equal(nothing.source, "not_found", "no provider → Not available, not a provider page");
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizibal anime plays its direct MP4 — only when the source answers", async () => {
  const originalGet = axios.get;
  const originalHead = axios.head;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/ara/oneri")) {
      return { data: dizibalSuggest([], [{ title: "Naruto", url: "https://dizibal.org/anime/naruto", meta: "Anime · 2002" }]) };
    }
    if (url === "https://dizibal.org/anime/naruto/season/1/episode/1") {
      return { data: `<div data-player data-player-type="direct"><video playsinline data-src="https://dizibal.org/video/bolum/230"></video></div>` };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;
  let sourceLive = true;
  axios.head = (async (url: string) => {
    assert.equal(url, "https://dizibal.org/video/bolum/230");
    if (!sourceLive) throw Object.assign(new Error("Request failed with status code 502"), { response: { status: 502 } });
    return { status: 200, data: "" };
  }) as typeof axios.head;

  const request = { mediaType: "tv" as const, title: "Naruto", year: "2002", seasonNumber: 1, episodeNumber: 1 };
  try {
    const result = await resolveDirectWebPlayerFallback(request);
    assert.equal(result.source, "direct");
    assert.equal(result.streamType, "mp4");
    assert.equal(result.streamUrl, "https://dizibal.org/video/bolum/230");
    assert.equal(result.referer, "https://dizibal.org/");

    // Some /video/bolum ids 502 upstream: no dead stream is handed to the player.
    sourceLive = false;
    assert.equal((await resolveDirectWebPlayerFallback(request)).source, "not_found");
  } finally {
    axios.get = originalGet;
    axios.head = originalHead;
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

test("search sweep tries EVERY bare title before the empty-result cutoff (Harakiri fix)", () => {
  // Harakiri (1962) is on hdfilmcehennemi as "Harakiri", but its TMDB original
  // title is "切腹". The old ordering emitted "切腹" then "切腹 1962" — two
  // queries the Turkish catalogue cannot match — and the 2-query empty cutoff
  // stopped the sweep before "Harakiri" was ever sent. The film reported "Not
  // Available" while /search/?q=Harakiri returns it, and every film with a
  // non-Latin original title failed the same way.
  const plan = __internal.generateSearchQueries("Harakiri", "1962", "切腹");
  assert.equal(plan.queries[0], "切腹");
  assert.equal(plan.queries[1], "Harakiri", "the display title must be the SECOND query, before any year variant");
  assert.equal(plan.bareTitleCount, 2);

  // …and the cutoff must not fire until both bare titles have gone out.
  assert.equal(
    __internal.shouldStopSearchingAfterEmptyQueries(0, 0, plan.bareTitleCount),
    false
  );
  assert.equal(
    __internal.shouldStopSearchingAfterEmptyQueries(1, 0, plan.bareTitleCount),
    true,
    "after both bare titles came back empty the sweep should stop"
  );
});

test("an apostrophe title is searched WITHOUT the apostrophe before the cutoff (Rosemary's Baby fix)", () => {
  // HDFilm's search does not tokenize an apostrophe: /search/?q=Rosemary's Baby
  // returns ZERO rows, /search/?q=Rosemarys Baby returns the film. The cleaned
  // spelling used to sit behind the year-qualified variants, so the two-query
  // empty cutoff fired before it was ever sent and the film reported "Not
  // Available" even though HDFilm carries it.
  const plan = __internal.generateSearchQueries("Rosemary's Baby", "1968");
  assert.equal(plan.queries[0], "Rosemary's Baby");
  assert.equal(
    plan.queries[1],
    "Rosemarys Baby",
    "the apostrophe-free spelling is a DIFFERENT name, not a cheap variant — it goes out before any year query"
  );
  assert.equal(plan.bareTitleCount, 2);
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(0, 0, plan.bareTitleCount), false);
});

test("a localized title still hands the provider its original-language spelling", () => {
  // With the UI in Turkish the display title is the Turkish one. All four
  // spellings are distinct names and must precede the year-qualified queries.
  const plan = __internal.generateSearchQueries("Rosemary'nin Bebeği", "1968", "Rosemary's Baby");
  assert.deepEqual(plan.queries.slice(0, 4), [
    "Rosemary's Baby",
    "Rosemary'nin Bebeği",
    "Rosemarys Baby",
    "Rosemarynin Bebeği",
  ]);
  assert.equal(plan.bareTitleCount, 4);
  // The cutoff cannot fire until every one of them has been tried.
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(2, 0, plan.bareTitleCount), false);
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(3, 0, plan.bareTitleCount), true);
});

test("cleaning punctuation never deletes non-ASCII letters", () => {
  // \w is ASCII-only in JS, so the cleaner used to turn "Bebeği" into "Bebei" —
  // a spelling no Turkish catalogue has.
  const plan = __internal.generateSearchQueries("Rosemary'nin Bebeği", null);
  assert.ok(plan.queries.includes("Rosemarynin Bebeği"));
  assert.ok(!plan.queries.includes("Rosemarynin Bebei"));

  // A non-Latin title is left exactly as it is (and de-duplicated).
  const cjk = __internal.generateSearchQueries("切腹", null);
  assert.deepEqual(cjk.queries, ["切腹"]);
});

test("a title with no punctuation does not gain a redundant duplicate query", () => {
  const plan = __internal.generateSearchQueries("Interstellar", "2014");
  assert.equal(plan.bareTitleCount, 1);
  assert.deepEqual(plan.queries.slice(0, 2), ["Interstellar", "Interstellar 2014"]);
});

test("search sweep keeps its 2-query floor when there is only one bare title", () => {
  const plan = __internal.generateSearchQueries("Interstellar", "2014", "Interstellar");
  assert.equal(plan.bareTitleCount, 1, "a duplicate original title must not inflate the count");
  assert.equal(plan.queries[0], "Interstellar");
  assert.equal(plan.queries[1], "Interstellar 2014");
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(0, 0, plan.bareTitleCount), false);
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(1, 0, plan.bareTitleCount), true);
  // A provider that returned rows always gets the full sweep.
  assert.equal(__internal.shouldStopSearchingAfterEmptyQueries(1, 3, plan.bareTitleCount), false);
});

test("a one-year metadata gap is the same film, a decade apart is not", () => {
  // Turkish providers date a film by its local release: HDFilm lists
  // "Dune: Part Two" as 2023 while TMDB says 2024. The hard year gate used to
  // reject it outright.
  assert.equal(__internal.isYearIncompatible("2023", "2024"), false);
  assert.equal(__internal.isYearIncompatible("2024", "2023"), false);
  assert.equal(__internal.isYearIncompatible("2024", "2024"), false);
  assert.equal(__internal.isYearIncompatible("1984", "2021"), true);
  // Unknown on either side is never a rejection.
  assert.equal(__internal.isYearIncompatible("", "2024"), false);
  assert.equal(__internal.isYearIncompatible("2024", null), false);
});

test("off-by-one provider years survive scoring; exact years still win", () => {
  const near = {
    href: "https://hdfilm.example/dune-part-two-16/",
    title: "Dune Çöl Gezegeni Bölüm İki - Dune: Part Two",
    resultYear: "2023",
    text: "dune çöl gezegeni bölüm iki - dune: part two"
  };
  const nearScore = __internal.scoreHdFilmResult(near, "Dune: Part Two", "2024");
  assert.ok(nearScore >= 50, `off-by-one year must clear the 50-pt cutoff (got ${nearScore})`);

  const exact = { ...near, resultYear: "2024" };
  const exactScore = __internal.scoreHdFilmResult(exact, "Dune: Part Two", "2024");
  assert.ok(exactScore > nearScore, `exact year must still outrank off-by-one (${exactScore} vs ${nearScore})`);

  // Dizipal's cutoff is 80 — the near-miss penalty has to stay under that too.
  const dizipalNear = __internal.scoreDizipalResult(
    { href: "https://dizipal.example/film/dune-colgezegeni-bolum-iki", title: "Dune: Part Two", resultYear: "2023", text: "dune: part two 2023" },
    "Dune: Part Two",
    "2024"
  );
  assert.ok(dizipalNear >= 80, `Dizipal off-by-one must clear its 80-pt cutoff (got ${dizipalNear})`);
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

test("Dizipal scoring prefers the correct-year Dune among two same-title candidates", () => {
  // Two "Dune" entries from ajax-search, 1984 and 2021, target year 2021.
  // The 2021 candidate must win AND the 1984 one must fall below the
  // searchDizipal 80-point cutoff (exact title 100 − 55 wrong-year = 45),
  // so even alone it cannot be returned.
  const dune1984 = { href: `${dizipalBase}/film/dune-1984`, text: "dune 1984", title: "Dune", resultYear: "1984" };
  const dune2021 = { href: `${dizipalBase}/film/dune`, text: "dune 2021", title: "Dune", resultYear: "2021" };

  const score1984 = __internal.scoreDizipalResult(dune1984, "Dune", "2021");
  const score2021 = __internal.scoreDizipalResult(dune2021, "Dune", "2021");

  assert.ok(score2021 > score1984, `2021 must outscore 1984: 2021=${score2021}, 1984=${score1984}`);
  assert.ok(score1984 < 80, `lone wrong-year Dune must stay below the 80 cutoff, got ${score1984}`);
  assert.ok(score2021 >= 80, `correct-year Dune must clear the 80 cutoff, got ${score2021}`);
});

test("extractDizipalPageYear reads only structured year markers", () => {
  // JSON-LD
  assert.equal(
    __internal.extractDizipalPageYear('<script type="application/ld+json">{"datePublished":"1984-12-14"}</script>'),
    "1984"
  );
  // year-classed element
  assert.equal(
    __internal.extractDizipalPageYear('<span class="year">2021</span>'),
    "2021"
  );
  // "Yapım Yılı" label (Turkish info table)
  assert.equal(
    __internal.extractDizipalPageYear('<td>Yapım Yılı</td><td>1984</td>'),
    "1984"
  );
  // (YYYY) in the document title
  assert.equal(
    __internal.extractDizipalPageYear("<title>Dune izle (1984) | dizipal</title>"),
    "1984"
  );
  // A bare 4-digit number anywhere else is NOT trusted (resolutions, ids, …)
  assert.equal(__internal.extractDizipalPageYear("<p>video 1080p bitrate 2021 kbps</p>"), null);
  assert.equal(__internal.extractDizipalPageYear(""), null);
});

test("Dizipal direct-slug probe rejects the wrong-year movie behind the plain slug (Dune 2021 ≠ 1984)", async () => {
  // The exact reported failure: Dune (2021) resolves through the direct-slug
  // fallback (search missed), /film/dune serves Dune 1984, and the old probe
  // matched on title compatibility alone and played the wrong film. The
  // probe must now read the page year and reject.
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/film/dune-2021-film-izle")) {
      throw new Error("404"); // Dizipal has no year-suffixed page for 2021 here
    }
    if (url.endsWith("/film/dune-film-izle")) {
      return { data: "<title>Dune izle (1984) - dizipal</title><h1>Dune</h1>" };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await __internal.probeDizipalDirectSlug("Dune", "movie", "2021");
    assert.equal(result, null, "wrong-year page behind the plain slug must not play");
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizipal direct-slug probe prefers the year-suffixed slug and reports the verified year", async () => {
  // Remakes live at slug-year pages; when the year-suffixed page exists it is
  // year-correct by construction and must be picked before the plain slug.
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/film/dune-1984-film-izle")) {
      return { data: "<title>Dune izle (1984)</title>" };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await __internal.probeDizipalDirectSlug("Dune", "movie", "1984");
    assert.ok(result, "year-suffixed slug hit must resolve");
    assert.ok(result!.url.endsWith("/film/dune-1984-film-izle"));
    assert.equal(result!.resultYear, "1984");
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizipal direct-slug probe accepts the plain movie slug when the page year matches", async () => {
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/film/dune-2021-film-izle")) {
      throw new Error("404");
    }
    if (url.endsWith("/film/dune-film-izle")) {
      return { data: '<span class="year">2021</span><h1>Dune</h1>' };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await __internal.probeDizipalDirectSlug("Dune", "movie", "2021");
    assert.ok(result, "correct-year plain slug must resolve");
    assert.ok(result!.url.endsWith("/film/dune-film-izle"));
    assert.equal(result!.resultYear, "2021");
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizipal direct-slug probe keeps TV fail-open on an unreadable page year (the 'From' fix)", async () => {
  // TV premiere years drift between regions, and the probe exists precisely
  // because /dizi/from is unfindable via search — a page without a readable
  // year must still play for series.
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/dizi/from-2022-dizi-izle")) {
      throw new Error("404");
    }
    if (url.endsWith("/dizi/from-dizi-izle")) {
      return { data: "<h1>From</h1><div>1. Sezon</div>" };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await __internal.probeDizipalDirectSlug("From", "tv", "2022");
    assert.ok(result, "TV plain-slug hit without a readable year must still resolve");
    assert.ok(result!.url.endsWith("/dizi/from-dizi-izle"));
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("Dizipal direct-slug probe rejects a wrong-year movie page even when a movie has no readable year", async () => {
  // Movies with a known target year must positively confirm the page year:
  // same-title remakes share the plain slug, so "no year found" is not safe.
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  axios.get = (async (url: string) => {
    if (url.endsWith("/film/dune-2021-film-izle")) {
      throw new Error("404");
    }
    if (url.endsWith("/film/dune-film-izle")) {
      return { data: "<h1>Dune</h1>" }; // no year anywhere
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await __internal.probeDizipalDirectSlug("Dune", "movie", "2021");
    assert.equal(result, null, "ambiguous-year movie page must not play");
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

// ---------------------------------------------------------------------------
// Dizipal's rebuilt site (Sept 2026).
//
// /ajax-search became a POST to /bg/searchcontent that answers the dropdown's
// markup, pages moved to /film/{slug}-film-izle and /dizi/{slug}/{n}-sezon/
// {n}-bolum, and the player config moved out of #videoContainer[data-cfg]
// into a hidden div[data-rm-k] that only the resolver Worker can open.
// ---------------------------------------------------------------------------

const dizipalSearchRow = (href: string, title: string, year: string) => `
  <a class="dp-search-result" data-plr="true" href="${href}">
    <img src="x.jpg" alt="${title}">
    <span class="dp-search-result-copy">
      <strong>${title}</strong>
      <span><em>${year}</em><em>Altyaz\u0131</em><em>\u2605 8.1</em></span>
    </span>
  </a>`;

test("Dizipal search reads the rebuilt dropdown, and keeps films apart from series", () => {
  const html = [
    dizipalSearchRow("https://dizipal2221.com/dizi/breaking-bad-dizi-izle", "Breaking Bad", "2008"),
    dizipalSearchRow("https://dizipal2221.com/film/el-camino-a-breaking-bad-movie-film-izle", "El Camino: Bir Breaking Bad Filmi", "2019"),
  ].join("\n");

  const series = __internal.parseDizipalSearchResults(html, "tv");
  assert.deepEqual(series.map((row) => row.href), ["https://dizipal2221.com/dizi/breaking-bad-dizi-izle"]);
  assert.equal(series[0].title, "Breaking Bad");
  assert.equal(series[0].resultYear, "2008");

  const movies = __internal.parseDizipalSearchResults(html, "movie");
  assert.deepEqual(movies.map((row) => row.title), ["El Camino: Bir Breaking Bad Filmi"]);
  assert.equal(movies[0].resultYear, "2019");
});

test("Dizipal search survives a dropdown with nothing in it", () => {
  assert.deepEqual(__internal.parseDizipalSearchResults("", "movie"), []);
  assert.deepEqual(__internal.parseDizipalSearchResults("<div>no results</div>", "tv"), []);
});

test("the device never reads a Dizipal watch page for playback", () => {
  // The player host binds the token inside the page to whoever fetched it, so
  // a page read here makes the Worker's own request 403 — which is exactly the
  // bug this shape prevents. The resolver does both halves.
  const source = fs.readFileSync(path.join(process.cwd(), "src", "services", "WebPlayerService.ts"), "utf8");
  const fn = source.slice(
    source.indexOf("async function fetchDizipalStreamUrl"),
    source.indexOf("function matchesDizipalEpisodeUrl")
  );
  assert.doesNotMatch(fn, /fetchDizipalPageHtml/);
  assert.match(fn, /resolveDizipalStreamViaWorker\(pageUrl\)/);
  assert.match(source, /JSON\.stringify\(\{ url: pageUrl, base: getDizipalBaseUrl\(\) \}\)/);
});

test("a rebuilt episode URL is recognised, and its title comes from the series slug", () => {
  const episode = "https://dizipal2221.com/dizi/breaking-bad/5-sezon/16-bolum";
  // The compatibility guard reads the title out of the URL: with the episode
  // number as the last segment it used to read "16 bolum" and reject every
  // episode the site served.
  assert.equal(__internal.isDizipalUrlTitleCompatible(episode, "Breaking Bad"), true);
  assert.equal(
    __internal.isDizipalUrlTitleCompatible("https://dizipal2221.com/dizi/the-wire/5-sezon/16-bolum", "Breaking Bad"),
    false
  );
  assert.equal(
    __internal.isDizipalUrlTitleCompatible("https://dizipal2221.com/film/oppenheimer-film-izle", "Oppenheimer"),
    true
  );
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

test("HDFilm decoder parts come from either call form, and never from past the statement", () => {
  const parts = __internal.extractRapidrameParts;
  assert.deepEqual(parts('var s_A = dc_X(["ab","cd"]);'), ["ab", "cd"]);
  assert.deepEqual(parts('var f74xr = ke14l("ab|cd|ef".split("|"));'), ["ab", "cd", "ef"]);
  assert.deepEqual(parts("var q = k('ab,cd'.split(','));"), ["ab", "cd"]);
  // The decoy array after the statement's end must not be read.
  assert.equal(parts('var q = k(someVar); var bry7a = hzz2(["x","y"]);'), null);
  assert.equal(parts('var q = k("ab|cd"); x(["y"]);'), null, "a bare string is not a parts list");
  assert.equal(parts('var q = k("unterminated'), null);
});

test("HDFilm Sep-20-2026 embed: function-expression decoder over split('|') parts, behind a decoy call", () => {
  const url = "https://srv1.example-cdn.shop/hls/title.mp4/txt/master.m3u8";
  const reversed = url.split("").reverse().join("");
  const chunks = [reversed.slice(0, 20), reversed.slice(20, 40), reversed.slice(40)];
  const embedHtml = [
    'var bry7a = hzz2(["decoy","parts"]);',
    "function hzz2(p) { return 'https://decoy.example/never.m3u8'; }",
    "var ke14l = function (n8z3f) { var s = n8z3f.join(''); return s.split('').reverse().join(''); };",
    `var f74xr = ke14l(${JSON.stringify(chunks.join("|"))}.split("|"));`,
    'var player = jwplayer("videoplayer").setup({ sources: [{file: f74xr, type: "hls"}] });',
  ].join("\n");

  assert.equal(__internal.extractRapidrameStreamUrl(embedHtml), url);
});

test("the Dizipal player config is never opened on device", () => {
  // The passphrase, the PBKDF2 round count and the openPlayer chain live in
  // workers/dizipal-resolver. A copy here would be a second thing to rotate.
  const source = fs.readFileSync(path.join(process.cwd(), "src", "services", "WebPlayerService.ts"), "utf8");
  assert.doesNotMatch(source, /crypto\.subtle|deriveBits|AES-CBC|PBKDF2\(/);
  assert.match(source, /DIZIPAL_RESOLVER_BASE_URLS/);
  // The zone host has to come first: Bakcell cannot reach workers.dev at all.
  const hosts = source.slice(source.indexOf("const DIZIPAL_RESOLVER_BASE_URLS"), source.indexOf("let activeDizipalResolverIndex"));
  assert.ok(
    hosts.indexOf("dizipal.streamboxapp.stream") < hosts.indexOf("workers.dev"),
    "the custom domain must be tried before workers.dev"
  );
});

test("an HDFilm Cloudflare challenge is retried instead of read as 'not on HDFilm'", async () => {
  // Live behaviour (2026-09-02): a /dizi/ URL answers 403 `cf-mitigated:
  // challenge` on the first request over a fresh connection and 200 on every
  // one after it. Treating that first 403 as a miss sent every series to
  // Dizipal — Turkish-dub-only, and slower.
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    if (calls === 1) {
      const error: any = new Error("Request failed with status code 403");
      error.response = { status: 403 };
      throw error;
    }
    return { data: '<button class="alternative-link">1080p</button>' };
  }) as typeof axios.get;

  try {
    const check = await __internal.checkVideoAvailability("https://hdfilm.example/dizi/x/sezon-1/bolum-1/");
    assert.equal(calls, 2, "the challenge must cost one retry, not the whole provider");
    assert.equal(check.available, true);
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("a non-challenge HDFilm error is not retried", async () => {
  const originalGet = axios.get;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;

  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    const error: any = new Error("Request failed with status code 404");
    error.response = { status: 404 };
    throw error;
  }) as typeof axios.get;

  try {
    const check = await __internal.checkVideoAvailability("https://hdfilm.example/gone/");
    assert.equal(calls, 1, "a real 404 must fail on the first attempt");
    assert.equal(check.available, false);
  } finally {
    axios.get = originalGet;
    (globalThis as any).__DEV__ = originalDev;
  }
});

// ---------------------------------------------------------------------------
// Cloudflare challenge retry — Dizipal edition.
//
// On 2026-09-09 Dizipal started answering 403 challenge pages to a fraction of
// requests. HDFilm's fetches had been retrying past this since 2026-09-02, but
// Dizipal's search and page fetches used a bare `axios.get`, so a challenged
// request silently dropped tier 2 for that play and the resolver fell through
// to Dizibal (or to "not available"). Both providers now share `providerGet`.
// ---------------------------------------------------------------------------

function challenge(status: number) {
  const error: any = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: "<html><title>Just a moment...</title></html>" };
  return error;
}

test("provider fetches retry past a Cloudflare challenge and return the eventual 200", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    if (calls <= 2) throw challenge(403);
    return { status: 200, data: "OK", request: {} };
  }) as typeof axios.get;

  try {
    const response = await __internal.providerGet("Dizipal", "https://dizipal2130.com/", {});
    assert.equal(response.data, "OK");
    assert.equal(calls, 3, "two challenges should cost two retries, not a dropped tier");
  } finally {
    axios.get = originalGet;
  }
});

test("provider fetches give up after the retry budget instead of hanging", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    throw challenge(503);
  }) as typeof axios.get;

  try {
    await assert.rejects(() => __internal.providerGet("Dizipal", "https://dizipal2130.com/", {}));
    assert.equal(calls, 3, "one initial attempt plus two retries");
  } finally {
    axios.get = originalGet;
  }
});

// ---------------------------------------------------------------------------
// Unreachable provider — 2026-09-24.
//
// Dizipal's origin went 502 behind its WAF and stopped answering altogether.
// Every call to it then cost the full 6s timeout, and the four it makes ate
// 24s of the resolver's 20s budget: Dizibal, which HAD the film, was never
// reached and "Star Wars" reported "Not available" while being watchable.
// ---------------------------------------------------------------------------

/** A request that got no answer at all: no `response`, only a timeout. */
const silent = () => Object.assign(new Error("timeout of 6000ms exceeded"), { code: "ECONNABORTED" });

test("a provider that answers nothing twice is skipped, not asked a third time", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    throw silent();
  }) as typeof axios.get;

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(() => __internal.providerGet("Dizipal", "https://dizipal2133.com/ajax-search", {}));
    }
    assert.equal(calls, 2, "two dead calls are enough to conclude the host is down");
    assert.equal(__internal.isProviderSkipped("Dizipal"), true);
    assert.equal(__internal.isProviderSkipped("HDFilm"), false, "one provider's outage never skips another");
  } finally {
    axios.get = originalGet;
  }
});

test("an HTTP answer — even a 404 — keeps a provider in play", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    if (calls === 2) {
      throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404 } });
    }
    throw silent();
  }) as typeof axios.get;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(() => __internal.providerGet("Dizibal", "https://dizibal.org/ara/oneri", {}));
    }
    assert.equal(calls, 3, "the 404 proves the host is alive, so the strike before it is forgotten");
    assert.equal(__internal.isProviderSkipped("Dizibal"), false);
  } finally {
    axios.get = originalGet;
  }
});

test("a dead provider no longer eats the budget of the one carrying the title", async () => {
  // The Star Wars (1977) case exactly: HDFilm's search does not surface it
  // under that name, Dizipal answers nothing at all, Dizibal has it under its
  // Turkish title. Before the breaker this returned "Not available".
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalDev = (globalThis as any).__DEV__;
  (globalThis as any).__DEV__ = false;
  let dizipalCalls = 0;

  axios.post = (async () => { throw silent(); }) as typeof axios.post;
  axios.get = (async (url: string) => {
    if (url.includes("dizipal")) {
      dizipalCalls += 1;
      throw silent();
    }
    if (url.includes("hdfilmcehennemi")) return { data: { results: [] } };
    if (url.endsWith("/ara/oneri")) {
      return {
        data: dizibalSuggest([
          { title: "Yıldız Savaşları: Yeni Umut", url: "https://dizibal.org/movie/yildiz-savaslari-yeni-umut", meta: "Film · 1977" },
        ]),
      };
    }
    if (url === "https://dizibal.org/movie/yildiz-savaslari-yeni-umut") {
      return { data: dizibalTitlePage("Movie", "Yıldız Savaşları: Yeni Umut", "Star Wars") + dizibalEmbedPage("sw4") };
    }
    if (url.endsWith("/s.php?s=sw4")) {
      return { data: dizibalPlayerPage("https://pilavyerplay.top/api/stream.php?v=sw4") };
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;

  try {
    const result = await resolveWebPlayerUrl({ mediaType: "movie", title: "Star Wars", year: "1977", tmdbId: "11" });
    assert.equal(result.streamUrl, "https://pilavyerplay.top/api/stream.php?v=sw4");
    assert.ok(dizipalCalls <= 2, `a silent provider is asked twice, not ${dizipalCalls} times`);
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    (globalThis as any).__DEV__ = originalDev;
  }
});

test("a non-challenge failure is not retried — it rejects exactly like axios.get", async () => {
  const originalGet = axios.get;
  let calls = 0;
  axios.get = (async () => {
    calls += 1;
    const error: any = new Error("Not Found");
    error.response = { status: 404 };
    throw error;
  }) as typeof axios.get;

  try {
    await assert.rejects(() => __internal.providerGet("HDFilm", "https://example.com/", {}));
    assert.equal(calls, 1, "a 404 means the title is absent; retrying it only wastes the budget");
  } finally {
    axios.get = originalGet;
  }
});

test("only Cloudflare interstitial statuses count as a challenge", () => {
  assert.equal(__internal.isCloudflareChallengeStatus(403), true);
  assert.equal(__internal.isCloudflareChallengeStatus(503), true);
  assert.equal(__internal.isCloudflareChallengeStatus(404), false);
  assert.equal(__internal.isCloudflareChallengeStatus(500), false);
  assert.equal(__internal.isCloudflareChallengeStatus(undefined), false);
});

test("both Dizipal entry points go through the retrying fetch, not a bare axios.get", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "services", "WebPlayerService.ts"),
    "utf8"
  );
  assert.match(source, /const response = await dizipalPost<\{ data\?: \{ html\?: string \} \}>\(/);
  assert.match(source, /async function fetchDizipalPageHtml[\s\S]{0,200}await dizipalGet<string>\(/);
});

test("FirePlayer root-relative subtitles resolve against the embed (Criminal Minds ',name=' CC bug)", () => {
  // Live imagestoo embed, 2026-09-22. Dropping the root-relative entry left the
  // CC menu with ExoPlayer's unloadable copy from the master playlist.
  const html = 'var playerjsSubtitle = "[Turkish]/netflix/altyazi/CMS01E01.srt";\nvar playerjsDefaultSubtitle = "Turkish";';
  assert.deepEqual(
    __internal.extractSubtitlesFromPlayerJs(html, "https://imagestoo.com/video/feafb280b99f47d2e75d6008f73c15a3"),
    [{ url: "https://imagestoo.com/netflix/altyazi/CMS01E01.srt", label: "Turkish", lang: "tur" }],
  );
  // Absolute entries still parse; mixed lists keep both; junk is dropped.
  assert.deepEqual(
    __internal.extractSubtitlesFromPlayerJs(
      'var playerjsSubtitle = "[English]https://cdn.test/a_eng.vtt,[Turkish]/subs/b.srt,[Bad]javascript:x";',
      "https://imagestoo.com/video/x",
    ).map((s) => s.url),
    ["https://cdn.test/a_eng.vtt", "https://imagestoo.com/subs/b.srt"],
  );
});
