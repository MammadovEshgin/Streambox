const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60 * 6;
const SEARCH_CACHE_TTL_SECONDS = 60 * 5;
const ERROR_CACHE_TTL_SECONDS = 30;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({
    service: "streambox-tmdb-proxy",
    event,
    ...fields,
  }));
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

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const configuredOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowAnyOrigin = configuredOrigins.length === 0;
  const allowedOrigin = allowAnyOrigin || (origin && configuredOrigins.includes(origin))
    ? origin || "*"
    : configuredOrigins[0] || "*";

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type, x-streambox-proxy-target",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function getClientIp(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function getRateLimitConfig(env) {
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS ?? DEFAULT_RATE_LIMIT_WINDOW_SECONDS);
  const maxRequests = Number(env.RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS);

  return {
    windowSeconds: Number.isFinite(windowSeconds) && windowSeconds > 0
      ? Math.floor(windowSeconds)
      : DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    maxRequests: Number.isFinite(maxRequests) && maxRequests > 0
      ? Math.floor(maxRequests)
      : DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  };
}

async function checkRateLimit(request, env) {
  const { windowSeconds, maxRequests } = getRateLimitConfig(env);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowId = Math.floor(nowSeconds / windowSeconds);
  const clientIp = getClientIp(request);
  const cache = caches.default;
  const cacheKey = new Request(
    `https://streambox.internal/rate-limit/tmdb/${encodeURIComponent(clientIp)}/${windowId}`
  );
  const cached = await cache.match(cacheKey);
  const currentCount = cached ? Number(await cached.text()) || 0 : 0;
  const nextCount = currentCount + 1;

  if (nextCount > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, (windowId + 1) * windowSeconds - nowSeconds),
      limit: maxRequests,
      remaining: 0,
    };
  }

  const countResponse = new Response(String(nextCount), {
    headers: {
      "cache-control": `private, max-age=${Math.max(1, windowSeconds + 5)}`,
    },
  });

  await cache.put(cacheKey, countResponse);

  return {
    allowed: true,
    retryAfterSeconds: 0,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - nextCount),
  };
}

function handleOptions(request, env) {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(request, env),
  });
}

function normalizeProxyPath(pathname) {
  const withoutLeadingSlash = pathname.replace(/^\/+/, "");
  const withoutVersionPrefix = withoutLeadingSlash.startsWith("3/")
    ? withoutLeadingSlash.slice(2)
    : withoutLeadingSlash;

  if (!withoutVersionPrefix || withoutVersionPrefix.includes("..")) {
    return null;
  }

  return `/${withoutVersionPrefix}`;
}

function buildTmdbUrl(requestUrl) {
  const normalizedPath = normalizeProxyPath(requestUrl.pathname);
  if (!normalizedPath) {
    return null;
  }

  const targetUrl = new URL(`${TMDB_API_BASE_URL}${normalizedPath}`);
  requestUrl.searchParams.forEach((value, key) => {
    if (key.toLowerCase() !== "api_key") {
      targetUrl.searchParams.append(key, value);
    }
  });

  return targetUrl;
}

function getCacheTtlSeconds(targetUrl, responseStatus) {
  if (responseStatus >= 500) {
    return ERROR_CACHE_TTL_SECONDS;
  }

  if (targetUrl.pathname.includes("/search/")) {
    return SEARCH_CACHE_TTL_SECONDS;
  }

  return DEFAULT_CACHE_TTL_SECONDS;
}

function buildTmdbHeaders(env) {
  const headers = new Headers({
    accept: "application/json",
    "user-agent": "StreamBox-TMDB-Proxy/1.0",
  });

  if (env.TMDB_ACCESS_TOKEN) {
    headers.set("authorization", `Bearer ${env.TMDB_ACCESS_TOKEN}`);
  }

  return headers;
}

function applyApiKeyFallback(targetUrl, env) {
  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) {
    targetUrl.searchParams.set("api_key", env.TMDB_API_KEY);
  }
}

async function fetchTmdb(targetUrl, request, env) {
  applyApiKeyFallback(targetUrl, env);

  return fetch(targetUrl, {
    method: request.method,
    headers: buildTmdbHeaders(env),
  });
}

function withResponseHeaders(response, request, env, targetUrl, rateLimitResult) {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request, env);

  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  headers.set("cache-control", `public, max-age=${getCacheTtlSeconds(targetUrl, response.status)}`);
  headers.set("x-streambox-tmdb-proxy", "hit");
  if (rateLimitResult) {
    headers.set("x-ratelimit-limit", String(rateLimitResult.limit));
    headers.set("x-ratelimit-remaining", String(rateLimitResult.remaining));
  }
  headers.delete("set-cookie");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();

    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse(
        { error: "Method not allowed" },
        { status: 405, headers: { ...buildCorsHeaders(request, env), allow: "GET, HEAD, OPTIONS" } }
      );
    }

    if (!env.TMDB_ACCESS_TOKEN && !env.TMDB_API_KEY) {
      return jsonResponse(
        { error: "TMDB proxy is not configured" },
        { status: 500, headers: buildCorsHeaders(request, env) }
      );
    }

    const rateLimitResult = await checkRateLimit(request, env);
    if (!rateLimitResult.allowed) {
      logMetric("tmdb_proxy_rate_limited", {
        method: request.method,
        remaining: rateLimitResult.remaining,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            ...buildCorsHeaders(request, env),
            "retry-after": String(rateLimitResult.retryAfterSeconds),
            "x-ratelimit-limit": String(rateLimitResult.limit),
            "x-ratelimit-remaining": "0",
          },
        }
      );
    }

    const requestUrl = new URL(request.url);
    const targetUrl = buildTmdbUrl(requestUrl);
    if (!targetUrl) {
      logMetric("tmdb_proxy_invalid_path", {
        method: request.method,
        path: requestUrl.pathname,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        { error: "Invalid TMDB path" },
        { status: 400, headers: buildCorsHeaders(request, env) }
      );
    }

    const cache = caches.default;
    const cacheKey = new Request(targetUrl.toString(), { method: request.method });
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      logMetric("tmdb_proxy_response", {
        method: request.method,
        path: targetUrl.pathname,
        status: cachedResponse.status,
        cacheStatus: "hit",
        rateLimitRemaining: rateLimitResult.remaining,
        durationMs: Date.now() - startedAt,
      });
      return withResponseHeaders(cachedResponse, request, env, targetUrl, rateLimitResult);
    }

    try {
      const upstreamResponse = await fetchTmdb(targetUrl, request, env);
      const response = withResponseHeaders(upstreamResponse, request, env, targetUrl, rateLimitResult);
      logMetric("tmdb_proxy_response", {
        method: request.method,
        path: targetUrl.pathname,
        status: upstreamResponse.status,
        cacheStatus: "miss",
        rateLimitRemaining: rateLimitResult.remaining,
        durationMs: Date.now() - startedAt,
      });

      if (request.method === "GET" && upstreamResponse.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (error) {
      logMetric("tmdb_proxy_error", {
        method: request.method,
        path: targetUrl.pathname,
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        { error: "TMDB upstream request failed" },
        { status: 502, headers: buildCorsHeaders(request, env) }
      );
    }
  },
};
