import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { createWebSession } from "../src/services/webSession";

// Read only at call time, so setting it after the imports is enough.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// The hidden-WebView session, on its own. HDFilm served two or three viewers a
// day for a week while every phone reported its session "ready" (2026-11-19 on),
// and a read that went unanswered inside a ready session held the whole 20s
// resolve. These are the session's guards against a page that does not answer.
// ---------------------------------------------------------------------------

type FakeHost = { scripts: string[]; reloads: number };

function openSession() {
  const session = createWebSession({
    eventName: "test_web",
    initialOrigin: "https://site.example",
    sessionUrl: (origin) => `${origin}/hold`,
    readyExpression: "!challenge",
    challengeTimeoutMs: 12_000,
    requestTimeoutMs: 8_000,
    idleCloseMs: 180_000,
    failureCooldownMs: 180_000,
  });
  const host: FakeHost = { scripts: [], reloads: 0 };
  const generations: number[] = [];
  session.subscribe((open, generation) => {
    generations.push(generation);
    session.attachHost(
      open ? { evaluate: (script) => host.scripts.push(script), reload: () => (host.reloads += 1) } : null
    );
  });
  const send = (message: Record<string, unknown>) => session.handleMessage(JSON.stringify(message));
  const idOf = (script: string) => Number(script.match(/id: (\d+)/)?.[1]);
  return { session, host, generations, send, idOf, pageReady: () => send({ kf: "page", ready: true }) };
}

const URL_A = "https://site.example/a";

test("a read sent in a ready session gets a request's time, not the challenge's as well", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { session, host, send, idOf, pageReady } = openSession();
  try {
    const pending = session.fetchText(URL_A);
    pageReady();
    send({ kf: "ack", id: idOf(host.scripts[0]) });
    let settled: unknown = null;
    void pending.then((result) => (settled = result));

    mock.timers.tick(8_999);
    await Promise.resolve();
    assert.equal(settled, null, "still inside the 8s request budget (plus a second for the page's own abort)");
    mock.timers.tick(1);
    assert.deepEqual(await pending, { ok: false, reason: "timeout" }, "it used to wait 20s: the challenge budget too");
  } finally {
    mock.timers.reset();
    session.resetForTests();
  }
});

test("the page aborts a read that hangs, and says so", () => {
  const { session, host, pageReady } = openSession();
  try {
    void session.fetchText(URL_A);
    pageReady();
    const script = host.scripts[0];
    assert.ok(script.includes('post({ kf: "ack", id: 1 });'), "the page confirms the script started");
    assert.ok(script.includes("controller.abort(); }, 8000)"), "the fetch is aborted at the request budget");
    assert.ok(script.includes('fetch("https://site.example/a", { credentials: "same-origin", headers: {},'));
  } finally {
    session.resetForTests();
  }
});

test("a WebView that never starts the request is replaced once, and the request sent again", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { session, host, generations, send, idOf, pageReady } = openSession();
  try {
    const pending = session.fetchText(URL_A);
    pageReady();
    assert.equal(host.scripts.length, 1);
    assert.equal(generations.at(-1), 0);

    // No ack: the script never ran (the WebView's process was killed, say).
    mock.timers.tick(2_500);
    assert.equal(generations.at(-1), 1, "the bridge is told to mount a fresh WebView");
    assert.equal(session.isOpening(), true);

    pageReady();
    assert.equal(host.scripts.length, 2, "the same request goes out on the new page");
    assert.equal(idOf(host.scripts[1]), idOf(host.scripts[0]));
    send({ kf: "ack", id: idOf(host.scripts[1]) });
    send({ kf: "fetch", id: idOf(host.scripts[1]), status: 200, challenged: false, body: "<html>a</html>" });
    assert.deepEqual(await pending, { ok: true, body: "<html>a</html>" });
  } finally {
    mock.timers.reset();
    session.resetForTests();
  }
});

test("a second silence after the replacement fails the request instead of looping", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { session, generations, pageReady } = openSession();
  try {
    const pending = session.fetchText(URL_A);
    pageReady();
    mock.timers.tick(2_500);
    pageReady();
    mock.timers.tick(2_500);
    assert.deepEqual(await pending, { ok: false, reason: "timeout" });
    assert.equal(generations.at(-1), 1, "replaced once, not again");
  } finally {
    mock.timers.reset();
    session.resetForTests();
  }
});

test("a request the page acknowledged is left to finish", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { session, host, generations, send, idOf, pageReady } = openSession();
  try {
    void session.fetchText(URL_A);
    pageReady();
    send({ kf: "ack", id: idOf(host.scripts[0]) });
    mock.timers.tick(5_000);
    assert.equal(generations.at(-1), 0, "a slow site is not a dead WebView");
    assert.equal(session.isReady(), true);
  } finally {
    mock.timers.reset();
    session.resetForTests();
  }
});

test("a killed renderer is replaced when something is waiting on it, and let go when nothing is", async () => {
  const { session, host, generations, send, idOf, pageReady } = openSession();
  try {
    const pending = session.fetchText(URL_A);
    pageReady();
    send({ kf: "ack", id: idOf(host.scripts[0]) });
    session.handleProcessGone();
    assert.equal(generations.at(-1), 1);
    pageReady();
    assert.equal(host.scripts.length, 2);
    send({ kf: "fetch", id: idOf(host.scripts[1]), status: 200, challenged: false, body: "ok" });
    assert.deepEqual(await pending, { ok: true, body: "ok" });

    session.handleProcessGone();
    assert.equal(session.isReady(), false, "idle: closed, and the next request opens a new one");
    assert.equal(session.isOpening(), false);
  } finally {
    session.resetForTests();
  }
});

test("the start of an error page comes back with its status", async () => {
  const { session, host, send, idOf, pageReady } = openSession();
  try {
    const pending = session.fetchText(URL_A);
    pageReady();
    send({ kf: "fetch", id: idOf(host.scripts[0]), status: 403, challenged: false, body: "x".repeat(5_000) });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "http");
    assert.equal(!result.ok && result.status, 403);
    assert.equal(!result.ok && result.body?.length, 2_000, "enough to recognise a block page, not the whole page");
  } finally {
    session.resetForTests();
  }
});

test("a read can carry its own request headers", () => {
  const { session, host, pageReady } = openSession();
  try {
    void session.fetchText(URL_A, { headers: { "X-Requested-With": "fetch", Accept: "application/json" } });
    pageReady();
    assert.ok(host.scripts[0].includes('headers: {"X-Requested-With":"fetch","Accept":"application/json"},'));
  } finally {
    session.resetForTests();
  }
});
