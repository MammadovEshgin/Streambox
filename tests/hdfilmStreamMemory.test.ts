import assert from "node:assert/strict";
import test, { mock } from "node:test";

import axios from "axios";

import { hdfilmSession } from "../src/services/hdfilmSession";
import { __internal, forgetResolvedStream } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// A decoded HDFilm stream is remembered per page. It used to be remembered for
// as long as the app stayed open, so a link that had gone bad was handed back
// to every retry: the player's silent re-resolve came back in 0.1s with the
// link that had just failed (owner's phone, 2026-11-19).
// ---------------------------------------------------------------------------

const BASE = "https://www.hdfilmcehennemi.nl";
const PAGE = `${BASE}/past-lives-37/`;
const RPLAYER = `${BASE}/rplayer/xjtwpjsqnjhg/`;

function streamFor(token: string): string {
  return `https://s429.rapidrame.com/hls2/01/00022/xjtwpjsqnjhg_,l,n,.urlset/master.m3u8?t=${token}&s=1795121196&e=14400`;
}

function rplayerPage(token: string): string {
  const pieces = Buffer.from(streamFor(token), "latin1").toString("base64").match(/.{1,9}/g) ?? [];
  return [
    '<div id="pk" data-v="abc" style="display:none"></div><script>',
    "var q7x=function(p){return atob(p.join(''))};",
    "var configs = {",
    ` sources: [{file:(function(){ return q7x(${JSON.stringify(pieces)}); })()}],`,
    ' type: "hls"',
    "};",
    "</script>",
  ].join("\n");
}

const FILM_PAGE =
  '<html><nav class="video-alternatives"><button class="alternative-link" data-video="1">Rapidrame</button></nav>' +
  `<iframe class="rapidrame" data-src="${RPLAYER}" scrolling="no"></iframe></html>`;

/** Serves the film page and a player whose link carries a new token on every fetch. */
function serveHdFilm(): { rplayerFetches: () => number; restore: () => void } {
  const originalGet = axios.get;
  let rplayerFetches = 0;
  axios.get = (async (url: string) => {
    if (url === PAGE) return { status: 200, data: FILM_PAGE };
    if (url === RPLAYER) {
      rplayerFetches += 1;
      return { status: 200, data: rplayerPage(`token${rplayerFetches}`) };
    }
    if (url.includes("rapidrame.com")) return { status: 200, data: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8\n" };
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof axios.get;
  return { rplayerFetches: () => rplayerFetches, restore: () => { axios.get = originalGet; } };
}

async function resolvedStream(): Promise<string | undefined> {
  const check = await __internal.checkVideoAvailability(PAGE);
  return check.nativeFallback?.streamUrl;
}

test("a resolved HDFilm link is reused for a few minutes, then asked for again", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  mock.timers.enable({ apis: ["Date"], now: 1_795_121_200_000 });
  const site = serveHdFilm();
  try {
    assert.equal(await resolvedStream(), streamFor("token1"));
    assert.equal(await resolvedStream(), streamFor("token1"), "the detail page's check and Watch share one link");
    assert.equal(site.rplayerFetches(), 1);

    mock.timers.tick(10 * 60_000 + 1);
    assert.equal(await resolvedStream(), streamFor("token2"), "a link is not remembered for the whole app session");
    assert.equal(site.rplayerFetches(), 2);
  } finally {
    forgetResolvedStream({ url: "", source: "direct", webViewFallbackUrl: PAGE });
    site.restore();
    mock.timers.reset();
  }
});

test("a link the player gave up on is forgotten, so the next resolve brings a new one", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  const site = serveHdFilm();
  try {
    const first = await __internal.checkVideoAvailability(PAGE);
    const result = __internal.buildHdFilmResult(PAGE, undefined, first.nativeFallback);
    assert.equal(result.streamUrl, streamFor("token1"));
    assert.equal(result.webViewFallbackUrl, PAGE);

    forgetResolvedStream(result);
    assert.equal(await resolvedStream(), streamFor("token2"));

    // Results from other providers carry nothing to forget.
    forgetResolvedStream({ url: "https://dizipal.example/x", source: "dizipal_direct", streamUrl: "https://cdn.example/a.m3u8" });
    forgetResolvedStream(null);
    assert.equal(await resolvedStream(), streamFor("token2"));
    assert.equal(site.rplayerFetches(), 2);
  } finally {
    forgetResolvedStream({ url: "", source: "direct", webViewFallbackUrl: PAGE });
    site.restore();
  }
});
