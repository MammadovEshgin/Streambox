/**
 * streambox-dizipal-resolver
 *
 * WHY THIS WORKER EXISTS
 * ----------------------
 * Dizipal rebuilt its site in Sept 2026 and moved playback to its own player
 * host (`*.dplayer*.site`). That host runs a Cloudflare firewall rule which
 * answers **403 "Attention Required"** to our users' networks for every
 * dynamic path — `iframe.php`, `source2.php` and the variant playlist `l.php`
 * — while happily serving the static ones: `master.m3u8`, and the `.jpg`
 * disguised MPEG-TS segments on the `*.cfd` CDN (with a Referer).
 *
 * So the device can stream Dizipal perfectly; it just cannot ASK for the
 * stream. This Worker makes that one call from Cloudflare's network, which the
 * rule lets through, and hands the device a playlist it can play directly.
 * Video bytes never touch the Worker: only the ~40 KB playlist and, if the
 * viewer turns subtitles on, a WebVTT file.
 *
 * THE CHAIN
 *   1. The app posts the watch page's URL. The page is fetched HERE, because the
 *      player host binds the token inside it to whoever asked for the page.
 *   2. `{ciphertext,iv,salt}` → PBKDF2-SHA512(passphrase, salt, 999) → AES-256-CBC
 *      → the player iframe URL. The passphrase is a literal in the site's own
 *      `pageload.js`; it is re-read hourly rather than pinned, because it
 *      rotates.
 *   3. `iframe.php` → `openPlayer('<token>', …, [subtitles])`.
 *   4. `source2.php?v=<token>` → JSON whose `playlist[0].sources[0].file` is an
 *      `m.php` URL; swapping in `master.m3u8` is what the site's own player does.
 *   5. The master lists `l.php` variants — walled — so the highest-bandwidth one
 *      is fetched here and served back through `/playlist`. Its segments are
 *      absolute `.cfd` URLs the device fetches itself.
 *
 * NOT AN OPEN PROXY: `/playlist` and `/subtitle` only fetch hosts and paths
 * that this chain produces (see `isProxyableUrl`), and they never stream media.
 */

const PASSPHRASE_TTL_MS = 60 * 60 * 1000;
/**
 * How long a resolved stream is reused for the same watch page.
 *
 * The player host rate-limits `iframe.php` per client IP in bursts, and every
 * one of our users arrives from the same handful of Cloudflare addresses: three
 * resolves back to back are enough to start getting 403s, while the same calls
 * spaced 20s apart all pass (measured 2026-09-24). Serving repeat views of a
 * title from cache keeps us far below that, and makes the second viewer's
 * resolve instant.
 *
 * Kept well inside the stream token's own life: a freshly minted playlist was
 * still served six minutes later, while one handed out from a ten-minute-old
 * cache entry answered 403 (measured 2026-09-24). A stale stream is worse than
 * resolving again — the viewer sees it as a dead player.
 */
const RESOLVE_CACHE_SECONDS = 240;
/**
 * The page → player-token step is the expensive half (two upstream calls, and
 * the one the limiter refuses first) and the token is stable per title, so it
 * is kept much longer than the stream itself. If it does go stale, `source2`
 * says `expired` and the entry is dropped and re-read.
 */
const PLAYER_TOKEN_CACHE_SECONDS = 6 * 60 * 60;
/**
 * One retry when the burst limiter does trip, rather than failing the play.
 * Measured 2026-09-24: eight distinct resolves two seconds apart all pass, so
 * only a true back-to-back burst trips it and a pause of this length clears.
 */
const RATE_LIMIT_RETRY_MS = 2_500;
const UPSTREAM_TIMEOUT_MS = 12_000;
const PLAYLIST_CACHE_SECONDS = 300;

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** Dizipal's own numbered domains — the only origin a caller may name. */
const DIZIPAL_HOST = /^(?:[a-z0-9-]+\.)?dizipal\d+\.[a-z.]+$/i;
/** The player host family, and the segment/subtitle CDN it points at. */
const PLAYER_HOST = /^(?:[a-z0-9-]+\.)?dplayer\d*\.site$/i;
const CDN_HOST = /^[a-z0-9-]+\.[a-z0-9-]+\.cfd$/i;

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({ service: "streambox-dizipal-resolver", event, ...fields }));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

async function fetchWithTimeout(url, init = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // Every token in this chain is minted per page view, so a cached answer
      // is always the wrong one — and a cached 403 from a single blocked
      // attempt would pin every later resolve to that failure.
      cf: { cacheTtlByStatus: { "200-299": -1, "300-399": -1, "400-499": -1, "500-599": -1 }, ...(init.cf ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

function normaliseBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !DIZIPAL_HOST.test(url.hostname)) return null;
  return url.origin;
}

function absolutise(value) {
  if (!value) return null;
  const withScheme = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// ─── The passphrase ────────────────────────────────────────────────────────
// A literal in the site's pageload.js. Cached per isolate; a rotation costs at
// most one failed resolve before the next fetch picks the new one up.
const passphraseCache = new Map();

async function readPassphrase(base) {
  const cached = passphraseCache.get(base);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetchWithTimeout(`${base}/assets/js-dizipal/pageload.js`, {
    headers: { "user-agent": UA, referer: `${base}/` },
  });
  if (!response.ok) throw new Error(`pageload.js HTTP ${response.status}`);
  const body = await response.text();
  const passphrase = body.match(/oyunculistdc\('([^']+)'/)?.[1];
  if (!passphrase) throw new Error("pageload.js no longer carries the player passphrase");

  passphraseCache.set(base, { value: passphrase, expiresAt: Date.now() + PASSPHRASE_TTL_MS });
  return passphrase;
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("malformed hex in player config");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The site's own `oyunculistdc()`, in WebCrypto. */
async function decryptPlayerUrl(passphrase, config) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(config.salt), iterations: 999, hash: "SHA-512" },
    material,
    256
  );
  const key = await crypto.subtle.importKey("raw", bits, "AES-CBC", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: hexToBytes(config.iv) },
    key,
    base64ToBytes(config.ciphertext)
  );
  return new TextDecoder().decode(plain);
}

/** Only a page on the caller's own dizipal origin may be fetched. */
function normalisePageUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  if (!/^\/(?:film|dizi)\//i.test(url.pathname)) return null;
  return url.toString();
}

/** The encrypted player config the watch page carries. */
function extractPlayerBlob(html) {
  return html.match(/data-rm-k=["']true["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]?.trim() ?? null;
}

function parsePlayerConfig(raw) {
  if (typeof raw !== "string" || raw.length > 20_000) return null;
  const decoded = raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  const { ciphertext, iv, salt } = parsed ?? {};
  if (typeof ciphertext !== "string" || typeof iv !== "string" || typeof salt !== "string") return null;
  return { ciphertext, iv, salt };
}

/** The first argument of `openPlayer(...)`, which `source2.php` takes as `v`. */
function extractPlayerToken(html) {
  return html.match(/openPlayer\(\s*'([^']+)'/)?.[1] ?? null;
}

/** The last argument of `openPlayer(...)`: the subtitle list, as a JSON array. */
function extractSubtitles(html) {
  const call = html.match(/openPlayer\(\s*'[^']+'([\s\S]{0,8000}?)\);/)?.[1];
  const array = call?.match(/\[\s*\{[\s\S]*\}\s*\]\s*$/)?.[0];
  if (!array) return [];
  let parsed;
  try {
    parsed = JSON.parse(array);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => ({
      url: absolutise(item?.file),
      label: typeof item?.label === "string" && item.label.trim() ? item.label.trim() : "Altyazı",
      lang: typeof item?.lang === "string" && /^[a-z]{2,3}$/i.test(item.lang) ? item.lang.toLowerCase() : "und",
    }))
    .filter((item) => item.url);
}

/** Highest-bandwidth variant in a master playlist. */
function pickBestVariant(masterBody, masterUrl) {
  const lines = masterBody.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const target = lines[i + 1]?.trim();
    if (!target || target.startsWith("#")) continue;
    if (!best || bandwidth > best.bandwidth) {
      try {
        best = { bandwidth, url: new URL(target, masterUrl).toString() };
      } catch {
        /* skip a variant we cannot resolve */
      }
    }
  }
  return best?.url ?? null;
}

function safeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function isProxyableUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Playlists live on the player host; subtitles on its CDN. Segments are
  // deliberately NOT proxyable — the device fetches those itself.
  if (PLAYER_HOST.test(url.hostname)) return /\/(?:l|ld|m)\.php$/i.test(url.pathname) || url.pathname.endsWith(".m3u8");
  if (CDN_HOST.test(url.hostname)) return /\.(?:vtt|srt)$/i.test(url.pathname);
  return false;
}

function proxiedUrl(request, path, target, referer) {
  const base = new URL(request.url);
  return `${base.origin}${path}?u=${encodeURIComponent(target)}&r=${encodeURIComponent(referer)}`;
}

function resolveCacheKey(pageUrl) {
  return new Request(`https://dizipal-resolver.invalid/resolved?u=${encodeURIComponent(pageUrl)}`);
}

function tokenCacheKey(pageUrl) {
  return new Request(`https://dizipal-resolver.invalid/token?u=${encodeURIComponent(pageUrl)}`);
}

/**
 * The watch page and its player page, which together yield the stream token
 * and the subtitle list. Cached per watch page.
 */
async function readPlayerToken(pageUrl, base, { fresh = false } = {}) {
  const key = tokenCacheKey(pageUrl);
  if (!fresh) {
    const cached = await caches.default.match(key);
    if (cached) return { ...(await cached.json()), cached: true };
  }

  // The page is read HERE, not on the device, and that is not an optimisation.
  // The player host binds the `v` token inside the page to whoever fetched it:
  // a token minted for a phone's IP answers the Worker 403 for the next few
  // minutes, which is exactly what happened when the device posted the blob
  // instead of the URL (2026-09-24). Whoever asks for the stream must be the
  // one who asked for the page.
  const pageResponse = await fetchPastRateLimit(pageUrl, {
    headers: { "user-agent": UA, referer: `${base}/`, accept: "text/html,*/*" },
  });
  if (!pageResponse.ok) {
    logMetric("page_failed", { status: pageResponse.status });
    return { error: `watch page HTTP ${pageResponse.status}` };
  }
  const config = parsePlayerConfig(extractPlayerBlob(await pageResponse.text()));
  if (!config) {
    logMetric("page_has_no_blob");
    return { error: "watch page carries no player config" };
  }

  let iframeUrl;
  try {
    iframeUrl = absolutise(await decryptPlayerUrl(await readPassphrase(base), config));
  } catch (error) {
    logMetric("player_config_undecryptable", { message: String(error?.message ?? error) });
    return { error: "player config could not be decrypted" };
  }
  if (!iframeUrl || !PLAYER_HOST.test(safeHostname(iframeUrl))) {
    return { error: "player config did not decrypt to a player URL" };
  }

  const iframeResponse = await fetchPastRateLimit(iframeUrl, {
    headers: { "user-agent": UA, referer: `${base}/`, accept: "text/html,*/*" },
  });
  if (!iframeResponse.ok) {
    logMetric("iframe_failed", { status: iframeResponse.status });
    return { error: `player page HTTP ${iframeResponse.status}` };
  }
  const iframeHtml = await iframeResponse.text();
  const token = extractPlayerToken(iframeHtml);
  if (!token) {
    logMetric("iframe_shape_changed");
    return { error: "player page no longer calls openPlayer" };
  }

  const value = { token, iframeUrl, subtitles: extractSubtitles(iframeHtml) };
  await caches.default.put(
    key,
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${PLAYER_TOKEN_CACHE_SECONDS}`,
      },
    })
  );
  return value;
}

/** Refetch once after a pause when the player host's burst limiter says 403. */
async function fetchPastRateLimit(url, init) {
  const first = await fetchWithTimeout(url, init);
  if (first.status !== 403) return first;
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
  return fetchWithTimeout(url, init);
}

/** `source2.php` → the master playlist → the variant we want to serve. */
async function readSource(player) {
  const playerOrigin = new URL(player.iframeUrl).origin;
  const sourceResponse = await fetchPastRateLimit(
    `${playerOrigin}/source2.php?v=${encodeURIComponent(player.token)}`,
    { headers: { "user-agent": UA, referer: player.iframeUrl, accept: "application/json, */*" } }
  );
  if (!sourceResponse.ok) {
    logMetric("source_failed", { status: sourceResponse.status });
    return { error: `source HTTP ${sourceResponse.status}` };
  }
  let source;
  try {
    source = await sourceResponse.json();
  } catch {
    return { error: "source did not return JSON" };
  }
  if (source?.expired) return { expired: true, error: "source token expired", status: 409 };

  const file = source?.playlist?.[0]?.sources?.[0]?.file;
  if (typeof file !== "string" || !file.includes("m.php")) {
    logMetric("source_shape_changed");
    return { error: "source carries no m.php playlist" };
  }
  const masterUrl = file.replace("m.php", "master.m3u8");

  const masterResponse = await fetchPastRateLimit(masterUrl, {
    headers: { "user-agent": UA, referer: `${playerOrigin}/`, accept: "*/*" },
  });
  if (!masterResponse.ok) return { error: `master HTTP ${masterResponse.status}` };
  const variantUrl = pickBestVariant(await masterResponse.text(), masterUrl);
  if (!variantUrl) return { error: "master lists no variant" };

  return { masterUrl, variantUrl };
}

async function handlePlayer(request, env, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "body must be JSON" }, { status: 400 });
  }

  const base = normaliseBase(payload?.base ?? env.DIZIPAL_BASE_URL ?? "");
  if (!base) return jsonResponse({ error: "base must be a dizipalN origin" }, { status: 400 });

  const pageUrl = normalisePageUrl(payload?.url, base);
  if (!pageUrl) return jsonResponse({ error: "url must be a page on that dizipal origin" }, { status: 400 });

  const started = Date.now();
  const cacheKey = resolveCacheKey(pageUrl);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    logMetric("resolved_from_cache", { page: pageUrl });
    return cached;
  }

  let player = await readPlayerToken(pageUrl, base);
  if (player.error) return jsonResponse({ error: player.error }, { status: 502 });

  let source = await readSource(player);
  // A cached token that has expired looks exactly like a healthy one until the
  // source says so; read the page again and try once more.
  if (source.expired && player.cached) {
    player = await readPlayerToken(pageUrl, base, { fresh: true });
    if (player.error) return jsonResponse({ error: player.error }, { status: 502 });
    source = await readSource(player);
  }
  if (source.error) return jsonResponse({ error: source.error }, { status: source.status ?? 502 });

  const { iframeUrl, subtitles } = player;
  const { masterUrl } = source;

  const playerOrigin = new URL(iframeUrl).origin;
  const variantUrl = source.variantUrl;

  logMetric("resolved", { ms: Date.now() - started, host: new URL(masterUrl).hostname });
  const answer = jsonResponse({
    stream: proxiedUrl(request, "/playlist", variantUrl, `${playerOrigin}/`),
    streamType: "m3u8",
    // Every segment is refused without it.
    referer: `${playerOrigin}/`,
    subtitles: subtitles.map((item) => ({
      ...item,
      url: proxiedUrl(request, "/subtitle", item.url, `${playerOrigin}/`),
    })),
  }, { headers: { "cache-control": `public, max-age=${RESOLVE_CACHE_SECONDS}` } });

  const stored = answer.clone();
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, stored));
  else await caches.default.put(cacheKey, stored);
  return answer;
}

async function handleProxy(request, kind) {
  const params = new URL(request.url).searchParams;
  const target = params.get("u");
  if (!target || !isProxyableUrl(target)) {
    return new Response("not a proxyable url", { status: 400 });
  }
  // The CDN refuses anything whose Referer is not the player host — its own
  // origin is not good enough, which is why the referer travels with the URL.
  const claimed = params.get("r");
  const referer = claimed && PLAYER_HOST.test(safeHostname(claimed)) ? claimed : `${new URL(target).origin}/`;
  const upstream = await fetchPastRateLimit(target, {
    headers: { "user-agent": UA, referer, accept: "*/*" },
    // A playlist is identical for everyone holding the same token, so this is
    // the one upstream call worth caching — it keeps repeat viewers off the
    // player host's rate limiter entirely.
    cf: { cacheTtl: PLAYLIST_CACHE_SECONDS, cacheEverything: true },
  });
  if (!upstream.ok) {
    logMetric("proxy_failed", { kind, status: upstream.status });
    return new Response(`upstream HTTP ${upstream.status}`, { status: 502 });
  }
  const body = await upstream.text();
  return new Response(body, {
    headers: {
      "content-type":
        kind === "subtitle" ? "text/vtt; charset=utf-8" : "application/vnd.apple.mpegurl",
      "cache-control": `public, max-age=${PLAYLIST_CACHE_SECONDS}`,
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    if (url.pathname === "/player" && request.method === "POST") {
      try {
        return await handlePlayer(request, env, ctx);
      } catch (error) {
        logMetric("player_error", { message: String(error?.message ?? error) });
        return jsonResponse({ error: "resolver failed" }, { status: 502 });
      }
    }

    if (url.pathname === "/playlist" && request.method === "GET") return handleProxy(request, "playlist");
    if (url.pathname === "/subtitle" && request.method === "GET") return handleProxy(request, "subtitle");

    if (url.pathname === "/health") {
      return jsonResponse({ service: "streambox-dizipal-resolver", ok: true });
    }

    return jsonResponse({ error: "not found" }, { status: 404 });
  },
};

export const __internal = {
  absolutise,
  extractPlayerBlob,
  normalisePageUrl,
  safeHostname,
  extractPlayerToken,
  extractSubtitles,
  isProxyableUrl,
  normaliseBase,
  parsePlayerConfig,
  pickBestVariant,
};
