import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import {
  __resetHdfilmChallengeForTests,
  hdfilmSession,
  isHdfilmLegallyBlocked,
} from "../src/services/hdfilmSession";
import { __internal, forgetProviderBackoff, resolveWebPlayerUrl } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// What the diagnostics of 2026-11-23 showed three days later (2026-11-26):
//  - HDFilm answers 451 "Yasal Nedenlerle Erisime Kapali" to most viewers'
//    networks, search included, natively and in the WebView. That page passed
//    for a ready session, and each resolve spent eight requests (on an old
//    WebView the whole 20s) hearing it again.
//  - Dizipal came back on dizipal2161 with its player-config endpoint answering
//    Cloudflare's 520 for every title, in a real browser too.
//  - Two viewers' network drops Dizibal: every "Not available" cost its 5s
//    timeouts twice.
// ---------------------------------------------------------------------------

const LEGAL_PAGE =
  '<html><head><title>451 - Yasal Nedenlerle Erisime Kapali</title><style>b{}</style></head><body><h1>451</h1><p>Bu icerik yasal nedenlerle erisime kapatilmistir.</p><a href="https://example.org/bilgi">Bilgi</a></body></html>';

function notFound(): Error {
  return Object.assign(new Error("Request failed with status code 404"), { response: { status: 404, headers: {}, data: "" } });
}

function reset(): void {
  hdfilmSession.resetForTests();
  __resetHdfilmChallengeForTests();
  __internal.resetProviderSilence();
}

/** Run a session's page probe against a stand-in page; returns what it posts to the app. */
function runPageProbe(probe: string, title: string): { ready: boolean; blocked: boolean } {
  let posted = "";
  const window = { ReactNativeWebView: { postMessage: (message: string) => (posted = message) } };
  const document = {
    title,
    body: { innerText: "" },
    visibilityState: "visible",
    getElementById: () => null,
    querySelector: () => null,
  };
  const navigator = { userAgent: "Mozilla/5.0 (Linux; Android 14; wv) Chrome/157.0.0.0 Mobile Safari/537.36" };
  // The probe is the app's own constant script; the page objects are stand-ins.
  new Function("window", "document", "navigator", probe)(window, document, navigator);
  return JSON.parse(posted);
}

test("HDFilm's 451 page is a block page, not a ready session", () => {
  reset();
  const legal = runPageProbe(hdfilmSession.pageProbe, "451 - Yasal Nedenlerle Erisime Kapali");
  assert.equal(legal.blocked, true);
  const site = runPageProbe(hdfilmSession.pageProbe, "404 Hata - Sayfa Bulunamadı | Hdfilmcehennemi | Film izle");
  assert.equal(site.blocked, false);
  assert.equal(site.ready, true);

  // The session gives up on it at once, and HDFilm is set aside.
  hdfilmSession.subscribe((open) => {
    hdfilmSession.attachHost(open ? { evaluate: () => undefined, reload: () => undefined } : null);
  });
  hdfilmSession.warm();
  assert.equal(hdfilmSession.isOpening(), true);
  hdfilmSession.handleMessage(
    JSON.stringify({ kf: "page", ready: true, blocked: true, title: "451 - Yasal Nedenlerle Erisime Kapali" })
  );
  assert.equal(hdfilmSession.isOpening(), false);
  assert.equal(hdfilmSession.isReady(), false);
  assert.equal(isHdfilmLegallyBlocked(), true);
  reset();
});

test("a 451 from HDFilm sets it aside: one request, then none until Retry", async () => {
  reset();
  const originalGet = axios.get;
  const originalPost = axios.post;
  let hdfilmRequests = 0;
  axios.get = (async (url: string) => {
    if (url.includes("hdfilmcehennemi")) {
      hdfilmRequests += 1;
      throw Object.assign(new Error("Request failed with status code 451"), {
        response: { status: 451, headers: {}, data: LEGAL_PAGE },
      });
    }
    throw notFound();
  }) as typeof axios.get;
  axios.post = (async () => {
    throw notFound();
  }) as typeof axios.post;
  try {
    const first = await resolveWebPlayerUrl({ mediaType: "movie", title: "Legal Block 4410", year: "2031" });
    assert.equal(first.source, "not_found");
    assert.equal(hdfilmRequests, 1, "the first 451 is the last request: no second spelling, no Turkish title");
    assert.equal(isHdfilmLegallyBlocked(), true);
    assert.match(String(first.trace?.tiers), /^hd:legal\/\d+ /);
    assert.ok(String(first.trace?.hdReads).includes("search:native:451"));

    const second = await resolveWebPlayerUrl({ mediaType: "movie", title: "Legal Block 4411", year: "2031" });
    assert.equal(second.source, "not_found");
    assert.equal(hdfilmRequests, 1, "not asked again while the block is remembered");
    assert.match(String(second.trace?.tiers), /^hd:legal\/\d+ /);

    // The viewer may have changed network.
    forgetProviderBackoff();
    assert.equal(isHdfilmLegallyBlocked(), false);
    await resolveWebPlayerUrl({ mediaType: "movie", title: "Legal Block 4412", year: "2031" });
    assert.equal(hdfilmRequests, 2);
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    reset();
  }
});

test("Dizipal's player endpoint down behind its edge: one render, then the tier is skipped", async () => {
  reset();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const pageUrl = "https://dizipal2161.com/film/dune";
  let renders = 0;
  let configPosts = 0;
  axios.get = (async (url: string) => {
    if (url.includes("/film/dune")) {
      renders += 1;
      return { status: 200, headers: {}, data: '<div id="videoContainer" data-cfg="25fc482468dbf7b34f2a3758554c5ed0"></div>' };
    }
    throw notFound();
  }) as typeof axios.get;
  axios.post = (async (url: string) => {
    if (url.endsWith("/_pb")) return { status: 200, headers: {}, data: { ok: true } };
    configPosts += 1;
    throw Object.assign(new Error("Request failed with status code 520"), { response: { status: 520, headers: {}, data: "" } });
  }) as typeof axios.post;
  try {
    assert.equal(await __internal.fetchDizipalStreamUrl(pageUrl), null);
    assert.equal(renders, 1, "a second render would only meet the same 520");
    assert.equal(configPosts, 1);
    assert.equal(__internal.isProviderSkipped("Dizipal player"), false, "one 520 is not yet an outage");

    assert.equal(await __internal.fetchDizipalStreamUrl(pageUrl), null);
    assert.equal(__internal.isProviderSkipped("Dizipal player"), true);

    // The whole tier stands down: no search, no render.
    const before = renders;
    const result = await resolveWebPlayerUrl({ mediaType: "movie", title: "Dune", year: "2021" });
    assert.equal(result.source, "not_found");
    assert.equal(renders, before);
    assert.equal(result.trace?.passes, 1, "an outage at the edge is not a reason to run the resolve twice");
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    reset();
  }
});

test("a host silent through a second opening stops costing a second pass", async () => {
  reset();
  const originalGet = axios.get;
  const originalPost = axios.post;
  let dizibalRequests = 0;
  axios.get = (async (url: string) => {
    if (url.includes("dizibal")) {
      dizibalRequests += 1;
      throw Object.assign(new Error("timeout of 5000ms exceeded"), { code: "ECONNABORTED" });
    }
    if (url.includes("/search/")) return { status: 200, headers: {}, data: { results: [] }, config: { url } };
    if (url.endsWith("/ajax-search")) return { status: 200, headers: {}, data: { success: true, results: [] } };
    throw notFound();
  }) as typeof axios.get;
  axios.post = (async () => {
    throw notFound();
  }) as typeof axios.post;
  const resolve = (n: number) => resolveWebPlayerUrl({ mediaType: "movie", title: `Unreachable Host ${n}`, year: "2031" });
  try {
    // Until the outage is settled, each miss asks the silent host again.
    let resolves = 0;
    while (!__internal.isSettledOutage("Dizibal") && resolves < 6) await resolve(7000 + resolves++);
    assert.equal(__internal.isSettledOutage("Dizibal"), true, "silent through two openings");
    assert.ok(dizibalRequests >= 4, `asked through both openings (${dizibalRequests})`);

    // Settled: skipped at once, and the skip no longer triggers a second pass.
    const asked = dizibalRequests;
    const result = await resolve(7100);
    assert.equal(result.source, "not_found");
    assert.equal(dizibalRequests, asked, "not asked inside its cooldown");
    assert.equal(result.trace?.passes, 1);

    // Retry asks everything again.
    forgetProviderBackoff();
    await resolve(7101);
    assert.ok(dizibalRequests > asked);
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    reset();
  }
});
