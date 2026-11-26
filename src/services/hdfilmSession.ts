/**
 * hdfilmSession
 *
 * HDFilm gates non-browser clients across its main domain:
 *   - its series pages (`/dizi/…`) answer with a Cloudflare managed challenge
 *     since 2026-11-11, and its film pages too since 2026-11-19 — every native
 *     try is a 403, so titles only HDFilm carries read "Not available";
 *   - its own `/rplayer/{id}/` embed answers with an "Uygulama desteklenmiyor"
 *     app-block page (403, "open it in Chrome") since 2026-11-15, while the
 *     `.mobi` embed host 404s.
 *
 * Both are lifted by a real browser engine: it clears the challenge on its own
 * in a few seconds, and a same-origin `fetch()` from a cleared page returns the
 * real page or player. So HDFilm's pages are read through a hidden WebView
 * session (see webSession). The WebView holds HDFilm's 8 KB 404 page (no ads, no
 * player) at `/dizi/streambox/`, and every page request then runs same-origin
 * inside it. Search (a JSON endpoint that wants its own request header and is
 * not gated) and the `.mobi` host stay native.
 */

import { createWebSession } from "./webSession";

export const hdfilmSession = createWebSession({
  eventName: "hdfilm_session",
  initialOrigin: "https://www.hdfilmcehennemi.nl",
  sessionUrl: (origin) => `${origin}/dizi/streambox/`,
  // HDFilm's own page (its 404 names the site in the title), or failing that
  // anything but the challenge or block page. The challenge is told by
  // `challenge`, not only by its English title: Cloudflare translates the title
  // to the phone's language, and "Один момент…" passed for a cleared page.
  readyExpression:
    '!!document.body && (/hdfilm/i.test(document.title) || (!challenge && !/just a moment|attention required/i.test(document.title)))',
  // Shorter than Kült Filmler's 20s: Dizipal and Dizibal usually have the same
  // title, and the HDFilm tier holds the result back while it waits.
  // HDFilm's own "451 - Yasal Nedenlerle Erisime Kapali" page (see
  // isHdfilmLegallyBlocked). It has a body and no challenge, so it passed for
  // ready on every phone that got it.
  blockedExpression: 'String(document.title).indexOf("451") === 0 || /yasal nedenlerle/i.test(document.title)',
  onBlocked: (title) => {
    if (/451|yasal nedenlerle/i.test(title)) noteHdfilmLegalBlock();
  },
  challengeTimeoutMs: 12_000,
  requestTimeoutMs: 8_000,
  idleCloseMs: 3 * 60_000,
  failureCooldownMs: 3 * 60_000,
});

/**
 * A page on HDFilm's main origin that the site may gate behind browser
 * clearance: a film page, a series or episode page, or the `/rplayer/` embed.
 * These are the requests routed through the session when a native try is
 * challenged or app-blocked. The search endpoint is not one of them.
 */
export function isHdfilmSessionPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === hdfilmSession.getOrigin() && !parsed.pathname.startsWith("/search/");
  } catch {
    return false;
  }
}

/**
 * HDFilm's app-block page: a 403 whose body says the app is not supported
 * ("Uygulama desteklenmiyor" / an `intent://…package=com.android.chrome`),
 * served to non-browser clients in place of the `/rplayer/` player. Unlike the
 * Cloudflare challenge it carries no `cf-mitigated` header, so it is matched by
 * its body.
 */
export function isHdfilmAppBlockResponse(status: number | undefined, body: unknown): boolean {
  return status === 403 && isHdfilmAppBlockBody(body);
}

/** The app-block page by its text alone, whatever status carried it. */
export function isHdfilmAppBlockBody(body: unknown): boolean {
  const text = typeof body === "string" ? body : "";
  return /uygulama desteklenmiyor|package=com\.android\.chrome/i.test(text);
}

/**
 * Every HDFilm page is gated now, so a detail page starts the session ahead of
 * Watch — unless a native request got through lately, which says the gate is
 * down and there is nothing to clear.
 */
const NATIVE_PASS_TRUST_MS = 30 * 60_000;
const WARM_DELAY_MS = 1_500;
let lastNativePassAt = 0;
let lastChallengedAt = 0;

/** A native request to a gated page came back challenged or app-blocked. */
export function noteHdfilmChallenge(): void {
  lastNativePassAt = 0;
  lastChallengedAt = Date.now();
}

/** A native request to a gated page was answered with the page itself. */
export function noteHdfilmNativePass(): void {
  lastNativePassAt = Date.now();
  lastChallengedAt = 0;
}

/**
 * The gate was met lately, so the next gated page goes straight to the session
 * instead of collecting another 403 first. It is asked natively again after
 * half an hour, in case the site has taken the gate down.
 */
export function isHdfilmGateUp(): boolean {
  return lastChallengedAt > 0 && Date.now() - lastChallengedAt < NATIVE_PASS_TRUST_MS;
}

/**
 * HDFilm closes itself to some networks: every request, the search included,
 * answers **451** with a page titled "451 - Yasal Nedenlerle Erisime Kapali"
 * ("closed to access for legal reasons"), natively and inside the WebView
 * alike. The diagnostics shipped on 2026-11-23 showed this on 17 of 23 viewers:
 * it is why HDFilm played for two or three people a day from the week it gated
 * its pages. Nothing on such a network gets through, so for half an hour
 * HDFilm is not asked at all: each resolve was spending eight requests, and on
 * an old WebView the whole 20s, finding out again.
 */
const LEGAL_BLOCK_TRUST_MS = 30 * 60_000;
let legalBlockUntil = 0;

/** A request to HDFilm was answered 451. */
export function noteHdfilmLegalBlock(): void {
  legalBlockUntil = Date.now() + LEGAL_BLOCK_TRUST_MS;
}

export function isHdfilmLegallyBlocked(): boolean {
  return Date.now() < legalBlockUntil;
}

/** The viewer pressed Retry (they may have changed network): ask HDFilm again. */
export function liftHdfilmLegalBlock(): void {
  legalBlockUntil = 0;
}

/**
 * From a film or series detail page: start the session now, so the title the
 * viewer plays does not wait on the challenge. Returns the cancel.
 */
export function scheduleHdfilmWarm(): () => void {
  const timer = setTimeout(() => {
    const gateIsDown = lastNativePassAt > 0 && Date.now() - lastNativePassAt < NATIVE_PASS_TRUST_MS;
    if (!gateIsDown && !isHdfilmLegallyBlocked()) hdfilmSession.warm();
  }, WARM_DELAY_MS);
  return () => clearTimeout(timer);
}

/** Test seam — forget what the native requests last said. */
export function __resetHdfilmChallengeForTests(): void {
  lastNativePassAt = 0;
  lastChallengedAt = 0;
  legalBlockUntil = 0;
}
