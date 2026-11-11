/**
 * kultfilmlerSession
 *
 * Kült Filmler (kultfilmler.net) answers every path, its JSON search included,
 * with a Cloudflare managed challenge, so the site is read through a hidden
 * WebView session (see webSession). The WebView holds the empty search URL,
 * which is a tiny JSON document once the challenge is behind it.
 *
 * The video itself is not behind the challenge: the embeds (FirePlayer on
 * vidpapi.xyz) and the HLS they hand out are fetched natively as usual.
 */

import { createWebSession, type WebSessionFetchResult, type WebSessionHost } from "./webSession";

export type KultfilmlerHost = WebSessionHost;
export type KultfilmlerFetchResult = WebSessionFetchResult;

/**
 * How long a detail page must stay open before it warms the session. The
 * challenge is seconds of script in a second WebView; started the moment a
 * detail page opens, it competed with that page's own entrance and scrolling,
 * and ran for every page skimmed past on the way to another.
 */
export const KULTFILMLER_WARM_DELAY_MS = 1_500;

export const kultfilmlerSession = createWebSession({
  eventName: "kultfilmler_session",
  initialOrigin: "https://kultfilmler.net",
  /** The empty search, `{"success":true,"data":[]}`. */
  sessionUrl: (origin) => `${origin}/wp-admin/admin-ajax.php?action=kf_live_search&q=`,
  readyExpression: "JSON.parse(text).success === true",
  /**
   * A desktop browser clears the challenge in ~5s; a phone's WebView, on mobile
   * data, can take several times that. The session is usually opened from a
   * detail page (`scheduleKultfilmlerWarm`), well before Watch is tapped.
   */
  challengeTimeoutMs: 20_000,
  /** One request inside a cleared session (search JSON, a 50-150 KB page). */
  requestTimeoutMs: 8_000,
  /**
   * Keep the WebView alive between plays. Not much longer: an open WebView costs
   * memory, and a reopened one keeps its clearance cookie, so it is ready again
   * in about a second (`ms` ≈ 600-1500 in telemetry) without a new challenge.
   */
  idleCloseMs: 3 * 60_000,
  /**
   * A device whose WebView cannot pass the challenge (an interactive one, say)
   * must not pay for trying on every play. Short, because a stalled challenge is
   * more often a bad moment on the network than a device that can never pass.
   */
  failureCooldownMs: 3 * 60_000,
});

export const KULTFILMLER_PAGE_PROBE = kultfilmlerSession.pageProbe;
export const kultfilmlerSessionUrl = kultfilmlerSession.sessionUrl;
export const setKultfilmlerOrigin = kultfilmlerSession.setOrigin;
export const getKultfilmlerOrigin = kultfilmlerSession.getOrigin;
export const subscribeKultfilmlerSession = kultfilmlerSession.subscribe;
export const attachKultfilmlerHost = kultfilmlerSession.attachHost;
export const liftKultfilmlerCooldown = kultfilmlerSession.liftCooldown;
export const isKultfilmlerSessionOpening = kultfilmlerSession.isOpening;
export const fetchKultfilmlerText = kultfilmlerSession.fetchText;
export const handleKultfilmlerMessage = kultfilmlerSession.handleMessage;
export const handleKultfilmlerLoadError = kultfilmlerSession.handleLoadError;
export const isKultfilmlerNavigationAllowed = kultfilmlerSession.isNavigationAllowed;
export const __resetKultfilmlerSessionForTests = kultfilmlerSession.resetForTests;

/**
 * Start passing the challenge ahead of need — from a detail page, where the
 * viewer usually spends longer than the challenge takes before tapping Watch.
 */
export const warmKultfilmlerSession = kultfilmlerSession.warm;

/** Warm once the page has been open `KULTFILMLER_WARM_DELAY_MS`. Returns the cancel. */
export function scheduleKultfilmlerWarm(): () => void {
  return kultfilmlerSession.scheduleWarm(KULTFILMLER_WARM_DELAY_MS);
}
