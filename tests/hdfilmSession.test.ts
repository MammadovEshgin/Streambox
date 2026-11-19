import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { hdfilmSession, isHdfilmAppBlockBody, isHdfilmAppBlockResponse, isHdfilmSessionPath } from "../src/services/hdfilmSession";
import { __internal } from "../src/services/WebPlayerService";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// HDFilm's series pages sit behind a Cloudflare challenge since 2026-11-11.
// A page still challenged after the native retries is read through the HDFilm
// WebView session; films, search and players never are. A fake host stands in
// for the WebView.
// ---------------------------------------------------------------------------

const BASE = "https://www.hdfilmcehennemi.nl";
const EPISODE = `${BASE}/dizi/the-institute-1/sezon-1/bolum-4/`;
const FILM = `${BASE}/verity-2026/`;
const EPISODE_HTML = '<html><button class="alternative-link" data-video="1">Türkçe</button></html>';

type FakeHost = { scripts: string[] };

function openFakeBridge(): FakeHost {
  const host: FakeHost = { scripts: [] };
  hdfilmSession.subscribe((open) => {
    hdfilmSession.attachHost(open ? { evaluate: (script) => host.scripts.push(script), reload: () => undefined } : null);
  });
  return host;
}

function challenge(): Error {
  return Object.assign(new Error("Request failed with status code 403"), {
    response: { status: 403, headers: { "cf-mitigated": "challenge" }, data: "<title>Just a moment...</title>" },
  });
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), "condition never held");
}

function answerLast(host: FakeHost, body: string) {
  const id = Number(host.scripts.at(-1)?.match(/id: (\d+)/)?.[1]);
  hdfilmSession.handleMessage(JSON.stringify({ kf: "fetch", id, status: 200, challenged: false, body }));
}

test("every HDFilm page but the search endpoint is a session path", () => {
  hdfilmSession.resetForTests();
  assert.equal(isHdfilmSessionPath(EPISODE), true);
  assert.equal(isHdfilmSessionPath(`${BASE}/dizi/the-institute-1/`), true);
  assert.equal(isHdfilmSessionPath(`${BASE}/rplayer/rzkjymtky9wh/`), true);
  // Film pages are challenged too since 2026-11-19 (Verity, The Dog Stars).
  assert.equal(isHdfilmSessionPath(FILM), true);
  // Search is a JSON endpoint with its own request header, and is not gated.
  assert.equal(isHdfilmSessionPath(`${BASE}/search/?q=dizi`), false);
  // The .mobi embed host is a different origin and stays native.
  assert.equal(isHdfilmSessionPath("https://hdfilmcehennemi.mobi/video/embed/x/"), false);
  assert.equal(isHdfilmSessionPath("not a url"), false);
});

test("HDFilm's app-block page is recognised by its body, not a header", () => {
  assert.equal(isHdfilmAppBlockResponse(403, "<h1>Bu uygulama desteklenmiyor</h1>"), true);
  assert.equal(isHdfilmAppBlockResponse(403, 'c.href="intent://h/#Intent;scheme=https;package=com.android.chrome;end"'), true);
  assert.equal(isHdfilmAppBlockResponse(403, "<title>Just a moment...</title>"), false, "the Cloudflare challenge is not an app-block");
  assert.equal(isHdfilmAppBlockResponse(404, "desteklenmiyor"), false, "only a 403 is the app-block");
  assert.equal(isHdfilmAppBlockResponse(200, "<html>the real player</html>"), false);
  // By its text alone (a 200 can carry it); a page that merely says a browser
  // feature is unsupported is not it.
  assert.equal(isHdfilmAppBlockBody("<title>Uygulama desteklenmiyor | HD Film Cehennemi</title>"), true);
  assert.equal(isHdfilmAppBlockBody("<video>Tarayıcınız desteklenmiyor</video>"), false);
});

test("the session holds a page under /dizi/ and is ready on anything but the challenge", () => {
  hdfilmSession.resetForTests();
  assert.equal(hdfilmSession.sessionUrl(), `${BASE}/dizi/streambox/`);
  assert.match(hdfilmSession.pageProbe, /ready = !!document\.body && !\/just a moment\|attention required\/i\.test\(document\.title\);/);
  assert.equal(hdfilmSession.isNavigationAllowed(`${BASE}/dizi/streambox/`), true);
  assert.equal(hdfilmSession.isNavigationAllowed("https://ads.example/x"), false);
});

test("a series page still challenged after the retries is read through the session", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  const host = openFakeBridge();
  const originalGet = axios.get;
  let nativeCalls = 0;
  axios.get = (async () => {
    nativeCalls += 1;
    throw challenge();
  }) as typeof axios.get;
  try {
    const check = __internal.checkVideoAvailability(EPISODE);
    await until(() => hdfilmSession.isOpening());
    assert.equal(nativeCalls, 3, "the native request and its two retries come first");

    hdfilmSession.handleMessage(JSON.stringify({ kf: "page", ready: false, title: "Just a moment..." }));
    assert.equal(host.scripts.length, 0, "nothing runs on the challenge page");
    hdfilmSession.handleMessage(JSON.stringify({ kf: "page", ready: true, title: "404 Hata" }));
    await until(() => host.scripts.length === 1);
    assert.match(host.scripts[0], /fetch\("https:\/\/www\.hdfilmcehennemi\.nl\/dizi\/the-institute-1\/sezon-1\/bolum-4\/"/);
    answerLast(host, EPISODE_HTML);
    assert.equal((await check).available, true);

    // Open now: the next series page goes straight to the session.
    const next = __internal.checkVideoAvailability(`${BASE}/dizi/the-institute-1/sezon-1/bolum-5/`);
    await until(() => host.scripts.length === 2);
    answerLast(host, EPISODE_HTML);
    assert.equal((await next).available, true);
    assert.equal(nativeCalls, 3, "no native request while the session is open");
  } finally {
    axios.get = originalGet;
    hdfilmSession.resetForTests();
  }
});

test("a challenged film page is read through the session; search and the site's own 403s are not", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  const host = openFakeBridge();
  const originalGet = axios.get;
  try {
    axios.get = (async () => {
      throw Object.assign(new Error("403"), { response: { status: 403, headers: {}, data: "Forbidden" } });
    }) as typeof axios.get;
    assert.equal((await __internal.checkVideoAvailability(EPISODE)).available, false);
    assert.equal(hdfilmSession.isOpening(), false, "the site's own 403 is an answer, not a gate");

    axios.get = (async () => {
      throw challenge();
    }) as typeof axios.get;
    const check = __internal.checkVideoAvailability(FILM);
    await until(() => hdfilmSession.isOpening());
    hdfilmSession.handleMessage(JSON.stringify({ kf: "page", ready: true, title: "404 Hata" }));
    await until(() => host.scripts.length === 1);
    assert.ok(host.scripts[0].includes('fetch("https://www.hdfilmcehennemi.nl/verity-2026/"'));
    answerLast(host, EPISODE_HTML);
    assert.equal((await check).available, true, "Verity (2026): only HDFilm has it, and its page is challenged");
  } finally {
    axios.get = originalGet;
    hdfilmSession.resetForTests();
  }
});

test("while the session is still opening, pages wait on it instead of being asked natively", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  const host = openFakeBridge();
  const originalGet = axios.get;
  let nativeCalls = 0;
  axios.get = (async () => {
    nativeCalls += 1;
    throw challenge();
  }) as typeof axios.get;
  try {
    hdfilmSession.warm();
    assert.equal(hdfilmSession.isOpening(), true);
    const check = __internal.checkVideoAvailability(FILM);
    hdfilmSession.handleMessage(JSON.stringify({ kf: "page", ready: true, title: "404 Hata" }));
    await until(() => host.scripts.length === 1);
    answerLast(host, EPISODE_HTML);
    assert.equal((await check).available, true);
    assert.equal(nativeCalls, 0, "three challenged native tries would only have been thrown away");
  } finally {
    axios.get = originalGet;
    hdfilmSession.resetForTests();
  }
});

test("with no bridge mounted a challenged series page fails as before", async () => {
  hdfilmSession.resetForTests();
  __internal.resetProviderSilence();
  const originalGet = axios.get;
  axios.get = (async () => {
    throw challenge();
  }) as typeof axios.get;
  try {
    assert.equal((await __internal.checkVideoAvailability(EPISODE)).available, false);
  } finally {
    axios.get = originalGet;
  }
});

test("a detail page warms the session unless a native request got through lately", async () => {
  const { mock } = await import("node:test");
  const { __resetHdfilmChallengeForTests, noteHdfilmChallenge, noteHdfilmNativePass, scheduleHdfilmWarm } = await import("../src/services/hdfilmSession");
  hdfilmSession.resetForTests();
  __resetHdfilmChallengeForTests();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
  try {
    openFakeBridge();
    const cancel = scheduleHdfilmWarm();
    cancel();
    mock.timers.tick(1_500);
    assert.equal(hdfilmSession.isOpening(), false, "leaving the page cancels it");

    scheduleHdfilmWarm();
    mock.timers.tick(1_499);
    assert.equal(hdfilmSession.isOpening(), false, "not for a page skimmed past");
    mock.timers.tick(1);
    assert.equal(hdfilmSession.isOpening(), true, "every HDFilm page is gated, so the session is started ahead of Watch");

    hdfilmSession.resetForTests();
    openFakeBridge();
    noteHdfilmNativePass();
    scheduleHdfilmWarm();
    mock.timers.tick(1_500);
    assert.equal(hdfilmSession.isOpening(), false, "a native request just got through: the gate is down");

    noteHdfilmChallenge();
    scheduleHdfilmWarm();
    mock.timers.tick(1_500);
    assert.equal(hdfilmSession.isOpening(), true, "challenged again: warmed again");

    hdfilmSession.resetForTests();
    openFakeBridge();
    noteHdfilmNativePass();
    mock.timers.tick(31 * 60_000);
    scheduleHdfilmWarm();
    mock.timers.tick(1_500);
    assert.equal(hdfilmSession.isOpening(), true, "a pass half an hour old says nothing about now");
  } finally {
    mock.timers.reset();
    hdfilmSession.resetForTests();
    __resetHdfilmChallengeForTests();
  }
});
