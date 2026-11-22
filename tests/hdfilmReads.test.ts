import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { __resetHdfilmChallengeForTests, hdfilmSession, isHdfilmGateUp } from "../src/services/hdfilmSession";
import { __internal, resolveWebPlayerUrl } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// How HDFilm's pages are read once its gate is up (2026-11-23). From 11-19 the
// session path served two or three viewers a day: every other phone reported
// the session "ready" and never got an HDFilm stream, and nothing recorded said
// which step failed. These cover the reads themselves; webSession.test.ts
// covers the WebView session underneath.
// ---------------------------------------------------------------------------

const BASE = "https://www.hdfilmcehennemi.nl";
const FILM = `${BASE}/verity-2026/`;
const OTHER_FILM = `${BASE}/the-dog-stars-2026/`;
const PAGE_HTML = '<html><button class="alternative-link" data-video="1">Rapidrame</button></html>';
const APP_BLOCK = "<title>Uygulama desteklenmiyor | HD Film Cehennemi</title>";
const STREAM = "https://s230.rapidrame.com/hls2/01/00028/abc123def456_,l,n,.urlset/master.m3u8?t=tok&s=1795000000&e=14400";
const PLAYER_HTML = `<html><script>var configs = { sources: [{file:"${STREAM}"}] };</script></html>`;

type FakeHost = { scripts: string[] };

function openFakeBridge(): FakeHost {
  const host: FakeHost = { scripts: [] };
  hdfilmSession.subscribe((open) => {
    hdfilmSession.attachHost(open ? { evaluate: (script) => host.scripts.push(script), reload: () => undefined } : null);
  });
  return host;
}

function reset(): void {
  hdfilmSession.resetForTests();
  __resetHdfilmChallengeForTests();
  __internal.resetProviderSilence();
}

function challenge(): Error {
  return Object.assign(new Error("Request failed with status code 403"), {
    response: { status: 403, headers: { "cf-mitigated": "challenge" }, data: "<title>Just a moment...</title>" },
  });
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), "condition never held");
}

function pageReady(): void {
  hdfilmSession.handleMessage(JSON.stringify({ kf: "page", ready: true, title: "404 Hata | Hdfilmcehennemi" }));
}

function answer(script: string, status: number, body: string): void {
  const id = Number(script.match(/id: (\d+)/)?.[1]);
  hdfilmSession.handleMessage(JSON.stringify({ kf: "fetch", id, status, challenged: false, body }));
}

/** Answer each session request as it arrives, by URL. Returns the stop. */
function serveSession(host: FakeHost, respond: (url: string) => { status: number; body: string }): () => void {
  let served = 0;
  const timer = setInterval(() => {
    while (served < host.scripts.length) {
      const script = host.scripts[served++];
      const url = script.match(/fetch\("([^"]+)"/)?.[1] ?? "";
      const { status, body } = respond(url);
      answer(script, status, body);
    }
  }, 1);
  return () => clearInterval(timer);
}

test("once the gate has been met, the next gated page goes straight to the session", async () => {
  reset();
  let host = openFakeBridge();
  const originalGet = axios.get;
  let nativeCalls = 0;
  axios.get = (async () => {
    nativeCalls += 1;
    throw challenge();
  }) as typeof axios.get;
  try {
    assert.equal(isHdfilmGateUp(), false);
    const first = __internal.checkVideoAvailability(FILM);
    await until(() => hdfilmSession.isOpening());
    pageReady();
    await until(() => host.scripts.length === 1);
    answer(host.scripts[0], 200, PAGE_HTML);
    assert.equal((await first).available, true);
    assert.equal(nativeCalls, 1);
    assert.equal(isHdfilmGateUp(), true);

    // The WebView closed after a quiet spell. The gate is still remembered, so
    // the page is not asked natively only to collect another 403.
    hdfilmSession.resetForTests();
    host = openFakeBridge();
    const second = __internal.checkVideoAvailability(OTHER_FILM);
    await until(() => hdfilmSession.isOpening());
    pageReady();
    await until(() => host.scripts.length === 1);
    answer(host.scripts[0], 200, PAGE_HTML);
    assert.equal((await second).available, true);
    assert.equal(nativeCalls, 1, "no second native request");
  } finally {
    axios.get = originalGet;
    reset();
  }
});

test("the app-block page inside the session is asked once more with the page's own X-Requested-With", async () => {
  reset();
  const host = openFakeBridge();
  const originalGet = axios.get;
  let nativeCalls = 0;
  axios.get = (async () => {
    nativeCalls += 1;
    throw challenge();
  }) as typeof axios.get;
  try {
    hdfilmSession.warm();
    pageReady();
    const check = __internal.checkVideoAvailability(FILM);
    await until(() => host.scripts.length === 1);
    assert.ok(host.scripts[0].includes("headers: {},"), "a plain read first");
    answer(host.scripts[0], 403, APP_BLOCK);

    await until(() => host.scripts.length === 2);
    assert.ok(host.scripts[1].includes('headers: {"X-Requested-With":"XMLHttpRequest"},'));
    answer(host.scripts[1], 200, PAGE_HTML);
    assert.equal((await check).available, true);
    assert.equal(nativeCalls, 0);
  } finally {
    axios.get = originalGet;
    reset();
  }
});

test("an error page read through the session is final: no native request follows it", async () => {
  reset();
  const host = openFakeBridge();
  const originalGet = axios.get;
  let nativeCalls = 0;
  axios.get = (async () => {
    nativeCalls += 1;
    throw challenge();
  }) as typeof axios.get;
  try {
    hdfilmSession.warm();
    pageReady();
    const check = __internal.checkVideoAvailability(FILM);
    await until(() => host.scripts.length === 1);
    answer(host.scripts[0], 404, "<html>404</html>");
    const result = await check;
    assert.equal(result.available, false);
    assert.equal(result.reason, "no_page");
    assert.equal(nativeCalls, 0, "a real browser was told no; three native 403s add nothing");
  } finally {
    axios.get = originalGet;
    reset();
  }
});

test("search is read through the session when the native request fails", async () => {
  reset();
  const host = openFakeBridge();
  const originalGet = axios.get;
  axios.get = (async () => {
    throw Object.assign(new Error("timeout of 6000ms exceeded"), { code: "ECONNABORTED" });
  }) as typeof axios.get;
  try {
    // No session and no gate: the failure stands.
    await assert.rejects(__internal.fetchHdFilmSearch("verity"));

    __internal.resetProviderSilence();
    hdfilmSession.warm();
    pageReady();
    const search = __internal.fetchHdFilmSearch("verity");
    await until(() => host.scripts.length === 1);
    assert.ok(host.scripts[0].includes(`fetch("${BASE}/search/?q=verity"`));
    assert.ok(host.scripts[0].includes('headers: {"X-Requested-With":"fetch","Accept":"application/json"},'));
    answer(host.scripts[0], 200, JSON.stringify({ results: ['<a href="/verity-2026/"><h4>Verity</h4></a>'] }));
    assert.equal((await search)?.results?.length, 1);
  } finally {
    axios.get = originalGet;
    reset();
  }
});

test("the rplayer source is asked alongside the .mobi one, and a slow .mobi no longer holds the play", async () => {
  reset();
  const host = openFakeBridge();
  const originalGet = axios.get;
  const nativeUrls: string[] = [];
  axios.get = ((url: string) => {
    nativeUrls.push(url);
    // The .mobi host never answers.
    return new Promise(() => undefined);
  }) as typeof axios.get;
  const stop = serveSession(host, () => ({ status: 200, body: PLAYER_HTML }));
  try {
    hdfilmSession.warm();
    pageReady();
    const pageHtml = '<iframe class="close" data-src="https://hdfilmcehennemi.mobi/video/embed/0inZbJX4HTS/?rapidrame_id=abc123def456"></iframe>';
    const startedAt = Date.now();
    const stream = await __internal.resolveHdFilmNativeFallback(FILM, pageHtml);
    assert.equal(stream?.streamUrl, STREAM);
    assert.equal(stream?.referer, `${BASE}/rplayer/abc123def456/`);
    assert.ok(Date.now() - startedAt < 3_000, "it used to wait out the .mobi request's 8s first");
    assert.deepEqual(nativeUrls, ["https://hdfilmcehennemi.mobi/video/embed/0inZbJX4HTS/?rapidrame_id=abc123def456"]);
  } finally {
    stop();
    axios.get = originalGet;
    reset();
  }
});

test("a resolve says what each tier came to and which HDFilm step stopped it", async () => {
  reset();
  const host = openFakeBridge();
  const originalGet = axios.get;
  const originalPost = axios.post;
  axios.get = (async (url: string) => {
    if (url.includes("hdfilmcehennemi.nl/search/")) {
      return {
        status: 200,
        data: { results: ['<a href="/verity-2026/"><h4>Verity</h4><span class="year">2026</span></a>'] },
        headers: {},
        config: { url },
      };
    }
    if (url.includes("hdfilmcehennemi.nl/")) throw challenge();
    throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404, headers: {}, data: "" } });
  }) as typeof axios.get;
  axios.post = (async () => {
    throw Object.assign(new Error("Request failed with status code 404"), { response: { status: 404, headers: {}, data: "" } });
  }) as typeof axios.post;
  // The film page reads; its player answers the app-block page both times.
  const stop = serveSession(host, (url) =>
    url.includes("/rplayer/")
      ? { status: 403, body: APP_BLOCK }
      : {
          status: 200,
          body: '<iframe data-src="https://hdfilmcehennemi.mobi/video/embed/x1/?rapidrame_id=abc123def456"></iframe>',
        }
  );
  const pump = setInterval(() => {
    if (hdfilmSession.isOpening()) pageReady();
  }, 1);
  try {
    const result = await resolveWebPlayerUrl({ mediaType: "movie", title: "Verity", year: "2026" });
    assert.equal(result.source, "not_found");
    const tiers = String(result.trace?.tiers);
    assert.match(tiers, /^hd:no_stream\/\d+ dp:\S+ db:\S+ kf:\S+$/, tiers);
    const reads = String(result.trace?.hdReads);
    assert.ok(reads.includes("page:native:cf"), reads);
    assert.ok(reads.includes("rplayer:web:app"), reads);
    assert.ok(reads.includes("rplayer:web:403app"), reads);
    assert.equal(typeof result.trace?.passes, "number");
  } finally {
    clearInterval(pump);
    stop();
    axios.get = originalGet;
    axios.post = originalPost;
    reset();
  }
});
