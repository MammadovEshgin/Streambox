/**
 * Player WebView navigation/discovery policy.
 *
 * Pure module — no React or RN deps — that decides:
 *  - which URLs the WebView is allowed to navigate to (`shouldAllowPlayerWebViewRequest`)
 *  - which discovered stream URLs the native player is allowed to take over (`shouldAcceptDiscoveredHdFilmStream`)
 *
 * Both lists of patterns are also serialised (via `JSON.stringify`) into the
 * injected WebView scripts, so the runtime DOM filter and the React-side filter
 * stay in lockstep. Keeping this file pure makes the rules unit-testable.
 */

export const BLOCKED_PLAYER_NAVIGATION_PATTERNS = [
  "://ad.",
  ".ad.",
  "/ad/",
  "/ads/",
  "/advert",
  "/banner",
  "/popunder",
  "/popup",
  "/preroll",
  "/vast",
  "/vpaid",
  "/ima3",
  "doubleclick",
  "googlesyndication",
  "googletagservices",
  "googletagmanager",
  "googleadservices",
  "googleads",
  "google-analytics",
  "adservice",
  "adserver",
  "adsystem",
  "adnxs",
  "adsterra",
  "ad-maven",
  "adcash",
  "clickadu",
  "hilltopads",
  "onclickads",
  "yllix",
  "adform",
  "aniview",
  "popads",
  "popcash",
  "propellerads",
  "exoclick",
  "trafficjunky",
  "juicyads",
  "onclick",
  "revcontent",
  "taboola",
  "outbrain",
  "mgid",
  "aj2204",
  "market://",
  "intent://",
  "play.google.com",
];

export const TRUSTED_PLAYER_FRAME_PATTERNS = [
  "hdfilmcehennemi",
  "dizipal",
  "rplayer",
  "rapidrame",
  "vidmoly",
  "closeload",
  "fastplayer",
  "filemoon",
  "voe.",
  "voe.sx",
  "streamwish",
  "dood",
  "doodstream",
  "d000d",
  "mixdrop",
  "streamtape",
  "ok.ru",
  "uqload",
  "vidoza",
  "streamsb",
  "sbembed",
  "filelions",
  "luluvdo",
  "sendvid",
  "streamruby",
  "upstream",
  "mcloud",
  "vidcloud",
  "govid",
  "hls",
  "m3u8",
];

export const PLAYER_PASSIVE_ASSET_PATTERN =
  /\.(m3u8|mp4|m4v|webm|mov|ts|m4s|vtt|srt|png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|otf)(?:[?#].*)?$/i;

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isBlockedPlayerNavigation(url: string): boolean {
  const normalized = url.toLowerCase();
  return BLOCKED_PLAYER_NAVIGATION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isTrustedPlayerFrameUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return TRUSTED_PLAYER_FRAME_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isTrustedHdFilmRuntimeContext(url: string): boolean {
  return /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape/i.test(url);
}

export function isLikelyHdFilmRuntimeStreamUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape/i.test(normalized) ||
    /\/hls2?\//i.test(normalized) ||
    /\.urlset\//i.test(normalized) ||
    /\/(?:master|index|playlist|manifest)\.m3u8(?:[?#]|$)/i.test(normalized)
  );
}

/**
 * Gate for accepting a stream URL discovered at runtime from the WebView and
 * handing it off to native expo-video. Rejects anything that looks like an ad
 * surface, and requires the URL itself or its referer/embed to look like a
 * trusted HDFilm/Rapidrame-family endpoint.
 */
export function shouldAcceptDiscoveredHdFilmStream(streamUrl: string, referer = "", embedUrl = ""): boolean {
  if (!streamUrl || isBlockedPlayerNavigation(streamUrl)) return false;
  if (referer && isBlockedPlayerNavigation(referer)) return false;
  if (embedUrl && isBlockedPlayerNavigation(embedUrl)) return false;
  if (!/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(streamUrl) && !streamUrl.toLowerCase().includes(".m3u8")) {
    return false;
  }

  return (
    isTrustedHdFilmRuntimeContext(referer) ||
    isTrustedHdFilmRuntimeContext(embedUrl) ||
    isLikelyHdFilmRuntimeStreamUrl(streamUrl)
  );
}

export function isLikelyPassivePlayerAsset(url: string): boolean {
  return PLAYER_PASSIVE_ASSET_PATTERN.test(url);
}

export function isLikelyUnknownDocumentNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (isLikelyPassivePlayerAsset(url)) return false;
    if (/\.(html?|php|aspx?)(?:$|[?#])/i.test(path)) return true;
    if (!/\.[a-z0-9]{2,5}$/i.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Decide whether the player WebView should let a request through. Top-frame
 * navigations are limited to the initial host or trusted frame providers;
 * subframes get more leeway for passive assets and same-host requests.
 */
export function shouldAllowPlayerWebViewRequest(
  req: { url: string; isTopFrame?: boolean },
  initialUrl: string
): boolean {
  const url = req.url;

  if (!url || url.includes("about:blank") || url.startsWith("blob:")) {
    return true;
  }

  if (!isHttpUrl(url)) {
    return false;
  }

  if (isBlockedPlayerNavigation(url)) {
    return false;
  }

  const initialHost = getUrlHost(initialUrl);
  const nextHost = getUrlHost(url);

  if (!req.isTopFrame) {
    if (initialHost && nextHost === initialHost) return true;
    if (isTrustedPlayerFrameUrl(url)) return true;
    if (isLikelyPassivePlayerAsset(url)) return true;
    return !isLikelyUnknownDocumentNavigation(url);
  }

  return Boolean(
    initialHost &&
      nextHost &&
      (nextHost === initialHost || isTrustedPlayerFrameUrl(url))
  );
}
