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
   * is worth asking again. `http`: the site answered with an error status.
   */
  | { ok: false; reason: "unavailable" | "timeout" | "http"; status?: number };

export type WebSessionOptions = {
  /** Telemetry event for the session's outcomes (`ready`, `challenge_timeout`, …). */
  eventName: string;
  initialOrigin: string;
  /** The page the WebView holds, on `origin`. */
  sessionUrl(origin: string): string;
  /** JS expression, run in the loaded page: true once the page is past the challenge. */
  readyExpression: string;
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
  retried: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: WebSessionFetchResult) => void;
};

type Phase = "closed" | "opening" | "ready";

/**
 * Runs after every page load. The session is ready once `readyExpression`
 * holds. `blocked` is Cloudflare's block page ("Attention Required!", "Sorry,
 * you have been blocked"): the site turns this network away outright, so there
 * is no challenge to wait out.
 */
export function webSessionPageProbe(readyExpression: string): string {
  return `(function () {
  var text = document.body ? document.body.innerText : "";
  var ready = false;
  try { ready = ${readyExpression}; } catch (e) {}
  window.ReactNativeWebView.postMessage(JSON.stringify({
    kf: "page",
    ready: ready,
    blocked: !!document.getElementById("cf-error-details") || /you have been blocked/i.test(text),
    title: String(document.title || "").slice(0, 60),
    visibility: String(document.visibilityState || ""),
    challengeFrame: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')
  }));
})();
true;`;
}

function fetchScript(id: number, url: string): string {
  return `(function () {
  var post = function (message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); };
  fetch(${JSON.stringify(url)}, { credentials: "same-origin" })
    .then(function (response) {
      return response.text().then(function (body) {
        post({ kf: "fetch", id: ${id}, status: response.status,
          challenged: response.headers.get("cf-mitigated") === "challenge", body: body });
      });
    })
    .catch(function () { post({ kf: "fetch", id: ${id}, status: 0, challenged: false, body: "" }); });
})();
true;`;
}

export function createWebSession(options: WebSessionOptions) {
  const pageProbe = webSessionPageProbe(options.readyExpression);

  let phase: Phase = "closed";
  let host: WebSessionHost | null = null;
  let openedAt = 0;
  let unavailableUntil = 0;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let challengeTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(open: boolean) => void>();
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
  function subscribe(listener: (open: boolean) => void): () => void {
    listeners.add(listener);
    listener(phase !== "closed");
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
  function fetchText(url: string): Promise<WebSessionFetchResult> {
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
        retried: false,
        // Covers the challenge too: a request queued while the session opens
        // waits for it, and the challenge timer fails it sooner if it can't.
        timer: setTimeout(
          () => settle(id, { ok: false, reason: "timeout" }),
          options.challengeTimeoutMs + options.requestTimeoutMs
        ),
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
      if (message.blocked === true && phase === "opening") {
        giveUp("blocked");
        return;
      }
      if (message.ready !== true) return;
      if (phase === "opening") {
        trackEvent(options.eventName, "network", { outcome: "ready", ms: Date.now() - openedAt, loads: pageLoads });
      }
      phase = "ready";
      clearChallengeTimer();
      for (const request of pending.values()) dispatch(request);
      // Warmed ahead of need: nothing to send yet, so start the idle clock.
      if (pending.size === 0) scheduleIdleClose();
      return;
    }

    if (message?.kf !== "fetch" || typeof message.id !== "number") return;
    const request = pending.get(message.id);
    if (!request) return;
    const status = typeof message.status === "number" ? message.status : 0;

    // The clearance lapsed mid-session: pass the challenge again, then retry once.
    if (status === 403 && message.challenged === true && !request.retried) {
      request.retried = true;
      phase = "opening";
      openedAt = Date.now();
      startChallengeTimer();
      host?.reload();
      return;
    }

    if (status >= 200 && status < 300 && typeof message.body === "string") {
      settle(request.id, { ok: true, body: message.body });
    } else {
      settle(request.id, status === 0 ? { ok: false, reason: "timeout" } : { ok: false, reason: "http", status });
    }
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

  function dispatch(request: Pending): void {
    host?.evaluate(fetchScript(request.id, request.url));
  }

  function settle(id: number, result: WebSessionFetchResult): void {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
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
    for (const listener of listeners) listener(isOpen);
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
    for (const request of pending.values()) clearTimeout(request.timer);
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
    isNavigationAllowed,
    resetForTests,
  };
}
