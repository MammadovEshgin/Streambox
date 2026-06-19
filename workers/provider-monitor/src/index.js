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

async function readLimitedText(response, maxBytes = 65536) {
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

async function checkHttpEndpoint({ id, label, url, referer, validator }, env) {
  const startedAt = Date.now();
  const timeoutMs = getTimeoutMs(env);

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      redirect: "follow",
      headers: baseHeaders(referer),
    }, timeoutMs);
    const body = await readLimitedText(response);
    const validatorResult = validator
      ? validator(response, body)
      : { ok: response.ok, reason: response.ok ? "ok" : `HTTP ${response.status}` };
    const transport = Boolean(response.ok && validatorResult.ok);
    const rotation = compareOrigins(url, response.url ?? url);
    // Endpoint is only "ok" if it works AND the origin hasn't rotated.
    // A 200 from a redirected host means the user's configured URL is stale.
    const ok = transport && !rotation.rotated;
    const reason = !transport
      ? (validatorResult.reason || `HTTP ${response.status}`)
      : rotation.rotated
        ? `URL rotated: ${rotation.requestedOrigin} → ${rotation.finalOrigin}`
        : "ok";

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
    providers.dizibal = { baseUrl: "https://dizibal.com", referer: "https://dizibal.com/" };
  }

  return providers;
}

function buildProviderChecks(providers) {
  const dizipalBaseUrl = normalizeBaseUrl(providers.dizipal.baseUrl);
  const dizipalReferer = providers.dizipal.referer || `${dizipalBaseUrl}/`;
  const dizibalBaseUrl = normalizeBaseUrl(providers.dizibal.baseUrl);
  const dizibalReferer = providers.dizibal.referer || `${dizibalBaseUrl}/`;

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
      url: `${dizipalBaseUrl}/ajax-search?q=breaking%20bad`,
      referer: dizipalReferer,
      validator: (response, body) => {
        try {
          const parsed = JSON.parse(body);
          const ok = parsed?.success === true && Array.isArray(parsed.results);
          return { ok, reason: ok ? "ok" : "Dizipal search JSON has no results" };
        } catch {
          return { ok: false, reason: "Dizipal search did not return JSON" };
        }
      },
    },
    // ─── Dizibal ─────────────────────────────────────────────────
    // The app consumes Dizibal's JSON APIs, not its browser homepage. The
    // homepage rejects Cloudflare Worker egress with HTTP 403 while these API
    // endpoints remain healthy, so probing `/` creates a permanent false
    // alarm and must not participate in provider health.
    {
      id: "dizibal_api",
      label: "Dizibal site-config API",
      // Canary endpoint that always exists and is fast. If this stops being
      // success:true, the API contract has changed and the on-device
      // scraper needs an OTA push.
      url: `${dizibalBaseUrl}/api/site-config/maintenance`,
      referer: dizibalReferer,
      validator: (response, body) => {
        if (response.status !== 200) {
          return { ok: false, reason: `HTTP ${response.status}` };
        }
        try {
          const parsed = JSON.parse(body);
          const ok = parsed?.success === true;
          return { ok, reason: ok ? "ok" : "site-config no longer returns success:true — push OTA" };
        } catch {
          return { ok: false, reason: "site-config did not return JSON" };
        }
      },
    },
    {
      id: "dizibal_search_shape",
      label: "Dizibal search shape",
      // Search for The Shawshank Redemption — universal catalog coverage.
      // We're checking that the response is a JSON array with the slug + src
      // fields the on-device scraper depends on.
      url: `${dizibalBaseUrl}/api/movies?search=shawshank&limit=3`,
      referer: dizibalReferer,
      validator: (response, body) => {
        if (response.status !== 200) {
          return { ok: false, reason: `HTTP ${response.status}` };
        }
        try {
          const parsed = JSON.parse(body);
          const hits = Array.isArray(parsed?.data) ? parsed.data : null;
          if (!hits || hits.length === 0) {
            return { ok: false, reason: "search returned no hits — push OTA" };
          }
          const first = hits[0];
          const hasSlug = typeof first.slug === "string" && first.slug.length > 0;
          const hasSrc = typeof first.src === "string" && first.src.length > 0;
          if (!hasSlug || !hasSrc) {
            return {
              ok: false,
              reason: `search shape changed (slug=${hasSlug} src=${hasSrc}) — push OTA`,
            };
          }
          return { ok: true, reason: "ok" };
        } catch {
          return { ok: false, reason: "search did not return JSON" };
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
  const failedCount = result.ok ? 0 : (previous?.failedCount ?? 0) + 1;
  const previousStatus = previous?.status ?? "unknown";
  // Rotation is a softer state than "down" — the upstream is reachable, just
  // at a new domain. Stop the failedCount climb from declaring it down.
  const nextStatus = result.ok
    ? "up"
    : result.rotated
      ? "rotated"
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
  // reachable but no longer emits the expected markup (e.g. vsembed stops
  // emitting data-hash divs). The fix is a code change in
  // src/services/DirectLinkService.ts followed by an OTA push.
  if (!result.ok && !result.rotated && /push OTA/i.test(result.reason ?? "") && previous.lastReason !== result.reason) {
    alerts.push({
      type: "shape_change",
      title: `${result.label} scraper-shape change`,
      message: `${result.label} markup changed at ${result.url}.\n\n${result.reason}\n\nNext step: open the URL in a browser, inspect the new pattern, update the matching regex in src/services/DirectLinkService.ts, then \`eas update --branch preview\`.`,
    });
  }

  if (previous.status !== "down" && next.status === "down" && !result.rotated) {
    alerts.push({
      type: "down",
      title: `${result.label} is down`,
      message: `${result.label} failed at ${result.url}\nReason: ${result.reason}\nHTTP: ${result.status ?? "network error"}\nConsecutive failures: ${next.failedCount}`,
    });
  }

  if (previous.status === "down" && next.status === "up") {
    alerts.push({
      type: "recovered",
      title: `${result.label} recovered`,
      message: `${result.label} is back up at ${result.url}\nHTTP: ${result.status}\nDuration: ${result.durationMs}ms`,
    });
  }

  return alerts;
}

async function sendTelegramAlert(env, alert) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    logMetric("telegram_alert_skipped", { reason: "missing_config", alertType: alert.type });
    return;
  }

  await sendTelegramMessage(
    env,
    env.TELEGRAM_CHAT_ID,
    `StreamBox provider alert\n\n${alert.message}`
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

async function runMonitor(env) {
  const startedAt = Date.now();
  const failureThreshold = getFailureThreshold(env);
  const providers = await fetchProviderConfigs(env);
  const results = await runProviderChecks(env, providers);
  const state = await loadState(env);
  const nextState = { checks: {}, lastRunAt: new Date().toISOString() };
  const alerts = [];

  for (const result of results) {
    const previous = state.checks[result.id] ?? { status: "unknown", failedCount: 0 };
    const next = buildNextCheckState(previous, result, failureThreshold);
    nextState.checks[result.id] = next;
    alerts.push(...buildAlerts(previous, next, result));
  }

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
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
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
    hostExample: "https://dizipal2070.com",
    checkIdPrefixes: ["dizipal_"],
  },
  dizibal: {
    setCommand: "/set_dizibal",
    hostMatch: (host) => host.toLowerCase().includes("dizibal"),
    hostExample: "https://dizibal.com",
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
async function validateProviderCandidate(env, providerId, candidateBaseUrl) {
  const providers = await fetchProviderConfigs(env);
  providers[providerId] = { baseUrl: candidateBaseUrl, referer: `${candidateBaseUrl}/` };

  const allResults = await runProviderChecks(env, providers);
  const ownResults = allResults.filter((r) =>
    PROVIDER_DEFINITIONS[providerId].checkIdPrefixes.some((prefix) => r.id.startsWith(prefix)),
  );
  const failed = ownResults.filter((r) => !r.ok);
  return { ok: failed.length === 0, results: ownResults, failed };
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
      const marker = result.ok ? "OK" : result.rotated ? "ROTATED" : "FAIL";
      const status = result.status ?? "network";
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
  const results = await runProviderChecks(env, providers);
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
    const shapeIssue = own.find((r) => !r.ok && !r.rotated && /push OTA/i.test(r.reason ?? ""));
    const failedChecks = own.filter((r) => !r.ok && !r.rotated);

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
    lines.push("", formatCheckResults(own), "");
  }

  await sendTelegramMessage(env, chatId, lines.join("\n"));
}

async function handleTelegramSetProvider(env, chatId, providerId, args) {
  const def = PROVIDER_DEFINITIONS[providerId];
  const candidateUrl = normalizeCandidateProviderUrl(args[0], providerId);
  const validation = await validateProviderCandidate(env, providerId, candidateUrl);

  if (!validation.ok) {
    const rotatedOrigins = summariseRotation(validation.results);
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
    lines.push("", formatCheckResults(validation.results));
    await sendTelegramMessage(env, chatId, lines.join("\n"));
    return;
  }

  await updateProviderConfig(env, providerId, candidateUrl);
  await sendTelegramMessage(
    env,
    chatId,
    [
      `${providerId} updated successfully.`,
      "",
      `New URL: ${candidateUrl}`,
      "",
      formatCheckResults(validation.results),
      "",
      "Active app installs will pick this up on next provider-config refresh.",
    ].join("\n"),
  );
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
        "/set_dizipal https://dizipal2080.com",
        "/set_dizibal https://dizibal.com",
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

async function handleManualRun(request, env) {
  if (env.MANUAL_RUN_TOKEN) {
    const token = request.headers.get("x-monitor-token") ?? "";
    if (token !== env.MANUAL_RUN_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

async function handleStatus(env) {
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

    return handleStatus(env);
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
