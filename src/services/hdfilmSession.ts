/**
 * hdfilmSession
 *
 * Since 2026-11-11 HDFilm puts its series pages (`/dizi/…`, the show and every
 * episode) behind a Cloudflare managed challenge for non-browser clients. Its
 * films, search and players are not challenged. Native requests to `/dizi/`
 * still pass now and then, but phones went whole evenings without one: every
 * episode fell to Dizipal or "Not available" while the films played.
 *
 * So when a series page keeps answering with the challenge, it is read through
 * a hidden WebView session (see webSession). The WebView holds a page that does
 * not exist (HDFilm's 8 KB 404 page, no ads, no player) under `/dizi/`, which is
 * what earns the clearance for the rest of `/dizi/`.
 */

import { createWebSession } from "./webSession";

export const hdfilmSession = createWebSession({
  eventName: "hdfilm_session",
  initialOrigin: "https://www.hdfilmcehennemi.nl",
  sessionUrl: (origin) => `${origin}/dizi/streambox/`,
  // Anything but the challenge (or block) page means the clearance is in.
  readyExpression: '!!document.body && !/just a moment|attention required/i.test(document.title)',
  // Shorter than Kült Filmler's 20s: Dizipal and Dizibal usually have the same
  // episode, and the HDFilm tier holds the result back while it waits.
  challengeTimeoutMs: 12_000,
  requestTimeoutMs: 8_000,
  idleCloseMs: 3 * 60_000,
  failureCooldownMs: 3 * 60_000,
});

/** A series page (the show or an episode) on HDFilm's current origin. */
export function isHdfilmSeriesPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === hdfilmSession.getOrigin() && parsed.pathname.startsWith("/dizi/");
  } catch {
    return false;
  }
}

/**
 * Series pages are only sometimes challenged, so the session is not opened for
 * every series page browsed: only once a challenge has been seen recently.
 */
const WARM_AFTER_CHALLENGE_MS = 30 * 60_000;
const WARM_DELAY_MS = 1_500;
let lastChallengedAt = 0;

/** A native request to a series page came back as the challenge. */
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
