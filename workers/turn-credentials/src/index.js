// streambox-turn-credentials — mints short-lived Cloudflare Realtime TURN
// credentials for the Watch Together WebRTC layer. WebRTC connects the two
// phones directly whenever possible; a TURN relay is only needed when carrier
// NAT blocks a direct path (common on mobile). Generating ephemeral creds here
// keeps the long-lived TURN Token API secret server-side — the app bundle never
// carries it.
//
// Secrets (set with `wrangler secret put`):
//   TURN_KEY_ID          — Cloudflare Realtime TURN key id
//   TURN_KEY_API_TOKEN   — API token bound to that TURN key
//   SUPABASE_JWT_SECRET  — the Supabase project's legacy HS256 JWT secret
//                          (dashboard → Settings → API), for HS256 user tokens.
// Vars (wrangler.jsonc):
//   SUPABASE_URL         — project URL; ES256/RS256 user tokens (asymmetric
//                          signing keys) are verified against its JWKS.
//   ALLOWED_ORIGINS      — comma list; empty = allow none (the app sends no Origin)
//
// The worker only mints credentials for a live, signed-in user token — relay
// bandwidth is billed, so an open endpoint is a cost hole. With neither
// SUPABASE_JWT_SECRET nor SUPABASE_URL configured it refuses to mint (503).
//   CRED_TTL_SECONDS     — lifetime of the minted credentials

const CF_TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL_SECONDS = 14400; // 4h — comfortably covers a movie
const PUBLIC_STUN = { urls: "stun:stun.l.google.com:19302" };

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({ service: "streambox-turn-credentials", event, ...fields }));
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const configured = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  // Never reflect an arbitrary caller: the mobile app sends no Origin, so an
  // empty list means no browser origin is allowed.
  const allowedOrigin = origin && configured.includes(origin) ? origin : "null";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "vary": "origin",
  };
}

function jsonResponse(body, init = {}, cors = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors,
      ...(init.headers ?? {}),
    },
  });
}

function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
let jwksCache = { url: "", keys: [], fetchedAt: 0 };

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

// Supabase projects on asymmetric signing keys publish their public keys here.
// Cached per isolate; a kid miss forces one refetch so a key rotation is picked up.
async function getJwksKeys(env, forceRefresh = false) {
  const url = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
  const fresh = jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS;
  if (fresh && !forceRefresh) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jwks_http_${res.status}`);
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

async function findJwk(env, header) {
  const pick = (keys) => keys.find((k) => k.kid === header.kid && (!k.alg || k.alg === header.alg));
  return pick(await getJwksKeys(env)) || pick(await getJwksKeys(env, true)) || null;
}

async function verifySignature(header, signingInput, signature, env) {
  if (header.alg === "HS256") {
    if (!env.SUPABASE_JWT_SECRET) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify("HMAC", key, signature, signingInput);
  }
  if ((header.alg === "ES256" || header.alg === "RS256") && env.SUPABASE_URL && header.kid) {
    const jwk = await findJwk(env, header);
    if (!jwk) return false;
    if (header.alg === "ES256") {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signingInput);
    }
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
  }
  // Anything else ("none", HS384, unknown) is rejected outright.
  return false;
}

// Verifies a Supabase access token: HS256 against the project JWT secret, or
// ES256/RS256 against the project's JWKS; then expiry and a signed-in user
// (role authenticated + sub). Returns true only for a live, correctly-signed
// user token.
async function verifySupabaseJwt(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const header = decodeJsonSegment(headerB64);
    if (!header || typeof header.alg !== "string") return false;
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await verifySignature(header, signingInput, base64UrlToBytes(signatureB64), env);
    if (!valid) return false;
    const payload = decodeJsonSegment(payloadB64);
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return false;
    // A signed-in user token, not the project's public anon/service key (those are
    // also JWTs signed by the same project).
    if (payload.role !== "authenticated") return false;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return false;
    return true;
  } catch (error) {
    logMetric("verify_error", { message: String(error && error.message) });
    return false;
  }
}

export default {
  async fetch(request, env) {
    const cors = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "method_not_allowed" }, { status: 405 }, cors);
    }
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      logMetric("misconfigured");
      return jsonResponse({ error: "turn_not_configured" }, { status: 503 }, cors);
    }

    // Auth gate. Relay bandwidth is billed, so the endpoint never runs open:
    // with no way to verify a user token configured it refuses to mint at all.
    if (!env.SUPABASE_JWT_SECRET && !env.SUPABASE_URL) {
      logMetric("misconfigured", { missing: "SUPABASE_JWT_SECRET|SUPABASE_URL" });
      return jsonResponse({ error: "turn_not_configured" }, { status: 503 }, cors);
    }
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !(await verifySupabaseJwt(token, env))) {
      logMetric("unauthorized");
      return jsonResponse({ error: "unauthorized" }, { status: 401 }, cors);
    }

    const ttl = Number(env.CRED_TTL_SECONDS) || DEFAULT_TTL_SECONDS;

    try {
      const cfRes = await fetch(`${CF_TURN_API}/${env.TURN_KEY_ID}/credentials/generate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl }),
      });

      if (!cfRes.ok) {
        logMetric("cf_error", { status: cfRes.status });
        return jsonResponse({ error: "turn_upstream_error" }, { status: 502 }, cors);
      }

      const data = await cfRes.json();
      // Cloudflare returns a single iceServers object (urls[] + username +
      // credential). Hand the client an array plus a public STUN fallback.
      const iceServers = [PUBLIC_STUN];
      if (data && data.iceServers) {
        iceServers.push(data.iceServers);
      }

      logMetric("issued", { ttl });
      return jsonResponse({ iceServers, ttl }, { status: 200 }, cors);
    } catch (error) {
      logMetric("exception", { message: String(error && error.message) });
      return jsonResponse({ error: "turn_exception" }, { status: 500 }, cors);
    }
  },
};
