import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { mock } from "node:test";

import {
  __resetKultfilmlerSessionForTests,
  attachKultfilmlerHost,
  fetchKultfilmlerText,
  handleKultfilmlerMessage,
  isKultfilmlerNavigationAllowed,
  isKultfilmlerSessionOpening,
  KULTFILMLER_WARM_DELAY_MS,
  kultfilmlerSessionUrl,
  liftKultfilmlerCooldown,
  scheduleKultfilmlerWarm,
  setKultfilmlerOrigin,
  subscribeKultfilmlerSession,
  warmKultfilmlerSession,
} from "../src/services/kultfilmlerSession";
import { __internal } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// Session: the hidden WebView that holds kultfilmler.net open past its
// Cloudflare challenge. A fake host stands in for the WebView and records the
// scripts the session asks it to run.
// ---------------------------------------------------------------------------

type FakeHost = { scripts: string[]; reloads: number };

function openFakeBridge(): { host: FakeHost; opened: boolean[] } {
  const host: FakeHost = { scripts: [], reloads: 0 };
  const opened: boolean[] = [];
  subscribeKultfilmlerSession((open) => {
    opened.push(open);
    attachKultfilmlerHost(
      open ? { evaluate: (script) => host.scripts.push(script), reload: () => (host.reloads += 1) } : null
    );
  });
  return { host, opened };
}

function requestIdOf(script: string): number {
  return Number(script.match(/id: (\d+)/)?.[1]);
}

function answer(id: number, status: number, body: string, challenged = false) {
  handleKultfilmlerMessage(JSON.stringify({ kf: "fetch", id, status, challenged, body }));
}

test("a request opens the session, waits out the challenge, then runs inside the page", async () => {
  __resetKultfilmlerSessionForTests();
  const { host, opened } = openFakeBridge();
  assert.deepEqual(opened, [false]);

  const pending = fetchKultfilmlerText("https://kultfilmler.net/rashomon-izle/");
  assert.deepEqual(opened, [false, true], "the bridge is asked to mount its WebView");
  assert.equal(host.scripts.length, 0, "nothing runs on the challenge page");

  handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: false }));
  assert.equal(host.scripts.length, 0);
  handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
  assert.equal(host.scripts.length, 1);
  assert.match(host.scripts[0], /fetch\("https:\/\/kultfilmler\.net\/rashomon-izle\/", \{ credentials: "same-origin" \}\)/);

  answer(requestIdOf(host.scripts[0]), 200, "<html>page</html>");
  assert.deepEqual(await pending, { ok: true, body: "<html>page</html>" });

  // Ready now: the next request goes straight in.
  const second = fetchKultfilmlerText("https://kultfilmler.net/x/");
  assert.equal(host.scripts.length, 2);
  answer(requestIdOf(host.scripts[1]), 404, "");
  assert.deepEqual(await second, { ok: false, reason: "http", status: 404 });
  __resetKultfilmlerSessionForTests();
});

test("a lapsed clearance re-runs the challenge and retries once", async () => {
  __resetKultfilmlerSessionForTests();
  const { host } = openFakeBridge();
  const pending = fetchKultfilmlerText("https://kultfilmler.net/a/");
  handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
  const id = requestIdOf(host.scripts[0]);

  answer(id, 403, "Just a moment...", true);
  assert.equal(host.reloads, 1);
  handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
  assert.equal(host.scripts.length, 2, "the same request is sent again once the page is clear");
  answer(requestIdOf(host.scripts[1]), 403, "Just a moment...", true);
  assert.deepEqual(await pending, { ok: false, reason: "http", status: 403 }, "only one retry");
  __resetKultfilmlerSessionForTests();
});

test("a challenge the device can't pass fails the queue and is not retried for a while", async () => {
  __resetKultfilmlerSessionForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const { opened } = openFakeBridge();
    const pending = fetchKultfilmlerText("https://kultfilmler.net/a/");
    handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: false, title: "Just a moment...", visibility: "visible", challengeFrame: true }));
    mock.timers.tick(19_999);
    assert.equal(isKultfilmlerSessionOpening(), true, "a phone gets 20s for the challenge");
    mock.timers.tick(1);
    assert.deepEqual(await pending, { ok: false, reason: "unavailable" }, "not worth a second resolver pass");
    assert.equal(opened.at(-1), false, "the WebView is let go");

    assert.deepEqual(await fetchKultfilmlerText("https://kultfilmler.net/b/"), { ok: false, reason: "unavailable" });
    mock.timers.tick(3 * 60_000);
    void fetchKultfilmlerText("https://kultfilmler.net/c/");
    assert.equal(opened.at(-1), true, "after the cooldown it tries again");
  } finally {
    mock.timers.reset();
    __resetKultfilmlerSessionForTests();
  }
});

test("a detail page warms the session, so Watch finds it open", async () => {
  __resetKultfilmlerSessionForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    warmKultfilmlerSession();
    const { host, opened } = openFakeBridge();
    assert.deepEqual(opened, [false], "no bridge mounted yet: nothing to warm");

    warmKultfilmlerSession();
    assert.equal(opened.at(-1), true);
    assert.equal(isKultfilmlerSessionOpening(), true);
    handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
    assert.equal(isKultfilmlerSessionOpening(), false);
    assert.equal(host.scripts.length, 0, "nothing is fetched until asked");

    const pending = fetchKultfilmlerText("https://kultfilmler.net/a/");
    assert.equal(host.scripts.length, 1, "the request goes straight in");
    answer(requestIdOf(host.scripts[0]), 200, "ok");
    assert.deepEqual(await pending, { ok: true, body: "ok" });

    // Warmed and never used: it still closes when idle.
    __resetKultfilmlerSessionForTests();
    const second = openFakeBridge();
    warmKultfilmlerSession();
    handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
    mock.timers.tick(3 * 60_000);
    assert.equal(second.opened.at(-1), false);
  } finally {
    mock.timers.reset();
    __resetKultfilmlerSessionForTests();
  }
});

test("a detail page warms only once it has been open a moment, and leaving cancels it", () => {
  // Started on mount, the challenge ran during every detail page's entrance,
  // and for each page skimmed past on the way to another.
  __resetKultfilmlerSessionForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const { opened } = openFakeBridge();
    const cancel = scheduleKultfilmlerWarm();
    mock.timers.tick(KULTFILMLER_WARM_DELAY_MS - 1);
    cancel();
    mock.timers.tick(10_000);
    assert.deepEqual(opened, [false], "a page left early never opens the session");

    scheduleKultfilmlerWarm();
    mock.timers.tick(KULTFILMLER_WARM_DELAY_MS);
    assert.equal(opened.at(-1), true);
  } finally {
    mock.timers.reset();
    __resetKultfilmlerSessionForTests();
  }
});

test("Retry lifts the cooldown of a challenge that stalled", async () => {
  __resetKultfilmlerSessionForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const { opened } = openFakeBridge();
    const pending = fetchKultfilmlerText("https://kultfilmler.net/a/");
    mock.timers.tick(20_000);
    assert.deepEqual(await pending, { ok: false, reason: "unavailable" });
    assert.deepEqual(await fetchKultfilmlerText("https://kultfilmler.net/b/"), { ok: false, reason: "unavailable" });

    liftKultfilmlerCooldown();
    void fetchKultfilmlerText("https://kultfilmler.net/c/");
    assert.equal(opened.at(-1), true, "asked again at once");
  } finally {
    mock.timers.reset();
    __resetKultfilmlerSessionForTests();
  }
});

test("an idle session closes its WebView", async () => {
  __resetKultfilmlerSessionForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const { host, opened } = openFakeBridge();
    const pending = fetchKultfilmlerText("https://kultfilmler.net/a/");
    handleKultfilmlerMessage(JSON.stringify({ kf: "page", ready: true }));
    answer(requestIdOf(host.scripts[0]), 200, "ok");
    await pending;
    assert.equal(opened.at(-1), true);
    mock.timers.tick(3 * 60_000);
    assert.equal(opened.at(-1), false);
  } finally {
    mock.timers.reset();
    __resetKultfilmlerSessionForTests();
  }
});

test("with no bridge mounted there is no session to wait for", async () => {
  __resetKultfilmlerSessionForTests();
  assert.deepEqual(await fetchKultfilmlerText("https://kultfilmler.net/a/"), { ok: false, reason: "unavailable" });
});

test("the session only fetches its own origin, and follows a domain move", async () => {
  __resetKultfilmlerSessionForTests();
  openFakeBridge();
  assert.deepEqual(await fetchKultfilmlerText("https://evil.example/x"), { ok: false, reason: "http" });
  setKultfilmlerOrigin("https://kultfilmler2.net/");
  assert.equal(kultfilmlerSessionUrl(), "https://kultfilmler2.net/wp-admin/admin-ajax.php?action=kf_live_search&q=");
  assert.deepEqual(await fetchKultfilmlerText("https://kultfilmler.net/x"), { ok: false, reason: "http" });
  __resetKultfilmlerSessionForTests();
});

test("messages that aren't the session's own are ignored", () => {
  __resetKultfilmlerSessionForTests();
  handleKultfilmlerMessage("not json");
  handleKultfilmlerMessage(JSON.stringify({ kf: "fetch", id: 99, status: 200, body: "x" }));
  handleKultfilmlerMessage(JSON.stringify({ hello: "world" }));
});

test("the session WebView may load the site and Cloudflare's challenge, nothing else", () => {
  __resetKultfilmlerSessionForTests();
  assert.equal(isKultfilmlerNavigationAllowed(kultfilmlerSessionUrl()), true);
  assert.equal(isKultfilmlerNavigationAllowed("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x"), true);
  assert.equal(isKultfilmlerNavigationAllowed("about:blank"), true);
  assert.equal(isKultfilmlerNavigationAllowed("https://shorterwanderer.com/ad"), false);
  assert.equal(isKultfilmlerNavigationAllowed("intent://x#Intent;end"), false);
});

test("the session WebView is drawn: a real size and a non-zero opacity", () => {
  // Android never draws a view at opacity 0, and an undrawn WebView gets no
  // animation frames, so Cloudflare's challenge stalls (2026-10-23, every phone).
  const source = readFileSync(join(process.cwd(), "src/components/common/KultfilmlerBridge.tsx"), "utf8");
  const host = source.match(/host:\s*\{([^}]*)\}/)?.[1] ?? "";
  const number = (key: string) => Number(host.match(new RegExp(`${key}:\\s*([\\d.]+)`))?.[1]);
  assert.ok(number("opacity") > 0, "opacity must be above zero");
  assert.ok(number("width") >= 300 && number("height") >= 300, "a phone-sized viewport");
});

// ---------------------------------------------------------------------------
// Parsing: search answers, series pages, watch pages and players, from the
// live site's shapes (2026-10-23).
// ---------------------------------------------------------------------------

const SEARCH = {
  success: true,
  data: [
    { title: "The Godfather III – Baba 3", url: "https://kultfilmler.net/the-godfather-iii-baba-3/", year: "1990", type: "Film" },
    { title: "The Godfather – Baba", url: "https://kultfilmler.net/the-godfather-baba-1-izle/", year: "1972", type: "Film" },
    { title: "Baba 2 – The Godfather II", url: "https://kultfilmler.net/baba-2-the-godfather-2-izle/", year: "1974", type: "Film" },
    { title: "İhtiyar Delikanlı – Oldboy", url: "https://kultfilmler.net/ihtiyar-delikanli-oldboy-izle/", year: "2003", type: "Film" },
    { title: "Dune 1984", url: "https://kultfilmler.net/dune-1984-izle/", year: "1984", type: "Film" },
    { title: "Sherlock", url: "https://kultfilmler.net/dizi/sherlock-izle/", year: "2010–2017", type: "Dizi" },
    { title: "Elsewhere", url: "https://evil.example/elsewhere/", year: "1972", type: "Film" },
  ],
};

test("search answers are ranked by title and held to the year", () => {
  const godfather = __internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "The Godfather", year: "1972" }, ["The Godfather"]);
  assert.deepEqual(godfather.map((c) => c.url), ["https://kultfilmler.net/the-godfather-baba-1-izle/"]);

  // Either half of the joined name counts, and the original title is enough.
  const oldboy = __internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "Oldboy", year: "2003" }, ["Oldboy"]);
  assert.equal(oldboy[0]?.url, "https://kultfilmler.net/ihtiyar-delikanli-oldboy-izle/");
  assert.deepEqual(
    __internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "Oldboy", year: "2013" }, ["Oldboy"]),
    [],
    "the 2013 remake is not the 2003 film"
  );

  // A year written into the name is not part of the title.
  assert.equal(
    __internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "Dune", year: "1984" }, ["Dune"])[0]?.url,
    "https://kultfilmler.net/dune-1984-izle/"
  );
  assert.deepEqual(__internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "Dune", year: "2021" }, ["Dune"]), []);

  // Series are "Dizi", dated by their first year.
  assert.equal(
    __internal.rankKultfilmlerResults(SEARCH, { mediaType: "tv", title: "Sherlock", year: "2010" }, ["Sherlock"])[0]?.url,
    "https://kultfilmler.net/dizi/sherlock-izle/"
  );
  assert.deepEqual(__internal.rankKultfilmlerResults(SEARCH, { mediaType: "movie", title: "Sherlock", year: "2010" }, ["Sherlock"]), []);
  assert.deepEqual(__internal.rankKultfilmlerResults({ success: true, data: "nope" }, { mediaType: "movie", title: "x" }, ["x"]), []);
});

const SERIES_PAGE = `
<div class="seasontabs"><button data-season="1" class="on">1. Sezon</button><button data-season="2">2. Sezon</button></div>
<div class="eps" data-season="1">
  <a class="ep" href="https://kultfilmler.net/bolum/sherlock-1-sezon-1-bolum/"><span class="ecc">CC</span><h4>1. Sezon 1. Bölüm</h4></a>
  <a class="ep" href="https://kultfilmler.net/bolum/sherlock-1-sezon-2-bolum/"><h4>1. Sezon 2. Bölüm</h4></a>
</div>
<div class="eps" data-season="2" style="display:none">
  <a class="ep" href="https://kultfilmler.net/bolum/sherlock-2-sezon-1-bolum/"><h4>2. Sezon 1. Bölüm</h4></a>
  <a class="ep" href="https://kultfilmler.net/bolum/sherlock-2-sezon-3-bolum/"><h4>2. Sezon 3. Bölüm</h4></a>
</div>
<a class="play" href="https://kultfilmler.net/bolum/sherlock-1-sezon-1-bolum/">İlk Bölümü İzle</a>`;

test("an episode is found under its own season", () => {
  assert.equal(__internal.readKultfilmlerEpisodeUrl(SERIES_PAGE, 2, 1), "https://kultfilmler.net/bolum/sherlock-2-sezon-1-bolum/");
  assert.equal(__internal.readKultfilmlerEpisodeUrl(SERIES_PAGE, 2, 3), "https://kultfilmler.net/bolum/sherlock-2-sezon-3-bolum/");
  assert.equal(__internal.readKultfilmlerEpisodeUrl(SERIES_PAGE, 1, 2), "https://kultfilmler.net/bolum/sherlock-1-sezon-2-bolum/");
  assert.equal(__internal.readKultfilmlerEpisodeUrl(SERIES_PAGE, 2, 2), null);
  assert.equal(__internal.readKultfilmlerEpisodeUrl(SERIES_PAGE, 3, 1), null);
});

test("a watch page's players are read, the original audio before the dub", () => {
  const page = `<script>var x = 1;</script><script>[{"name":"PUB","langLabel":"T\\u00fcrk\\u00e7e Dublaj","html":"\\u003Ciframe src=\\"https:\\/\\/vidpapi.xyz\\/video\\/13f320e7b5ead1024ac95c3b208610db\\" width=\\"100%\\"\\u003E\\u003C\\/iframe\\u003E"},{"name":"KULT","langLabel":"Altyaz\\u0131l\\u0131","html":"\\u003Ciframe src=\\"https:\\/\\/vidpapi.xyz\\/video\\/c74d97b01eae257e44aa9d5bade97baf\\"\\u003E\\u003C\\/iframe\\u003E"},{"name":"OK","langLabel":"Altyaz\\u0131l\\u0131","html":"\\u003Ciframe width=\\"560\\" src=\\"\\/\\/ok.ru\\/videoembed\\/10113392314961?nochat=1\\"\\u003E\\u003C\\/iframe\\u003E"}]</script>`;
  assert.deepEqual(__internal.readKultfilmlerSources(page), [
    { label: "Altyazılı", embedUrl: "https://vidpapi.xyz/video/c74d97b01eae257e44aa9d5bade97baf" },
    { label: "Altyazılı", embedUrl: "https://ok.ru/videoembed/10113392314961?nochat=1" },
    { label: "Türkçe Dublaj", embedUrl: "https://vidpapi.xyz/video/13f320e7b5ead1024ac95c3b208610db" },
  ]);
  assert.deepEqual(__internal.readKultfilmlerSources('<div class="kf-soon">Bu bölüm çok yakında</div>'), []);
});

test("an ok.ru embed's HLS manifest is read from its data-options", () => {
  const metadata = JSON.stringify({ hlsManifestUrl: "https://vd659.okcdn.ru/video.m3u8?cmd=videoPlayerCdn&srcIp=1.2.3.4", videos: [] });
  const options = JSON.stringify({ flashvars: { metadata } });
  const attribute = options.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  assert.equal(
    __internal.readOkRuHlsManifest(`<div data-module="OKVideo" data-options="${attribute}"></div>`),
    "https://vd659.okcdn.ru/video.m3u8?cmd=videoPlayerCdn&srcIp=1.2.3.4"
  );
  assert.equal(__internal.readOkRuHlsManifest("<div>Видео заблокировано</div>"), null);
  assert.equal(__internal.readOkRuHlsManifest('<div data-options="{&quot;flashvars&quot;:{}}"></div>'), null);
});

test("a FirePlayer embed's IMDb id is read when it names one", () => {
  assert.equal(__internal.readFirePlayerImdbId("FirePlayer|a6ea84|skin|tt0364569|displaytitle"), "tt0364569");
  assert.equal(__internal.readFirePlayerImdbId("FirePlayer|a6ea84|skin"), null);
});
