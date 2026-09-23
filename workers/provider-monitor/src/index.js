const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const STATE_KEY = "provider-monitor-state-v1";

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({
    service: "streambox-provider-monitor",
    event,
    ...fields,
  }));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function getFailureThreshold(env) {
  const threshold = Number(env.FAILURE_THRESHOLD ?? DEFAULT_FAILURE_THRESHOLD);
  return Number.isFinite(threshold) && threshold > 0
    ? Math.floor(threshold)
    : DEFAULT_FAILURE_THRESHOLD;
}

function getTimeoutMs(env) {
  const timeoutMs = Number(env.REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS);
  return Number.isFinite(timeoutMs) && timeoutMs >= 1000
    ? Math.floor(timeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// 128 KiB. The Dizipal playback canary needs to read `data-cfg`, which sits
// ~44 KiB into a ~95 KiB episode page; 64 KiB left no headroom for the page
// to grow, and running out of body would have read as a shape change.
async function readLimitedText(response, maxBytes = 131072) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks = [];
  let totalBytes = 0;

  while (totalBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;

    const remaining = maxBytes - totalBytes;
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    totalBytes += chunk.byteLength;

    if (value.byteLength > remaining) {
      await reader.cancel("read limit reached");
      break;
    }
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function looksLikeChallengePage(text) {
  const lower = text.toLowerCase();
  return lower.includes("just a moment")
    || lower.includes("cf-challenge")
    || lower.includes("cloudflare ray id")
    || lower.includes("checking your browser");
}

function baseHeaders(referer) {
  return {
    "accept": "application/json, text/plain, */*",
    "referer": referer,
    "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
  };
}

// Detects whether the configured URL has been rotated to a new domain.
// Dizipal CDN issues a 301 from the old host to the new one; with
// redirect:"follow" the bot used to get a 200 from the final URL and
// declare everything healthy, masking the rotation. Compare the final
// origin to the requested origin to surface stale config.
function compareOrigins(requestedUrl, finalUrl) {
  try {
    const requestedOrigin = new URL(requestedUrl).origin;
    const finalOrigin = new URL(finalUrl).origin;
    if (requestedOrigin === finalOrigin) {
      return { rotated: false, requestedOrigin, finalOrigin };
    }
    return { rotated: true, requestedOrigin, finalOrigin };
  } catch {
    return { rotated: false, requestedOrigin: null, finalOrigin: null };
  }
}

/**
 * How many extra times a challenged request is retried before the endpoint is
 * called down.
 *
 * On 2026-09-09 Dizipal began serving Cloudflare challenge pages to a fraction
 * of requests. This monitor took the first 403 as gospel, so three consecutive
 * 12-hourly runs each caught one and paged "Dizipal is down" for 36 hours —
 * while the site was serving 36/36 clean responses to the very same Worker
 * egress when re-probed by hand. The app has retried past this since
 * 2026-09-02 (`PROVIDER_CHALLENGE_RETRIES` in WebPlayerService); the monitor
 * has to model the same client or it reports outages users never see.
 *
 * The second cost was worse than the noise: a challenge is served AT the
 * requested host, so the request never redirects, so `compareOrigins` sees no
 * rotation. Dizipal had in fact rotated 2127 → 2130 underneath, and the 403
 * hid the one fact that actually needed acting on.
 */
const CHALLENGE_RETRIES = 2;
const CHALLENGE_RETRY_DELAY_MS = 750;

// `cf-mitigated: challenge` is Cloudflare's own marker on every challenge
// response, whatever language or template the page body is served in; the
// body terms stay as a fallback for pages served without it.
function isChallengeResponse(response, body) {
  if (response.status !== 403 && response.status !== 503) return false;
  return response.headers.get("cf-mitigated") === "challenge" || looksLikeChallengePage(body);
}

// A bare "HTTP 403" says nothing about WHO refused. On 2026-09-18 Dizipal's
// new 2133 host answered the Worker 403 and the monitor recorded nothing else;
// the page title ("Error 403") was what showed it was DDoS-Guard blocking the
// Worker's IPs rather than the site being down.
function pageTitle(body) {
  const title = body.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  return title || null;
}

/**
 * Names the anti-bot wall when a refusal is one, else null.
 *
 * Since 2026-09-18 Dizipal sits behind DDoS-Guard, which answers every request
 * from Cloudflare's network 403 while residential users get 200. Counting that
 * as "down" paged an outage nobody had and, worse, trained the reader to ignore
 * the bot. A walled check is reported as `blocked` — not observable from here —
 * and the domain rotation is watched through DNS instead (`checkDizipalDomain`).
 *
 * Since its Sept 2026 rebuild Dizibal does the same from its own origin: every
 * page answers datacenter IPs 403 "Erişim Engellendi … Bu IP adresi güvenlik
 * nedeniyle yasaklanmıştır" (this IP is banned) while residential users get 200.
 */
function blockingWall(response, body) {
  if (response.status !== 403 && response.status !== 429 && response.status !== 503) return null;
  const server = (response.headers.get("server") ?? "").toLowerCase();
  if (server.includes("ddos-guard") || /ddos-guard/i.test(body)) return "DDoS-Guard";
  if (/IP adresi güvenlik nedeniyle yasaklanmış/i.test(body)) return "Dizibal's IP ban";
  if (isChallengeResponse(response, body)) return "a Cloudflare challenge";
  return null;
}

// ─── DNS ─────────────────────────────────────────────────────────────
// DDoS-Guard walls off Dizipal's pages, but not the DNS. Dizipal registers its
// numbered domains in bulk ahead of time (2134–2150+ were all registered on
// 2026-07-22) on placeholder nameservers that do not serve the zone, so a future
// domain answers SERVFAIL until the day it goes live and gets real records.
// "The next dizipalN resolves" is therefore the rotation signal, and asking a
// public resolver over HTTPS is not something the wall can see or block.
const DOH_ENDPOINTS = [
  (name) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`,
  (name) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`,
];
const DNS_ADDRESS_TYPES = new Set([1, 5, 28]); // A, CNAME, AAAA
const DNS_TIMEOUT_MS = 5000;

/**
 * Whether `hostname` has address records. true / false, or null when no
 * resolver could be asked — callers must treat null as "unknown", never "gone".
 */
async function resolvesInDns(hostname) {
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint(hostname), {
        method: "GET",
        headers: { accept: "application/dns-json" },
      }, DNS_TIMEOUT_MS);
      if (!response.ok) continue;
      const data = await response.json();
      if (typeof data?.Status !== "number") continue;
      // NXDOMAIN (3) and SERVFAIL (2 — the placeholder nameservers) both mean
      // "not live".
      return data.Status === 0
        && Array.isArray(data.Answer)
        && data.Answer.some((answer) => DNS_ADDRESS_TYPES.has(answer?.type));
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

/** `https://dizipal2133.com` → { number: 2133, prefix: "", tld: "com" }. */
function parseDizipalHost(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = host.match(/^((?:[a-z0-9-]+\.)?)dizipal(\d+)\.([a-z.]+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]), tld: match[3] };
}

function dizipalOrigin(parsed, number) {
  return `https://${parsed.prefix}dizipal${number}.${parsed.tld}`;
}

// Dizipal skips numbers now and then (2079 → 2123 was 22 hops), so look a
// little further ahead than the next one.
const DIZIPAL_DNS_LOOKAHEAD = 12;

async function checkDizipalDomain(providers) {
  const startedAt = Date.now();
  const configured = normalizeBaseUrl(providers.dizipal.baseUrl);
  const finish = (fields) => ({
    id: "dizipal_domain",
    label: "Dizipal domain (DNS)",
    url: `${configured}/`,
    finalUrl: null,
    status: null,
    statusLabel: "dns",
    rotated: false,
    latestBaseUrl: null,
    blocked: false,
    challengedAttempts: 0,
    ...fields,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  });

  const parsed = parseDizipalHost(configured);
  if (!parsed) {
    return finish({ ok: true, reason: "configured host is not dizipalN — DNS rotation watch skipped" });
  }

  const numbers = Array.from({ length: DIZIPAL_DNS_LOOKAHEAD + 1 }, (_, index) => parsed.number + index);
  const answers = await Promise.all(
    numbers.map((number) => resolvesInDns(new URL(dizipalOrigin(parsed, number)).hostname))
  );

  if (answers.every((answer) => answer === null)) {
    return finish({ ok: false, blocked: true, reason: "DNS-over-HTTPS unavailable — rotation watch skipped this run" });
  }

  const configuredHost = new URL(configured).hostname;
  let newest = null;
  for (let index = answers.length - 1; index >= 1; index--) {
    if (answers[index] === true) {
      newest = numbers[index];
      break;
    }
  }

  if (newest !== null) {
    const latest = dizipalOrigin(parsed, newest);
    const configuredState = answers[0] === false ? "no longer resolves" : "still resolves and should now redirect";
    return finish({
      ok: false,
      rotated: true,
      latestBaseUrl: latest,
      finalUrl: `${latest}/`,
      reason: `URL rotated: ${new URL(latest).hostname} resolves in DNS; ${configuredHost} ${configuredState}`,
    });
  }

  if (answers[0] === false) {
    return finish({
      ok: false,
      reason: `${configuredHost} no longer resolves in DNS and no newer dizipalN.${parsed.tld} does`,
    });
  }

  return finish({ ok: true, reason: `ok (${configuredHost} resolves; no newer dizipalN in DNS)` });
}

async function checkHttpEndpoint({ id, label, url, referer, validator, watchRotation = true }, env) {
  const startedAt = Date.now();
  const timeoutMs = getTimeoutMs(env);

  try {
    let response;
    let body;
    let challengedAttempts = 0;

    for (let attempt = 0; attempt <= CHALLENGE_RETRIES; attempt++) {
      response = await fetchWithTimeout(url, {
        method: "GET",
        redirect: "follow",
        headers: baseHeaders(referer),
      }, timeoutMs);
      body = await readLimitedText(response);

      if (!isChallengeResponse(response, body)) break;

      challengedAttempts += 1;
      if (attempt === CHALLENGE_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, CHALLENGE_RETRY_DELAY_MS));
    }

    const validatorResult = validator
      ? validator(response, body)
      : { ok: response.ok, reason: response.ok ? "ok" : `HTTP ${response.status}` };
    const transport = Boolean(response.ok && validatorResult.ok);
    // A third-party host (Dizibal's player) moving is not the provider rotating.
    const rotation = watchRotation
      ? compareOrigins(url, response.url ?? url)
      : { rotated: false, requestedOrigin: null, finalOrigin: null };
    // Endpoint is only "ok" if it works AND the origin hasn't rotated.
    // A 200 from a redirected host means the user's configured URL is stale.
    const ok = transport && !rotation.rotated;
    // A rotation is the actionable half of a mixed result, so never let a
    // transport failure swallow it — that is exactly how the 2127 → 2130
    // rotation stayed invisible behind three days of 403 pages.
    const rotationNote = rotation.rotated
      ? `URL rotated: ${rotation.requestedOrigin} → ${rotation.finalOrigin}`
      : "";
    const title = response.ok ? null : pageTitle(body);
    const wall = transport ? null : blockingWall(response, body);
    const failureReason = (wall ? `blocked by ${wall} — ` : "")
      + (validatorResult.reason || `HTTP ${response.status}`)
      + (title ? ` (page: "${title}")` : "");
    const challengeNote = challengedAttempts > 0
      ? ` (survived ${challengedAttempts} Cloudflare challenge${challengedAttempts === 1 ? "" : "s"})`
      : "";
    const reason = !transport
      ? (rotationNote ? `${failureReason} — ${rotationNote}` : failureReason)
      : rotationNote || `ok${challengeNote}`;

    return {
      id,
      label,
      url,
      finalUrl: response.url ?? url,
      ok,
      status: response.status,
      reason,
      rotated: rotation.rotated,
      latestBaseUrl: rotation.rotated ? rotation.finalOrigin : null,
      blocked: Boolean(wall),
      challengedAttempts,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      label,
      url,
      finalUrl: null,
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
      rotated: false,
      latestBaseUrl: null,
      blocked: false,
      challengedAttempts: 0,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function fetchProviderConfigs(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase provider monitor env vars are missing.");
  }

  const endpoint = `${normalizeBaseUrl(env.SUPABASE_URL)}/functions/v1/provider-configs`;
  const response = await fetchWithTimeout(endpoint, {
    method: "GET",
    headers: {
      "accept": "application/json",
      "apikey": env.SUPABASE_ANON_KEY,
      "authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
      "user-agent": "StreamBox-Provider-Monitor/1.0",
    },
  }, getTimeoutMs(env));

  if (!response.ok) {
    throw new Error(`Provider config fetch failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  const providers = data?.providers;
  if (!providers?.dizipal?.baseUrl) {
    throw new Error("Provider config response is missing dizipal.");
  }

  // Backfill optional providers so callers can always dereference
  // providers.dizibal without null checks. The Supabase row exists once
  // supabase/migrations/20260619_… has been applied; the in-code default
  // covers the gap if a deployment landed first.
  if (!providers.dizibal?.baseUrl) {
    providers.dizibal = { baseUrl: "https://dizibal.org", referer: "https://dizibal.org/" };
  }

  return providers;
}

function buildProviderChecks(providers) {
  const dizipalBaseUrl = normalizeBaseUrl(providers.dizipal.baseUrl);
  const dizipalReferer = providers.dizipal.referer || `${dizipalBaseUrl}/`;
  const dizibalBaseUrl = normalizeBaseUrl(providers.dizibal.baseUrl);
  const dizibalReferer = providers.dizibal.referer || `${dizibalBaseUrl}/`;

  // ─── Why there is no HDFilm check here ───────────────────────────────
  // HDFilm is the app's TIER 1 provider, and in Sep 2026 its decoder changed
  // shape and every title on it went dead — while this monitor stayed fully
  // green, because it has never probed HDFilm at all.
  //
  // It cannot. HDFilm sits behind Cloudflare and challenges Cloudflare Worker
  // egress: from a Worker, both www.hdfilmcehennemi.nl and
  // hdfilmcehennemi.mobi answer 403 "Just a moment..." for every path
  // (verified via `wrangler dev --remote`, 2026-09-08). A check added here
  // would fail permanently and train everyone to ignore the alerts — the same
  // trap documented below for Dizibal's homepage.
  //
  // Tier-1 health therefore runs from a normal network instead: `npm run
  // check:hdfilm`, run by hand from a residential connection. There is NO CI
  // workflow for it and there must not be — GitHub Actions runners are
  // datacenter IPs and are challenged exactly like Worker egress; that
  // workflow existed once and was deleted after it did nothing but send false
  // alarms. The in-app `player_resolve` telemetry is the passive tier-1
  // outage signal. Re-verified from Worker egress 2026-09-24: HDFilm 403,
  // Dizipal 200 (the rebuilt site is on Cloudflare, not DDoS-Guard, so it is
  // visible from here again), Dizibal site 403 (IP ban), Dizibal player 200.
  return [
    {
      id: "dizipal_home",
      label: "Dizipal home",
      url: `${dizipalBaseUrl}/`,
      referer: dizipalReferer,
      validator: (response, body) => ({
        ok: response.status >= 200 && response.status < 400 && !looksLikeChallengePage(body),
        reason: looksLikeChallengePage(body) ? "Cloudflare/challenge page" : `HTTP ${response.status}`,
      }),
    },
    {
      id: "dizipal_search",
      label: "Dizipal search",
      // The rebuilt site's search is a POST to /bg/searchcontent carrying a
      // cKey/cValue pair minted per page render. Without them the endpoint
      // answers 200 with an empty result set — indistinguishable from "Dizipal
      // does not have it" — so what has to be watched is that the home page
      // still hands the pair out, which is the half that can silently change.
      url: `${dizipalBaseUrl}/`,
      referer: dizipalReferer,
      validator: (response, body) => {
        if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status}` };
        if (looksLikeChallengePage(body)) return { ok: false, reason: "Cloudflare/challenge page" };
        const action = /data-action="\/bg\/searchcontent"/.test(body);
        const cKey = /name="cKey"\s+value="[^"]+"/.test(body);
        const cValue = /name="cValue"\s+value="[^"]+"/.test(body);
        const ok = action && cKey && cValue;
        return { ok, reason: ok ? "ok" : "home page no longer mints the search cKey/cValue — push OTA" };
      },
    },
    {
      id: "dizipal_playback",
      label: "Dizipal playback config",
      // Search being healthy says nothing about whether a title can actually
      // PLAY: in Sept 2026 Dizipal renamed its player-config endpoint and
      // search kept answering 200 for the whole outage. Since the rebuild the
      // watch page carries one encrypted `div[data-rm-k]` blob, so checking
      // that the canary episode still ships one covers the device half of the
      // playback path in a single request. `dizipal_resolver` covers the rest.
      //
      // Canary is a long-running catalog title at a stable slug.
      url: `${dizipalBaseUrl}/dizi/breaking-bad/1-sezon/1-bolum`,
      referer: dizipalReferer,
      validator: (response, body) => {
        if (response.status !== 200) {
          return { ok: false, reason: `HTTP ${response.status}` };
        }
        if (looksLikeChallengePage(body)) {
          return { ok: false, reason: "Cloudflare/challenge page" };
        }
        const blob = extractDizipalPlayerBlob(body);
        if (!blob) return { ok: false, reason: "episode page has no div[data-rm-k] — push OTA" };
        const ok = typeof blob.ciphertext === "string" && typeof blob.iv === "string" && typeof blob.salt === "string";
        return { ok, reason: ok ? "ok" : "player blob lacks {ciphertext,iv,salt} — push OTA" };
      },
    },
    // ─── Dizibal ─────────────────────────────────────────────────
    // Dizibal rebuilt its site in Sept 2026: the JSON API (/api/movies,
    // /api/site-config/…) is gone (404) and the app now reads the header
    // search box, the watch page, and the "pilavyer" player the page embeds.
    // The site itself IP-bans Cloudflare's network (`blockingWall`), so the
    // search check is `blocked` from here; the player host is not walled and
    // is the half of the chain that can actually be watched.
    {
      id: "dizibal_search",
      label: "Dizibal search",
      url: `${dizibalBaseUrl}/ara/oneri?q=breaking%20bad`,
      referer: dizibalReferer,
      validator: (response, body) => {
        if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status}` };
        try {
          const parsed = JSON.parse(body);
          const ok = Array.isArray(parsed?.series)
            && parsed.series.some((item) => /\/series\/breaking-bad\/?$/.test(item?.url ?? ""));
          return { ok, reason: ok ? "ok" : "search no longer lists /series/{slug} urls — push OTA" };
        } catch {
          return { ok: false, reason: "search did not return JSON — push OTA" };
        }
      },
    },
    {
      id: "dizibal_player",
      label: "Dizibal player",
      // The player page Breaking Bad 1×1 mounts (its data-pv slug is stable).
      // It is origin-locked: 403 unless the Referer is the Dizibal origin.
      url: "https://pilavyerplay.top/assets/js/s.php?s=yEILM0ysEtqZE5fmdNHeeg",
      referer: `${dizibalBaseUrl}/`,
      watchRotation: false,
      validator: (response, body) => {
        if (response.status === 404) return { ok: false, reason: "canary video gone (HTTP 404) — pick a new data-pv slug" };
        if (response.status !== 200) return { ok: false, reason: `HTTP ${response.status}` };
        const raw = body.match(/window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)?.[1];
        try {
          const ok = /^https:\/\//.test(JSON.parse(raw ?? "")?.stream ?? "");
          return { ok, reason: ok ? "ok" : "__PLAYER__ has no stream url — push OTA" };
        } catch {
          return { ok: false, reason: "player page no longer carries window.__PLAYER__ — push OTA" };
        }
      },
    },
  ];
}

async function loadState(env) {
  const raw = await env.PROVIDER_MONITOR_KV.get(STATE_KEY);
  if (!raw) return { checks: {} };

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.checks ? parsed : { checks: {} };
  } catch {
    return { checks: {} };
  }
}

async function saveState(env, state) {
  await env.PROVIDER_MONITOR_KV.put(STATE_KEY, JSON.stringify(state));
}

function buildNextCheckState(previous, result, failureThreshold) {
  // A walled check says nothing about the site, so it neither counts towards
  // "down" nor keeps an earlier count alive.
  const failedCount = result.ok || result.blocked ? 0 : (previous?.failedCount ?? 0) + 1;
  const previousStatus = previous?.status ?? "unknown";
  // Rotation is a softer state than "down" — the upstream is reachable, just
  // at a new domain. Stop the failedCount climb from declaring it down.
  const nextStatus = result.ok
    ? "up"
    : result.rotated
      ? "rotated"
      : result.blocked
        ? "blocked"
        : failedCount >= failureThreshold
          ? "down"
          : previousStatus === "down"
            ? "down"
            : "degraded";

  return {
    status: nextStatus,
    previousStatus,
    failedCount,
    lastOkAt: result.ok ? result.checkedAt : previous?.lastOkAt ?? null,
    lastFailureAt: result.ok ? previous?.lastFailureAt ?? null : result.checkedAt,
    lastStatus: result.status,
    lastReason: result.reason,
    lastUrl: result.url,
    lastFinalUrl: result.finalUrl ?? null,
    lastRotatedOrigin: result.latestBaseUrl ?? previous?.lastRotatedOrigin ?? null,
    lastDurationMs: result.durationMs,
    updatedAt: result.checkedAt,
  };
}

function buildAlerts(previous, next, result) {
  const alerts = [];

  // A URL rotation is a separate, lower-severity signal from "down" — the
  // provider is still reachable, just at a new domain. Use the check's id
  // prefix to derive the correct /set_* command so the same code path
  // covers dizipal + vidsrc + embedsu rotations.
  if (result.rotated && (previous.lastRotatedOrigin ?? null) !== result.latestBaseUrl) {
    const setCommand = setCommandForCheck(result.id);
    alerts.push({
      type: "rotated",
      title: `${result.label} URL rotated`,
      message: setCommand
        ? `${result.label} rotated to a new domain.\n\nConfigured: ${result.url}\nLatest: ${result.latestBaseUrl}\n\nUpdate with:\n${setCommand} ${result.latestBaseUrl}`
        : `${result.label} rotated to a new domain.\n\nConfigured: ${result.url}\nLatest: ${result.latestBaseUrl}\n\nNo /set_ command available for this host — the new domain needs to be added to the on-device scraper (OTA push).`,
    });
  }

  // Scraper-shape change — distinct from URL rotation. The hop is still
  // reachable but no longer emits the expected markup. The fix is a code
  // change in src/services/WebPlayerService.ts followed by an OTA push.
  if (!result.ok && !result.rotated && !result.blocked && /push OTA/i.test(result.reason ?? "") && previous.lastReason !== result.reason) {
    alerts.push({
      type: "shape_change",
      title: `${result.label} scraper-shape change`,
      message: `${result.label} markup changed at ${result.url}.\n\n${result.reason}\n\nNext step: open the URL in a browser, inspect the new pattern, update the matching parser in src/services/WebPlayerService.ts, then \`eas update --branch preview\`.`,
    });
  }

  if (previous.status !== "down" && next.status === "down" && !result.rotated) {
    alerts.push({
      type: "down",
      title: `${result.label} is down`,
      message: `${result.label} failed at ${result.url}\nReason: ${result.reason}\nHTTP: ${result.status ?? "network error"}\nConsecutive failures: ${next.failedCount}`,
    });
  }

  if (previous.status !== "blocked" && next.status === "blocked") {
    alerts.push({
      type: "blocked",
      title: `${result.label} is not observable`,
      message: `${result.label}: ${result.reason}`,
    });
  }

  if ((previous.status === "down" || previous.status === "blocked") && next.status === "up") {
    alerts.push({
      type: "recovered",
      title: `${result.label} recovered`,
      message: previous.status === "blocked"
        ? `${result.label} is visible to the monitor again at ${result.url}\nHTTP: ${result.status ?? "n/a"}`
        : `${result.label} is back up at ${result.url}\nHTTP: ${result.status}\nDuration: ${result.durationMs}ms`,
    });
  }

  return alerts;
}

// One walled provider trips every one of its checks at once; say it once.
function mergeBlockedAlerts(alerts) {
  const blocked = alerts.filter((alert) => alert.type === "blocked");
  if (blocked.length <= 1) return alerts;
  return [
    ...alerts.filter((alert) => alert.type !== "blocked"),
    {
      type: "blocked",
      title: "Checks not observable",
      message: blocked.map((alert) => alert.message).join("\n"),
    },
  ];
}

function formatAlert(alert) {
  if (alert.type !== "blocked") return alert.message;
  return [
    "The monitor can't see these checks from Cloudflare's network:",
    "",
    alert.message,
    "",
    "They are not counted as down. Dizipal domain rotations are still detected through DNS.",
  ].join("\n");
}

async function sendTelegramAlert(env, alert) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    logMetric("telegram_alert_skipped", { reason: "missing_config", alertType: alert.type });
    return;
  }

  await sendTelegramMessage(
    env,
    env.TELEGRAM_CHAT_ID,
    `StreamBox provider alert\n\n${formatAlert(alert)}`
  );
}

async function sendTelegramMessage(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Telegram bot token is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram alert failed with HTTP ${response.status}.`);
  }
}

async function runProviderChecks(env, providers) {
  const checks = buildProviderChecks(providers);
  return Promise.all(checks.map((check) => checkHttpEndpoint(check, env)));
}

// HTTP checks plus the DNS rotation watch. The DNS check is deliberately NOT
// part of `runProviderChecks`: that set also validates a /set_ candidate, and
// "a newer domain exists" says nothing about whether the candidate is healthy.
/** The encrypted player config a rebuilt Dizipal watch page carries. */
function extractDizipalPlayerBlob(html) {
  const raw = html.match(/data-rm-k="true"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim());
  } catch {
    return null;
  }
}

/**
 * The half of playback the device cannot do for itself.
 *
 * Dizipal's player host answers 403 to our users' networks for every dynamic
 * path, so `workers/dizipal-resolver` asks on their behalf. That makes it part
 * of the playback path: if it stops turning a live page blob into a stream,
 * every Dizipal title is dead even though the site itself is fine. This check
 * is therefore end-to-end — canary page → blob → resolver → stream URL.
 */
async function checkDizipalResolver(providers, env) {
  const startedAt = Date.now();
  const base = normalizeBaseUrl(providers.dizipal.baseUrl);
  const resolver = (env.DIZIPAL_RESOLVER_URL || "https://dizipal.streamboxapp.stream").replace(/\/+$/, "");
  const canary = `${base}/dizi/breaking-bad/1-sezon/1-bolum`;
  const finish = (fields) => ({
    id: "dizipal_resolver",
    label: "Dizipal resolver",
    url: `${resolver}/player`,
    finalUrl: null,
    status: null,
    statusLabel: "post",
    rotated: false,
    latestBaseUrl: null,
    blocked: false,
    challengedAttempts: 0,
    ...fields,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  });

  try {
    const page = await fetchWithTimeout(canary, {
      method: "GET",
      redirect: "follow",
      headers: { ...baseHeaders(`${base}/`), accept: "text/html,*/*" },
    }, getTimeoutMs(env));
    const html = await page.text();
    if (!page.ok) return finish({ ok: false, status: page.status, reason: `canary page HTTP ${page.status}` });
    const wall = blockingWall(page.status, html);
    if (wall) return finish({ ok: false, blocked: true, status: page.status, reason: wall });
    const blob = extractDizipalPlayerBlob(html);
    if (!blob) {
      return finish({ ok: false, status: page.status, reason: "canary page has no player blob — push OTA" });
    }

    const response = await fetchWithTimeout(`${resolver}/player`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cfg: JSON.stringify(blob), base }),
    }, getTimeoutMs(env));
    const text = await response.text();
    if (!response.ok) {
      return finish({ ok: false, status: response.status, reason: `resolver HTTP ${response.status}: ${text.slice(0, 120)}` });
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return finish({ ok: false, status: response.status, reason: "resolver did not return JSON" });
    }
    const ok = typeof parsed?.stream === "string" && /^https:\/\//.test(parsed.stream);
    return finish({
      ok,
      status: response.status,
      reason: ok ? "ok" : "resolver returned no stream — Dizipal's player chain moved",
    });
  } catch (error) {
    return finish({ ok: false, reason: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error) });
  }
}

async function runAllChecks(env, providers) {
  const [httpResults, domainResult, resolverResult] = await Promise.all([
    runProviderChecks(env, providers),
    checkDizipalDomain(providers),
    checkDizipalResolver(providers, env),
  ]);
  return [...httpResults, domainResult, resolverResult];
}

async function runMonitor(env) {
  const startedAt = Date.now();
  const failureThreshold = getFailureThreshold(env);
  const providers = await fetchProviderConfigs(env);
  const results = await runAllChecks(env, providers);
  const state = await loadState(env);
  const nextState = { checks: {}, lastRunAt: new Date().toISOString() };
  let alerts = [];

  for (const result of results) {
    const previous = state.checks[result.id] ?? { status: "unknown", failedCount: 0 };
    const next = buildNextCheckState(previous, result, failureThreshold);
    nextState.checks[result.id] = next;
    alerts.push(...buildAlerts(previous, next, result));
  }
  alerts = mergeBlockedAlerts(alerts);

  await saveState(env, nextState);

  for (const alert of alerts) {
    await sendTelegramAlert(env, alert);
  }

  logMetric("provider_monitor_run", {
    ok: results.every((result) => result.ok),
    checks: results.length,
    alerts: alerts.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok: results.every((result) => result.ok),
    alerts: alerts.length,
    checkedAt: nextState.lastRunAt,
    results,
  };
}

function extractTelegramMessage(update) {
  return update?.message ?? update?.edited_message ?? null;
}

function getTelegramCommand(text) {
  const [rawCommand, ...args] = String(text ?? "").trim().split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();
  return { command, args };
}

function isAllowedTelegramRequest(request, env) {
  // Fail closed: without the webhook secret anyone could post updates here.
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    logMetric("telegram_webhook_rejected", { reason: "secret_not_configured" });
    return false;
  }
  const token = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return token === env.TELEGRAM_WEBHOOK_SECRET;
}

function isAllowedTelegramChat(chatId, env) {
  return Boolean(env.TELEGRAM_CHAT_ID) && String(chatId) === String(env.TELEGRAM_CHAT_ID);
}

// Provider registry — single source of truth for host validation rules,
// the /set_ command name, and which check ids belong to a given provider.
const PROVIDER_DEFINITIONS = {
  dizipal: {
    setCommand: "/set_dizipal",
    hostMatch: (host) => host.toLowerCase().includes("dizipal"),
    hostExample: "https://dizipal2123.com",
    checkIdPrefixes: ["dizipal_"],
  },
  dizibal: {
    setCommand: "/set_dizibal",
    hostMatch: (host) => host.toLowerCase().includes("dizibal"),
    hostExample: "https://dizibal.org",
    checkIdPrefixes: ["dizibal_"],
  },
};

function setCommandForCheck(checkId) {
  for (const def of Object.values(PROVIDER_DEFINITIONS)) {
    if (def.checkIdPrefixes.some((prefix) => checkId.startsWith(prefix))) {
      return def.setCommand;
    }
  }
  return null;
}

function normalizeCandidateProviderUrl(rawUrl, providerId) {
  const def = PROVIDER_DEFINITIONS[providerId];
  if (!def) throw new Error(`Unknown provider: ${providerId}`);

  let parsed;
  try {
    parsed = new URL(String(rawUrl ?? "").trim());
  } catch {
    throw new Error(`Invalid URL. Use: ${def.setCommand} ${def.hostExample}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL must start with https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL must not include username or password.");
  }
  if (!def.hostMatch(parsed.hostname)) {
    throw new Error(`URL host does not look like a ${providerId} domain.`);
  }
  return parsed.origin;
}

// Run the full monitor with one provider's base URL substituted, so we can
// dry-run a candidate before persisting. Other providers retain their
// current configured URLs (so a /set_vidsrc never accidentally re-checks
// against a stale Dizipal config).
//
// A candidate that fails its checks is still accepted when the CONFIGURED URL
// redirects to it. On 2026-09-18 Dizipal rotated 2132 → 2133, moving from
// Cloudflare to DDoS-Guard, which answers the Worker's IPs 403; the rotation alert
// said "/set_dizipal https://dizipal2133.com", and this function then rejected
// that exact command because 2133 was failing. But the upstream's own 301 is
// what proves which domain is live, and the old URL only put a redirect hop in
// front of the same failure — refusing to save it fixed nothing and left the
// config one hop further behind.
//
// Since 2026-09-18 neither of those can happen for Dizipal: DDoS-Guard walls the
// Worker off from the candidate's pages AND from the old domain's redirect. So a
// candidate whose only failures are that wall is accepted when DNS vouches for
// it (it resolves, and it is not behind the configured domain). `force` is the
// owner's override for anything else.
async function validateProviderCandidate(env, providerId, candidateBaseUrl, { force = false } = {}) {
  const providers = await fetchProviderConfigs(env);
  const configuredBaseUrl = normalizeBaseUrl(providers[providerId]?.baseUrl);
  providers[providerId] = { baseUrl: candidateBaseUrl, referer: `${candidateBaseUrl}/` };

  const allResults = await runProviderChecks(env, providers);
  const ownResults = allResults.filter((r) =>
    PROVIDER_DEFINITIONS[providerId].checkIdPrefixes.some((prefix) => r.id.startsWith(prefix)),
  );
  const failed = ownResults.filter((r) => !r.ok);
  const verdict = { results: ownResults, failed, configuredBaseUrl, redirectedFrom: null, vouchedBy: null, behind: false, resolves: null };
  if (failed.length === 0) {
    return { ...verdict, ok: true };
  }
  if (force) {
    return { ...verdict, ok: true, vouchedBy: "force" };
  }

  const redirectedFrom = configuredBaseUrl
    && configuredBaseUrl !== candidateBaseUrl
    && (await finalRedirectOrigin(env, configuredBaseUrl)) === candidateBaseUrl
    ? configuredBaseUrl
    : null;
  if (redirectedFrom) {
    return { ...verdict, ok: true, redirectedFrom, vouchedBy: "redirect" };
  }

  const behind = isBehindConfigured(configuredBaseUrl, candidateBaseUrl);
  if (behind || !failed.every((r) => r.blocked)) {
    return { ...verdict, ok: false, behind };
  }
  const resolves = await resolvesInDns(new URL(candidateBaseUrl).hostname);
  return { ...verdict, ok: resolves === true, resolves, vouchedBy: resolves === true ? "dns" : null };
}

// Dizipal only moves forward, so a numbered candidate older than the
// configured domain is always a mistake. Non-numbered hosts are never "behind".
function isBehindConfigured(configuredBaseUrl, candidateBaseUrl) {
  const configured = parseDizipalHost(configuredBaseUrl);
  const candidate = parseDizipalHost(candidateBaseUrl);
  return Boolean(configured && candidate && candidate.number < configured.number);
}

// Follows `baseUrl`'s redirect chain hop by hop and returns the origin it ends
// at. Walking it manually means the far end does not have to answer: a host
// that 403s — or does not respond at all — is still where the chain points.
// 25 hops clears axios' 21-redirect ceiling (Dizipal has had 22-hop chains).
async function finalRedirectOrigin(env, baseUrl, maxHops = 25) {
  let url = `${baseUrl}/`;
  for (let hop = 0; hop < maxHops; hop++) {
    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: "GET",
        redirect: "manual",
        headers: baseHeaders(`${baseUrl}/`),
      }, getTimeoutMs(env));
    } catch {
      break;
    }
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    url = new URL(location, url).href;
  }
  return new URL(url).origin;
}

async function updateProviderConfig(env, providerId, baseUrl) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service role secret is not configured.");
  }

  const endpoint = `${normalizeBaseUrl(env.SUPABASE_URL)}/rest/v1/provider_configs?id=eq.${encodeURIComponent(providerId)}`;
  const response = await fetchWithTimeout(endpoint, {
    method: "PATCH",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      "prefer": "return=representation",
      "user-agent": "StreamBox-Provider-Monitor/1.0",
    },
    body: JSON.stringify({
      base_url: baseUrl,
      referer: `${baseUrl}/`,
      notes: `Updated via Telegram bot at ${new Date().toISOString()}`,
    }),
  }, getTimeoutMs(env));

  if (!response.ok) {
    const body = await readLimitedText(response, 4096);
    throw new Error(`Supabase update failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

function formatCheckResults(results) {
  return results
    .map((result) => {
      const marker = result.ok ? "OK" : result.rotated ? "ROTATED" : result.blocked ? "BLOCKED" : "FAIL";
      // HTTP checks report their status code; the DNS check has none, and
      // "network" there reads like a network error rather than the signal used.
      const status = result.status ?? result.statusLabel ?? "network";
      return `${marker} ${result.label}: ${status} (${result.reason})`;
    })
    .join("\n");
}

// Returns the unique latestBaseUrl seen across the rotated results, if any.
// All Dizipal checks should redirect to the same head, so we just take the
// first one — but assert they agree to flag oddball CDN states.
function summariseRotation(results) {
  const rotatedOrigins = Array.from(
    new Set(results.filter((r) => r.rotated && r.latestBaseUrl).map((r) => r.latestBaseUrl))
  );
  if (rotatedOrigins.length === 0) return null;
  return rotatedOrigins;
}

async function handleTelegramStatus(env, chatId) {
  const providers = await fetchProviderConfigs(env);
  const results = await runAllChecks(env, providers);
  const state = await loadState(env);

  const lines = ["StreamBox provider status", ""];

  for (const providerId of Object.keys(PROVIDER_DEFINITIONS)) {
    const def = PROVIDER_DEFINITIONS[providerId];
    const cfg = providers[providerId];
    if (!cfg) continue;
    const own = results.filter((r) =>
      def.checkIdPrefixes.some((prefix) => r.id.startsWith(prefix)),
    );
    const rotatedOrigins = summariseRotation(own);
    const shapeIssue = own.find((r) => !r.ok && !r.rotated && !r.blocked && /push OTA/i.test(r.reason ?? ""));
    const failedChecks = own.filter((r) => !r.ok && !r.rotated && !r.blocked);
    const blockedChecks = own.filter((r) => !r.ok && !r.rotated && r.blocked);

    lines.push(`── ${providerId} ──`);
    lines.push(`Configured: ${normalizeBaseUrl(cfg.baseUrl)}`);

    const stateKey = own.find((r) => state.checks?.[r.id])?.id ?? own[0]?.id;
    if (stateKey) {
      lines.push(`Monitor:    ${state.checks?.[stateKey]?.status ?? "unknown"}`);
    }

    if (rotatedOrigins) {
      const latest = rotatedOrigins[0];
      lines.push(`⚠ URL rotated → ${latest}`);
      lines.push(`Update:     ${def.setCommand} ${latest}`);
    }
    if (shapeIssue) {
      lines.push(`⚠ Shape change: ${shapeIssue.reason}`);
    }
    if (!rotatedOrigins && !shapeIssue) {
      lines.push(
        failedChecks.length === 0
          ? "Up to date."
          : `${failedChecks.length} health check(s) failing.`,
      );
    }
    if (blockedChecks.length > 0) {
      lines.push(`${blockedChecks.length} check(s) not observable from Cloudflare (walled off, not counted as down).`);
    }
    lines.push("", formatCheckResults(own), "");
  }

  await sendTelegramMessage(env, chatId, lines.join("\n"));
}

async function handleTelegramSetProvider(env, chatId, providerId, args) {
  const def = PROVIDER_DEFINITIONS[providerId];
  const candidateUrl = normalizeCandidateProviderUrl(args[0], providerId);
  const force = String(args[1] ?? "").toLowerCase() === "force";
  const validation = await validateProviderCandidate(env, providerId, candidateUrl, { force });

  if (!validation.ok) {
    const rotatedOrigins = summariseRotation(validation.results);
    const candidateHost = new URL(candidateUrl).hostname;
    const lines = [
      `${providerId} update rejected.`,
      "",
      `Candidate: ${candidateUrl}`,
    ];
    if (rotatedOrigins) {
      const latest = rotatedOrigins[0];
      lines.push(
        "",
        `Candidate redirects to ${latest}.`,
        `Use:  ${def.setCommand} ${latest}`,
      );
    }
    if (validation.behind) {
      lines.push("", `Candidate is older than the configured ${validation.configuredBaseUrl} — Dizipal only moves forward.`);
    } else if (validation.resolves === false) {
      lines.push("", `The monitor is walled off from ${candidateHost}, and ${candidateHost} does not resolve in DNS — check the URL.`);
    } else if (validation.resolves === null && validation.failed.every((r) => r.blocked)) {
      lines.push("", `The monitor is walled off from ${candidateHost}, and DNS could not be checked just now.`);
    }
    lines.push("", formatCheckResults(validation.results));
    lines.push("", `To save it anyway: ${def.setCommand} ${candidateUrl} force`);
    await sendTelegramMessage(env, chatId, lines.join("\n"));
    return;
  }

  await updateProviderConfig(env, providerId, candidateUrl);
  let outcome;
  if (validation.vouchedBy === "redirect") {
    outcome = [
      `${providerId} updated — but it is failing right now.`,
      "",
      `New URL: ${candidateUrl}`,
      "",
      `${validation.redirectedFrom} redirects here, so this is the live domain. Its checks fail from the monitor at the moment:`,
      "",
      formatCheckResults(validation.results),
      "",
      "Saved anyway: the old URL only added a redirect in front of the same failure. The monitor reports it as down if this persists.",
    ];
  } else if (validation.vouchedBy === "dns") {
    outcome = [
      `${providerId} updated.`,
      "",
      `New URL: ${candidateUrl}`,
      "",
      `The monitor can't load its pages (${validation.failed[0]?.reason ?? "blocked"}), but ${new URL(candidateUrl).hostname} resolves in DNS, so it was saved.`,
      "",
      formatCheckResults(validation.results),
    ];
  } else if (validation.vouchedBy === "force") {
    outcome = [
      `${providerId} updated (forced — checks were not required to pass).`,
      "",
      `New URL: ${candidateUrl}`,
      "",
      formatCheckResults(validation.results),
    ];
  } else {
    outcome = [
      `${providerId} updated successfully.`,
      "",
      `New URL: ${candidateUrl}`,
      "",
      formatCheckResults(validation.results),
    ];
  }
  outcome.push("", "Active app installs will pick this up on next provider-config refresh.");
  await sendTelegramMessage(env, chatId, outcome.join("\n"));
}

async function handleTelegramWebhook(request, env) {
  if (!isAllowedTelegramRequest(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized webhook token" }, { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid Telegram payload" }, { status: 400 });
  }

  const message = extractTelegramMessage(update);
  const chatId = message?.chat?.id;
  const text = message?.text;

  if (!chatId || !text) {
    return jsonResponse({ ok: true, ignored: true });
  }

  if (!isAllowedTelegramChat(chatId, env)) {
    logMetric("telegram_command_rejected", { reason: "chat_not_allowed", chatId: String(chatId) });
    return jsonResponse({ ok: true, ignored: true });
  }

  const { command, args } = getTelegramCommand(text);

  try {
    if (command === "/status") {
      await handleTelegramStatus(env, chatId);
      return jsonResponse({ ok: true });
    }

    if (command === "/set_dizipal") {
      await handleTelegramSetProvider(env, chatId, "dizipal", args);
      return jsonResponse({ ok: true });
    }

    if (command === "/set_dizibal") {
      await handleTelegramSetProvider(env, chatId, "dizibal", args);
      return jsonResponse({ ok: true });
    }

    await sendTelegramMessage(
      env,
      chatId,
      [
        "Unknown command.",
        "",
        "Use:",
        "/status",
        "/set_dizipal https://dizipal2134.com",
        "/set_dizibal https://dizibal.org",
        "",
        "Append `force` to save a URL the checks cannot confirm.",
      ].join("\n")
    );
    return jsonResponse({ ok: true });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    logMetric("telegram_command_error", { command, message: messageText });
    await sendTelegramMessage(env, chatId, `Command failed.\n\n${messageText}`);
    return jsonResponse({ ok: true, error: messageText });
  }
}

// Gates /run and the status route. Returns a rejection Response, or null when
// the caller presented the right token. A missing token is a 503, never open.
function requireMonitorToken(request, env) {
  if (!env.MANUAL_RUN_TOKEN) {
    logMetric("manual_run_rejected", { reason: "token_not_configured" });
    return jsonResponse({ error: "Not configured" }, { status: 503 });
  }
  const token = request.headers.get("x-monitor-token") ?? "";
  if (token !== env.MANUAL_RUN_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function handleManualRun(request, env) {
  const rejection = requireMonitorToken(request, env);
  if (rejection) return rejection;

  try {
    return jsonResponse(await runMonitor(env));
  } catch (error) {
    logMetric("provider_monitor_manual_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function handleStatus(request, env) {
  const rejection = requireMonitorToken(request, env);
  if (rejection) return rejection;
  const state = await loadState(env);
  return jsonResponse({
    service: "streambox-provider-monitor",
    state,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: { allow: "GET, POST" } });
    }

    if (url.pathname === "/run") {
      return handleManualRun(request, env);
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    return handleStatus(request, env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runMonitor(env).catch((error) => {
        logMetric("provider_monitor_scheduled_error", {
          message: error instanceof Error ? error.message : String(error),
        });
      })
    );
  },
};
