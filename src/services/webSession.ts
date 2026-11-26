/**
 * webSession
 *
 * A site behind a Cloudflare managed challenge (`403 cf-mitigated: challenge`,
 * a "Just a moment…" page) answers only a real browser engine. A browser
 * passes it on its own in a few seconds, with no click, and from then on the
 * site answers normally.
 *
 * So such a site is read through a hidden WebView (`WebSessionBridge`). It
 * loads one small page of the site, and every request then runs as a
 * same-origin `fetch()` inside that page. The bodies come back over
 * `postMessage`. Nothing fetched is ever rendered or executed.
 *
 * The clearance cookie is NOT lifted out into native requests. It is bound to
 * the WebView's exact user agent, and native networking does not share the
 * WebView's cookie store on iOS. Fetching from inside the page needs neither.
 *
 * Kült Filmler (every page challenged) and HDFilm (its series pages since
 * 2026-11-11) each hold one session made here.
 */

import { trackEvent } from "./telemetryService";

/** What the bridge component exposes to drive its WebView. */
export type WebSessionHost = {
  /** Run a script in the page. */
  evaluate(script: string): void;
  /** Reload the page, which re-runs the challenge when the clearance lapsed. */
  reload(): void;
};

export type WebSessionFetchResult =
  | { ok: true; body: string }
  /**
   * `unavailable`: the session could not be opened recently, so nothing was
   * asked (not a failure of this request). `timeout`: no answer in time, which
   * is worth asking again. `http`: the site answered with an error status;
   * `body` is the start of that error page, enough to tell a block page apart.
   */
  | { ok: false; reason: "unavailable" | "timeout" | "http"; status?: number; body?: string };

/** Extra request headers for one read (same-origin, so any header may be set). */
export type WebSessionFetchOptions = { headers?: Record<string, string> };

export type WebSessionOptions = {
  /** Telemetry event for the session's outcomes (`ready`, `challenge_timeout`, …). */
  eventName: string;
  initialOrigin: string;
  /** The page the WebView holds, on `origin`. */
  sessionUrl(origin: string): string;
  /** JS expression, run in the loaded page: true once the page is past the challenge. */
  readyExpression: string;
  /**
   * JS expression, run in the loaded page: true on a page of the site's own that
   * turns this network away (a legal-block page, say). Like Cloudflare's block
   * page, there is nothing to wait out.
   */
  blockedExpression?: string;
  /** The session opened on a block page; `title` is that page's. */
  onBlocked?(title: string): void;
  /** How long the challenge may take before the session gives up. */
  challengeTimeoutMs: number;
  /** One request inside a cleared session. */
  requestTimeoutMs: number;
  /** Keep the WebView alive between plays for this long. */
  idleCloseMs: number;
  /** After a challenge that could not be passed, don't try again for this long. */
  failureCooldownMs: number;
};

export type WebSession = ReturnType<typeof createWebSession>;

type Pending = {
  id: number;
  url: string;
  headers: Record<string, string> | undefined;
  /** Sent again once already, after the clearance lapsed. */
  retried: boolean;
  /** The WebView was replaced once already for this request. */
  recycled: boolean;
  timer: ReturnType<typeof setTimeout>;
  /** Runs out when the page never confirms it started the request. */
  ackTimer: ReturnType<typeof setTimeout> | null;
  resolve: (result: WebSessionFetchResult) => void;
};

/**
 * How long the page has to confirm a request script started. It answers in
 * milliseconds; silence means the script never ran — the WebView's process was
 * killed, or it was mid-navigation — and without this the request sat out its
 * whole timeout on a page that was never going to answer.
 */
const ACK_TIMEOUT_MS = 2_500;
/** How much of an error page is carried back (a block page is recognised by its text). */
const ERROR_BODY_LIMIT = 2_000;

type Phase = "closed" | "opening" | "ready";

/**
 * Runs after every page load. The session is ready once `readyExpression`
 * holds. The expression may use `text` (the page's text) and `challenge`, which
 * is true on Cloudflare's challenge page whatever language it is shown in: the
 * page's title is translated to the phone's language ("Один момент…", "Un
 * instant…"), so a test for the English title alone calls that page ready.
 * `blocked` is Cloudflare's block page ("Attention Required!", "Sorry,
 * you have been blocked"): the site turns this network away outright, so there
 * is no challenge to wait out.
 */
export function webSessionPageProbe(readyExpression: string, blockedExpression = "false"): string {
  return `(function () {
  var text = document.body ? document.body.innerText : "";
  var chl = window._cf_chl_opt;
  var challenge = !!(chl && typeof chl.cType === "string" && chl.cType);
  var ready = false;
  try { ready = ${readyExpression}; } catch (e) {}
  var siteBlocked = false;
  try { siteBlocked = !!(${blockedExpression}); } catch (e) {}
  var engine = String(navigator.userAgent || "").split("Chrome/")[1];
  window.ReactNativeWebView.postMessage(JSON.stringify({
    kf: "page",
    ready: ready,
    engine: parseInt(engine, 10) || 0,
    blocked: siteBlocked || !!document.getElementById("cf-error-details") || /you have been blocked/i.test(text),
    title: String(document.title || "").slice(0, 60),
    visibility: String(document.visibilityState || ""),
    challengeFrame: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')
  }));
})();
true;`;
}

function fetchScript(
  id: number,
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number
): string {
  return `(function () {
  var post = function (message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); };
  post({ kf: "ack", id: ${id} });
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, ${timeoutMs}) : null;
  var done = function (message) { if (timer) clearTimeout(timer); post(message); };
  fetch(${JSON.stringify(url)}, { credentials: "same-origin", headers: ${JSON.stringify(headers ?? {})},
    signal: controller ? controller.signal : undefined })
    .then(function (response) {
      return response.text().then(function (body) {
        done({ kf: "fetch", id: ${id}, status: response.status,
          challenged: response.headers.get("cf-mitigated") === "challenge",
          body: response.ok ? body : body.slice(0, ${ERROR_BODY_LIMIT}) });
      });
    })
    .catch(function () { done({ kf: "fetch", id: ${id}, status: 0, challenged: false, body: "" }); });
})();
true;`;
}

export function createWebSession(options: WebSessionOptions) {
  const pageProbe = webSessionPageProbe(options.readyExpression, options.blockedExpression);

  let phase: Phase = "closed";
  let host: WebSessionHost | null = null;
  let openedAt = 0;
  let unavailableUntil = 0;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let challengeTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(open: boolean, generation: number) => void>();
  /** Bumped to make the bridge mount a new WebView in place of a dead one. */
  let generation = 0;
  /** The page's browser engine version, for telemetry (0 = unknown). */
  let engine = 0;
  /** What the page last reported, for the telemetry of a challenge that never clears. */
  let pageLoads = 0;
  let lastPage: { title: string; visibility: string; challengeFrame: boolean } | null = null;
  let origin = options.initialOrigin;

  function sessionUrl(): string {
    return options.sessionUrl(origin);
  }

  /** The origin the session runs on; follows the provider config. */
  function setOrigin(baseUrl: string): void {
    let next: string;
    try {
      next = new URL(baseUrl).origin;
    } catch {
      return;
    }
    if (next === origin) return;
    origin = next;
    // A session on the old domain can't fetch the new one same-origin.
    if (phase !== "closed") close();
  }

  function getOrigin(): string {
    return origin;
  }

  /** The bridge mounts its WebView while this reports open. */
  function subscribe(listener: (open: boolean, generation: number) => void): () => void {
    listeners.add(listener);
    listener(phase !== "closed", generation);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Called by the bridge when its WebView mounts (with a host) and unmounts (null). */
  function attachHost(next: WebSessionHost | null): void {
    host = next;
    // The WebView went away under an open session (the app shell remounted):
    // nothing queued can be answered any more.
    if (!next && phase !== "closed") close();
  }

  /** Start passing the challenge ahead of need. */
  function warm(): void {
    if (listeners.size === 0 || Date.now() < unavailableUntil) return;
    if (phase === "closed") open();
  }

  /** Warm once `delayMs` has passed. Returns the cancel. */
  function scheduleWarm(delayMs: number): () => void {
    const timer = setTimeout(warm, delayMs);
    return () => clearTimeout(timer);
  }

  /**
   * The viewer asked again (Retry on "Not available"): a challenge that stalled a
   * minute ago gets another go now instead of when the cooldown ends.
   */
  function liftCooldown(): void {
    unavailableUntil = 0;
  }

  /** Still passing the challenge: a request now would wait on it. */
  function isOpening(): boolean {
    return phase === "opening";
  }

  /** Past the challenge: a request now runs at once. */
  function isReady(): boolean {
    return phase === "ready" && host !== null;
  }

  /** GET a same-origin URL on the site. Never rejects. */
  function fetchText(url: string, fetchOptions: WebSessionFetchOptions = {}): Promise<WebSessionFetchResult> {
    // No bridge mounted (outside the app shell) means no WebView will ever open.
    if (listeners.size === 0 || Date.now() < unavailableUntil) {
      return Promise.resolve({ ok: false, reason: "unavailable" });
    }
    if (!isSameOrigin(url)) return Promise.resolve({ ok: false, reason: "http" });

    return new Promise((resolve) => {
      const id = nextId++;
      const request: Pending = {
        id,
        url,
        headers: fetchOptions.headers,
        retried: false,
        recycled: false,
        // Covers the challenge too: a request queued while the session opens
        // waits for it, and the challenge timer fails it sooner if it can't.
        // Once the request is actually sent, `dispatch` shortens this.
        timer: setTimeout(() => settle(id, { ok: false, reason: "timeout" }), queuedTimeoutMs()),
        ackTimer: null,
        resolve,
      };
      pending.set(id, request);
      clearIdleTimer();
      if (phase === "ready" && host) dispatch(request);
      else open();
    });
  }

  /** Messages from the WebView. Anything not shaped like ours is ignored. */
  function handleMessage(raw: string): void {
    let message: {
      kf?: unknown;
      ready?: unknown;
      id?: unknown;
      status?: unknown;
      challenged?: unknown;
      body?: unknown;
      title?: unknown;
      visibility?: unknown;
      challengeFrame?: unknown;
      blocked?: unknown;
      engine?: unknown;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message?.kf === "page") {
      if (phase === "closed") return;
      pageLoads += 1;
      lastPage = {
        title: typeof message.title === "string" ? message.title : "",
        visibility: typeof message.visibility === "string" ? message.visibility : "",
        challengeFrame: message.challengeFrame === true,
      };
      if (typeof message.engine === "number" && message.engine > 0) engine = message.engine;
      if (message.blocked === true && phase === "opening") {
        giveUp("blocked");
        options.onBlocked?.(lastPage.title);
        return;
      }
      if (message.ready !== true) return;
      if (phase === "opening") {
        trackEvent(options.eventName, "network", {
          outcome: "ready",
          ms: Date.now() - openedAt,
          loads: pageLoads,
          engine,
          // Which page the session took for "ready". On most phones HDFilm's
          // session was ready after ONE page load and never served a stream,
          // while the phones it worked on showed two (challenge, then page):
          // the title says what the others were holding.
          title: lastPage.title,
        });
      }
      phase = "ready";
      clearChallengeTimer();
      for (const request of pending.values()) dispatch(request);
      // Warmed ahead of need: nothing to send yet, so start the idle clock.
      if (pending.size === 0) scheduleIdleClose();
      return;
    }

    if ((message?.kf !== "fetch" && message?.kf !== "ack") || typeof message.id !== "number") return;
    const request = pending.get(message.id);
    if (!request) return;
    // The page is alive and running the request.
    clearAckTimer(request);
    if (message.kf === "ack") return;
    const status = typeof message.status === "number" ? message.status : 0;

    // The clearance lapsed mid-session: pass the challenge again, then retry once.
    if (status === 403 && message.challenged === true && !request.retried) {
      request.retried = true;
      phase = "opening";
      openedAt = Date.now();
      startChallengeTimer();
      // Everything queued waits on the challenge again.
      for (const queued of pending.values()) {
        clearAckTimer(queued);
        armTimer(queued, queuedTimeoutMs());
      }
      host?.reload();
      return;
    }

    if (status >= 200 && status < 300 && typeof message.body === "string") {
      settle(request.id, { ok: true, body: message.body });
    } else if (status === 0) {
      settle(request.id, { ok: false, reason: "timeout" });
    } else {
      const body = typeof message.body === "string" ? message.body.slice(0, ERROR_BODY_LIMIT) : "";
      settle(request.id, { ok: false, reason: "http", status, body });
    }
  }

  /**
   * The WebView's renderer process is gone (Android kills it under memory
   * pressure, iOS terminates the content process). The view is a dead shell:
   * scripts injected into it do nothing, so it is replaced.
   */
  function handleProcessGone(): void {
    if (phase === "closed") return;
    if (pending.size === 0) close();
    else recycle("process_gone");
  }

  /**
   * The session WebView could not load the page at all (no DNS, no connection):
   * the bridge reports it at once instead of the challenge timer finding out
   * later.
   */
  function handleLoadError(description: string): void {
    if (phase === "opening") giveUp("load_error", { error: description.slice(0, 80) });
  }

  /**
   * What the session WebView may load: the site itself, and Cloudflare's
   * challenge frame (iOS asks about frames too). Anything else, an ad redirect
   * say, is refused.
   */
  function isNavigationAllowed(url: string): boolean {
    if (url === "about:blank" || url.startsWith("about:srcdoc")) return true;
    try {
      const parsed = new URL(url);
      return parsed.origin === origin || parsed.origin === "https://challenges.cloudflare.com";
    } catch {
      return false;
    }
  }

  /** A request not yet sent waits out the challenge first. */
  function queuedTimeoutMs(): number {
    return options.challengeTimeoutMs + options.requestTimeoutMs;
  }

  function armTimer(request: Pending, ms: number): void {
    clearTimeout(request.timer);
    request.timer = setTimeout(() => settle(request.id, { ok: false, reason: "timeout" }), ms);
  }

  function clearAckTimer(request: Pending): void {
    if (request.ackTimer) clearTimeout(request.ackTimer);
    request.ackTimer = null;
  }

  function dispatch(request: Pending): void {
    // Sent now, so it gets a request's worth of time, not a challenge's too. A
    // read that hung inside a ready session used to hold its caller for the
    // challenge budget as well (20s on HDFilm: the whole resolve).
    armTimer(request, options.requestTimeoutMs + 1_000);
    clearAckTimer(request);
    request.ackTimer = setTimeout(() => {
      request.ackTimer = null;
      if (!pending.has(request.id) || phase !== "ready") return;
      if (request.recycled) settle(request.id, { ok: false, reason: "timeout" });
      else recycle("no_ack");
    }, ACK_TIMEOUT_MS);
    host?.evaluate(fetchScript(request.id, request.url, request.headers, options.requestTimeoutMs));
  }

  /**
   * Replace a WebView that stopped answering with a fresh one. Its clearance
   * cookie survives, so the new page is usually ready in about a second, and
   * everything queued is sent again on it. Once per request.
   */
  function recycle(cause: "no_ack" | "process_gone"): void {
    trackEvent(options.eventName, "network", { outcome: "recycled", cause, queued: pending.size, engine }, "warning");
    for (const request of pending.values()) {
      request.recycled = true;
      clearAckTimer(request);
      armTimer(request, queuedTimeoutMs());
    }
    phase = "opening";
    openedAt = Date.now();
    pageLoads = 0;
    lastPage = null;
    generation += 1;
    startChallengeTimer();
    notify();
  }

  function settle(id: number, result: WebSessionFetchResult): void {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    clearAckTimer(request);
    request.resolve(result);
    if (pending.size === 0 && phase !== "closed") scheduleIdleClose();
  }

  function open(): void {
    if (phase !== "closed") return;
    phase = "opening";
    openedAt = Date.now();
    pageLoads = 0;
    lastPage = null;
    startChallengeTimer();
    notify();
  }

  function close(reason: "unavailable" | "timeout" = "timeout"): void {
    phase = "closed";
    clearChallengeTimer();
    clearIdleTimer();
    for (const request of [...pending.values()]) settle(request.id, { ok: false, reason });
    notify();
  }

  function startChallengeTimer(): void {
    clearChallengeTimer();
    challengeTimer = setTimeout(() => {
      challengeTimer = null;
      if (phase === "opening") giveUp("challenge_timeout");
    }, options.challengeTimeoutMs);
  }

  /** The session can't open now: report why, fail the queue, and rest a while. */
  function giveUp(outcome: "challenge_timeout" | "blocked" | "load_error", detail: Record<string, string> = {}): void {
    // What the page looked like when we gave up: no loads at all means the
    // WebView never ran; "hidden" visibility or a challenge frame that never
    // went away say which way the challenge stalled.
    trackEvent(
      options.eventName,
      "network",
      {
        outcome,
        ms: Date.now() - openedAt,
        loads: pageLoads,
        title: lastPage?.title ?? null,
        visibility: lastPage?.visibility ?? null,
        challengeFrame: lastPage?.challengeFrame ?? null,
        ...detail,
      },
      "warning"
    );
    unavailableUntil = Date.now() + options.failureCooldownMs;
    // "unavailable", not "timeout": asking again within the cooldown can't help.
    close("unavailable");
  }

  function clearChallengeTimer(): void {
    if (challengeTimer) clearTimeout(challengeTimer);
    challengeTimer = null;
  }

  function scheduleIdleClose(): void {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pending.size === 0) close();
    }, options.idleCloseMs);
  }

  function clearIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function notify(): void {
    const isOpen = phase !== "closed";
    for (const listener of listeners) listener(isOpen, generation);
  }

  function isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  }

  /** Test seam — back to a cold start. */
  function resetForTests(): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      clearAckTimer(request);
    }
    pending.clear();
    clearChallengeTimer();
    clearIdleTimer();
    phase = "closed";
    host = null;
    unavailableUntil = 0;
    listeners.clear();
    origin = options.initialOrigin;
  }

  return {
    pageProbe,
    sessionUrl,
    setOrigin,
    getOrigin,
    subscribe,
    attachHost,
    warm,
    scheduleWarm,
    liftCooldown,
    isOpening,
    isReady,
    fetchText,
    handleMessage,
    handleLoadError,
    handleProcessGone,
    isNavigationAllowed,
    resetForTests,
  };
}
