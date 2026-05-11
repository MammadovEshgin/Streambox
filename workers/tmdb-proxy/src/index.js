const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60 * 6;
const SEARCH_CACHE_TTL_SECONDS = 60 * 5;
const ERROR_CACHE_TTL_SECONDS = 30;

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
    cf: {
      cacheEverything: true,
      cacheTtl: getCacheTtlSeconds(targetUrl, 200),
    },
  });
}

function withResponseHeaders(response, request, env, targetUrl) {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request, env);

  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  headers.set("cache-control", `public, max-age=${getCacheTtlSeconds(targetUrl, response.status)}`);
  headers.set("x-streambox-tmdb-proxy", "hit");
  headers.delete("set-cookie");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
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

    const requestUrl = new URL(request.url);
    const targetUrl = buildTmdbUrl(requestUrl);
    if (!targetUrl) {
      return jsonResponse(
        { error: "Invalid TMDB path" },
        { status: 400, headers: buildCorsHeaders(request, env) }
      );
    }

    const cache = caches.default;
    const cacheKey = new Request(targetUrl.toString(), { method: request.method });
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return withResponseHeaders(cachedResponse, request, env, targetUrl);
    }

    try {
      const upstreamResponse = await fetchTmdb(targetUrl, request, env);
      const response = withResponseHeaders(upstreamResponse, request, env, targetUrl);

      if (request.method === "GET" && upstreamResponse.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch {
      return jsonResponse(
        { error: "TMDB upstream request failed" },
        { status: 502, headers: buildCorsHeaders(request, env) }
      );
    }
  },
};
