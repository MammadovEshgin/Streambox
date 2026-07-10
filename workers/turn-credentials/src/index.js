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
//   SUPABASE_JWT_SECRET  — (optional) the Supabase project's legacy HS256 JWT
//                          secret (dashboard → Settings → API). When set, the
//                          worker only mints credentials for requests carrying
//                          a valid signed-in user token — relay bandwidth is
//                          billed, so an open endpoint is a cost hole. When
//                          unset, behaves as before (open) so the client can
//                          ship the Authorization header ahead of the redeploy.
// Vars (wrangler.jsonc):
//   ALLOWED_ORIGINS      — comma list; empty = allow any
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
  const allowAny = configured.length === 0;
  const allowedOrigin = allowAny || (origin && configured.includes(origin))
    ? origin || "*"
    : configured[0] || "*";
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

// Verifies a Supabase HS256 access token: signature against the project JWT
// secret + expiry. Returns true only for a live, correctly-signed token.
async function verifySupabaseJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signatureB64),
      encoder.encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
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

    // Auth gate — only enforced once the secret exists, so the client and the
    // worker can be rolled out independently.
    if (env.SUPABASE_JWT_SECRET) {
      const auth = request.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!token || !(await verifySupabaseJwt(token, env.SUPABASE_JWT_SECRET))) {
        logMetric("unauthorized");
        return jsonResponse({ error: "unauthorized" }, { status: 401 }, cors);
      }
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
