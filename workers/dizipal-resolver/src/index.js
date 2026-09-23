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
 *   1. The app reads the watch page and posts its `div[data-rm-k]` blob here.
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
    return await fetch(url, { ...init, signal: controller.signal });
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

async function handlePlayer(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "body must be JSON" }, { status: 400 });
  }

  const base = normaliseBase(payload?.base ?? env.DIZIPAL_BASE_URL ?? "");
  if (!base) return jsonResponse({ error: "base must be a dizipalN origin" }, { status: 400 });

  const config = parsePlayerConfig(payload?.cfg);
  if (!config) return jsonResponse({ error: "cfg is not a {ciphertext,iv,salt} blob" }, { status: 400 });

  const started = Date.now();
  let iframeUrl;
  try {
    iframeUrl = absolutise(await decryptPlayerUrl(await readPassphrase(base), config));
  } catch (error) {
    logMetric("player_config_undecryptable", { message: String(error?.message ?? error) });
    return jsonResponse({ error: "player config could not be decrypted" }, { status: 502 });
  }
  if (!iframeUrl || !PLAYER_HOST.test(new URL(iframeUrl).hostname)) {
    return jsonResponse({ error: "player config did not decrypt to a player URL" }, { status: 502 });
  }

  const iframeResponse = await fetchWithTimeout(iframeUrl, {
    headers: { "user-agent": UA, referer: `${base}/`, accept: "text/html,*/*" },
  });
  if (!iframeResponse.ok) {
    logMetric("iframe_failed", { status: iframeResponse.status });
    return jsonResponse({ error: `player page HTTP ${iframeResponse.status}` }, { status: 502 });
  }
  const iframeHtml = await iframeResponse.text();
  const token = extractPlayerToken(iframeHtml);
  if (!token) {
    logMetric("iframe_shape_changed");
    return jsonResponse({ error: "player page no longer calls openPlayer" }, { status: 502 });
  }

  const playerOrigin = new URL(iframeUrl).origin;
  const sourceResponse = await fetchWithTimeout(
    `${playerOrigin}/source2.php?v=${encodeURIComponent(token)}`,
    { headers: { "user-agent": UA, referer: iframeUrl, accept: "application/json, */*" } }
  );
  if (!sourceResponse.ok) {
    logMetric("source_failed", { status: sourceResponse.status });
    return jsonResponse({ error: `source HTTP ${sourceResponse.status}` }, { status: 502 });
  }
  let source;
  try {
    source = await sourceResponse.json();
  } catch {
    return jsonResponse({ error: "source did not return JSON" }, { status: 502 });
  }
  if (source?.expired) return jsonResponse({ error: "source token expired" }, { status: 409 });

  const file = source?.playlist?.[0]?.sources?.[0]?.file;
  if (typeof file !== "string" || !file.includes("m.php")) {
    logMetric("source_shape_changed");
    return jsonResponse({ error: "source carries no m.php playlist" }, { status: 502 });
  }
  const masterUrl = file.replace("m.php", "master.m3u8");

  const masterResponse = await fetchWithTimeout(masterUrl, {
    headers: { "user-agent": UA, referer: `${playerOrigin}/`, accept: "*/*" },
  });
  if (!masterResponse.ok) {
    return jsonResponse({ error: `master HTTP ${masterResponse.status}` }, { status: 502 });
  }
  const variantUrl = pickBestVariant(await masterResponse.text(), masterUrl);
  if (!variantUrl) return jsonResponse({ error: "master lists no variant" }, { status: 502 });

  logMetric("resolved", { ms: Date.now() - started, host: new URL(masterUrl).hostname });
  return jsonResponse({
    stream: proxiedUrl(request, "/playlist", variantUrl, `${playerOrigin}/`),
    streamType: "m3u8",
    // Every segment is refused without it.
    referer: `${playerOrigin}/`,
    subtitles: extractSubtitles(iframeHtml).map((item) => ({
      ...item,
      url: proxiedUrl(request, "/subtitle", item.url, `${playerOrigin}/`),
    })),
  });
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
  const upstream = await fetchWithTimeout(target, {
    headers: { "user-agent": UA, referer, accept: "*/*" },
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
  async fetch(request, env) {
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
        return await handlePlayer(request, env);
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
  safeHostname,
  extractPlayerToken,
  extractSubtitles,
  isProxyableUrl,
  normaliseBase,
  parsePlayerConfig,
  pickBestVariant,
};
