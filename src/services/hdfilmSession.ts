/**
 * hdfilmSession
 *
 * HDFilm gates non-browser clients on its main domain two ways:
 *   - its series pages (`/dizi/…`, the show and every episode) answer with a
 *     Cloudflare managed challenge (2026-11-11), and
 *   - its own `/rplayer/{id}/` embed answers with an "Uygulama desteklenmiyor"
 *     app-block page (403, "open it in Chrome") (2026-11-15), while the `.mobi`
 *     embed host 404s. That killed HDFilm playback: films and episodes both
 *     fell to Dizipal/Dizibal.
 *
 * Both are lifted by a real browser engine: it clears the challenge on its own
 * in a few seconds, and a same-origin `fetch()` from a cleared page returns the
 * real `/rplayer/` player. So those pages are read through a hidden WebView
 * session (see webSession). The WebView holds HDFilm's 8 KB 404 page (no ads, no
 * player) at `/dizi/streambox/`, and every `/dizi/` or `/rplayer/` request then
 * runs same-origin inside it. Films, search, and the `.mobi` host stay native.
 */

import { createWebSession } from "./webSession";

export const hdfilmSession = createWebSession({
  eventName: "hdfilm_session",
  initialOrigin: "https://www.hdfilmcehennemi.nl",
  sessionUrl: (origin) => `${origin}/dizi/streambox/`,
  // Anything but the challenge (or block) page means the clearance is in.
  readyExpression: '!!document.body && !/just a moment|attention required/i.test(document.title)',
  // Shorter than Kült Filmler's 20s: Dizipal and Dizibal usually have the same
  // title, and the HDFilm tier holds the result back while it waits.
  challengeTimeoutMs: 12_000,
  requestTimeoutMs: 8_000,
  idleCloseMs: 3 * 60_000,
  failureCooldownMs: 3 * 60_000,
});

/**
 * A page on HDFilm's main origin that the site gates behind browser clearance:
 * a series page (`/dizi/…`) or its `/rplayer/` embed. These are the requests
 * routed through the session when a native try is challenged or app-blocked.
 */
export function isHdfilmSessionPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === hdfilmSession.getOrigin() &&
      (parsed.pathname.startsWith("/dizi/") || parsed.pathname.startsWith("/rplayer/"))
    );
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
  if (status !== 403) return false;
  const text = typeof body === "string" ? body : "";
  return /desteklenmiyor|package=com\.android\.chrome|app is not supported/i.test(text);
}

/**
 * Gated pages are only sometimes blocked, so the session is not opened for
 * every series page browsed: only once a block has been seen recently.
 */
const WARM_AFTER_CHALLENGE_MS = 30 * 60_000;
const WARM_DELAY_MS = 1_500;
let lastChallengedAt = 0;

/** A native request to a gated page came back challenged or app-blocked. */
export function noteHdfilmChallenge(): void {
  lastChallengedAt = Date.now();
}

/**
 * From a series detail page: when HDFilm challenged recently, start the session
 * now, so the episode the viewer picks does not wait on the challenge. Returns
 * the cancel.
 */
export function scheduleHdfilmWarm(): () => void {
  const timer = setTimeout(() => {
    if (lastChallengedAt && Date.now() - lastChallengedAt < WARM_AFTER_CHALLENGE_MS) hdfilmSession.warm();
  }, WARM_DELAY_MS);
  return () => clearTimeout(timer);
}

/** Test seam — forget any challenge seen. */
export function __resetHdfilmChallengeForTests(): void {
  lastChallengedAt = 0;
}
