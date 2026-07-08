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
// Vars (wrangler.jsonc):
//   ALLOWED_ORIGINS      — comma list; empty = allow any
//   CRED_TTL_SECONDS     — lifetime of the minted credentials

const CF_TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL_SECONDS = 86400;
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
