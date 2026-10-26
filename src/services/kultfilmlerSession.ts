/**
 * kultfilmlerSession
 *
 * Kült Filmler (kultfilmler.net) answers every path, its JSON search included,
 * with a Cloudflare managed challenge: `403 cf-mitigated: challenge` and a
 * "Just a moment…" page that only a real browser engine can pass. A browser
 * passes it on its own in a few seconds, with no click, and from then on the
 * site answers normally.
 *
 * So the site is read through a hidden WebView (`KultfilmlerBridge`). It loads
 * the empty search URL, which is a tiny JSON document once the challenge is
 * behind it, and every request then runs as a same-origin `fetch()` inside that
 * page. The bodies come back over `postMessage`. Nothing the site serves is
 * ever rendered or executed: the WebView only ever displays that JSON.
 *
 * The clearance cookie is NOT lifted out into native requests. It is bound to
 * the WebView's exact user agent, and native networking does not share the
 * WebView's cookie store on iOS. Fetching from inside the page needs neither.
 *
 * The video itself is not behind the challenge: the embeds (FirePlayer on
 * vidpapi.xyz) and the HLS they hand out are fetched natively as usual.
 */

import { trackEvent } from "./telemetryService";

/** What the bridge component exposes to drive its WebView. */
export type KultfilmlerHost = {
  /** Run a script in the page. */
  evaluate(script: string): void;
  /** Reload the page, which re-runs the challenge when the clearance lapsed. */
  reload(): void;
};

export type KultfilmlerFetchResult =
  | { ok: true; body: string }
  /**
   * `unavailable`: the session could not be opened recently, so nothing was
   * asked (not a failure of this request). `timeout`: no answer in time, which
   * is worth asking again. `http`: the site answered with an error status.
   */
  | { ok: false; reason: "unavailable" | "timeout" | "http"; status?: number };

/**
 * A desktop browser clears the challenge in ~5s; a phone's WebView, on mobile
 * data, can take several times that. The session is usually opened from a
 * detail page (`scheduleKultfilmlerWarm`), well before Watch is tapped.
 */
const CHALLENGE_TIMEOUT_MS = 20_000;
/** One request inside a cleared session (search JSON, a 50-150 KB page). */
const REQUEST_TIMEOUT_MS = 8_000;
/**
 * Keep the WebView alive between plays. Not much longer: an open WebView costs
 * memory, and a reopened one keeps its clearance cookie, so it is ready again
 * in about a second (`ms` ≈ 600-1500 in telemetry) without a new challenge.
 */
const IDLE_CLOSE_MS = 3 * 60_000;
/**
 * A device whose WebView cannot pass the challenge (an interactive one, say)
 * must not pay for trying on every play. Short, because a stalled challenge is
 * more often a bad moment on the network than a device that can never pass.
 */
const FAILURE_COOLDOWN_MS = 3 * 60_000;
/**
 * How long a detail page must stay open before it warms the session. The
 * challenge is seconds of script in a second WebView; started the moment a
 * detail page opens, it competed with that page's own entrance and scrolling,
 * and ran for every page skimmed past on the way to another.
 */
export const KULTFILMLER_WARM_DELAY_MS = 1_500;

type Pending = {
  id: number;
  url: string;
  retried: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: KultfilmlerFetchResult) => void;
};

type Phase = "closed" | "opening" | "ready";

let phase: Phase = "closed";
let host: KultfilmlerHost | null = null;
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

let origin = "https://kultfilmler.net";

/** The page the WebView holds: the empty search, `{"success":true,"data":[]}`. */
export function kultfilmlerSessionUrl(): string {
  return `${origin}/wp-admin/admin-ajax.php?action=kf_live_search&q=`;
}

/** The origin the session runs on; follows the provider config. */
export function setKultfilmlerOrigin(baseUrl: string): void {
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

export function getKultfilmlerOrigin(): string {
  return origin;
}

/**
 * Runs after every page load. The session is ready once the page is the JSON
 * search answer rather than the challenge.
 */
export const KULTFILMLER_PAGE_PROBE = `(function () {
  var text = document.body ? document.body.innerText : "";
  var ready = false;
  try { ready = JSON.parse(text).success === true; } catch (e) {}
  window.ReactNativeWebView.postMessage(JSON.stringify({
    kf: "page",
    ready: ready,
    title: String(document.title || "").slice(0, 60),
    visibility: String(document.visibilityState || ""),
    challengeFrame: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')
  }));
})();
true;`;

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

/** The bridge mounts its WebView while this reports open. */
export function subscribeKultfilmlerSession(listener: (open: boolean) => void): () => void {
  listeners.add(listener);
  listener(phase !== "closed");
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the bridge when its WebView mounts (with a host) and unmounts (null). */
export function attachKultfilmlerHost(next: KultfilmlerHost | null): void {
  host = next;
  // The WebView went away under an open session (the app shell remounted):
  // nothing queued can be answered any more.
  if (!next && phase !== "closed") close();
}

/**
 * Start passing the challenge ahead of need — from a detail page, where the
 * viewer usually spends longer than the challenge takes before tapping Watch.
 */
export function warmKultfilmlerSession(): void {
  if (listeners.size === 0 || Date.now() < unavailableUntil) return;
  if (phase === "closed") open();
}

/** Warm once the page has been open `KULTFILMLER_WARM_DELAY_MS`. Returns the cancel. */
export function scheduleKultfilmlerWarm(): () => void {
  const timer = setTimeout(warmKultfilmlerSession, KULTFILMLER_WARM_DELAY_MS);
  return () => clearTimeout(timer);
}

/**
 * The viewer asked again (Retry on "Not available"): a challenge that stalled a
 * minute ago gets another go now instead of when the cooldown ends.
 */
export function liftKultfilmlerCooldown(): void {
  unavailableUntil = 0;
}

/** Still passing the challenge: a request now would wait on it. */
export function isKultfilmlerSessionOpening(): boolean {
  return phase === "opening";
}

/** GET a same-origin URL on the site. Never rejects. */
export function fetchKultfilmlerText(url: string): Promise<KultfilmlerFetchResult> {
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
      timer: setTimeout(() => settle(id, { ok: false, reason: "timeout" }), CHALLENGE_TIMEOUT_MS + REQUEST_TIMEOUT_MS),
      resolve,
    };
    pending.set(id, request);
    clearIdleTimer();
    if (phase === "ready" && host) dispatch(request);
    else open();
  });
}

/** Messages from the WebView. Anything not shaped like ours is ignored. */
export function handleKultfilmlerMessage(raw: string): void {
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
    if (message.ready !== true) return;
    if (phase === "opening") {
      trackEvent("kultfilmler_session", "network", { outcome: "ready", ms: Date.now() - openedAt, loads: pageLoads });
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

function dispatch(request: Pending): void {
  host?.evaluate(fetchScript(request.id, request.url));
}

function settle(id: number, result: KultfilmlerFetchResult): void {
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
    if (phase !== "opening") return;
    // What the page looked like when we gave up: no loads at all means the
    // WebView never ran; "hidden" visibility or a challenge frame that never
    // went away say which way the challenge stalled.
    trackEvent(
      "kultfilmler_session",
      "network",
      {
        outcome: "challenge_timeout",
        ms: Date.now() - openedAt,
        loads: pageLoads,
        title: lastPage?.title ?? null,
        visibility: lastPage?.visibility ?? null,
        challengeFrame: lastPage?.challengeFrame ?? null,
      },
      "warning"
    );
    unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
    // "unavailable", not "timeout": asking again within the cooldown can't help.
    close("unavailable");
  }, CHALLENGE_TIMEOUT_MS);
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
  }, IDLE_CLOSE_MS);
}

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function notify(): void {
  const isOpen = phase !== "closed";
  for (const listener of listeners) listener(isOpen);
}

/**
 * What the session WebView may load: the site itself, and Cloudflare's
 * challenge frame (iOS asks about frames too). Anything else, an ad redirect
 * say, is refused.
 */
export function isKultfilmlerNavigationAllowed(url: string): boolean {
  if (url === "about:blank" || url.startsWith("about:srcdoc")) return true;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin || parsed.origin === "https://challenges.cloudflare.com";
  } catch {
    return false;
  }
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Test seam — back to a cold start. */
export function __resetKultfilmlerSessionForTests(): void {
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  clearChallengeTimer();
  clearIdleTimer();
  phase = "closed";
  host = null;
  unavailableUntil = 0;
  listeners.clear();
  origin = "https://kultfilmler.net";
}
