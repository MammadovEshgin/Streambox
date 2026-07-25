// streambox-push-notifications — fan-out for social pushes (runtime 1.3.0).
//
// Wired as a Supabase Database Webhook on INSERT into public.user_notifications.
// On each new notification it reads the recipient's Expo push tokens (service
// role, server-side only) and forwards a push through the Expo Push API. The
// service-role key never leaves the Worker; the app only ever holds the anon
// key. A shared webhook secret gates the endpoint so only Supabase can trigger
// a send.
//
// Secrets (set with `wrangler secret put`):
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (dashboard → Settings
//                               → API). Bypasses RLS to read every recipient's
//                               tokens. NEVER commit or expose to the client.
//   WEBHOOK_SECRET            — shared secret; the Database Webhook must send it
//                               as the `x-streambox-webhook-secret` header.
// Vars (wrangler.jsonc):
//   SUPABASE_URL              — https://<ref>.supabase.co
//   EXPO_PUSH_ENDPOINT        — https://exp.host/--/api/v2/push/send

const DEFAULT_EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "social";

function logMetric(event, fields = {}) {
  console.log(JSON.stringify({ service: "streambox-push-notifications", event, ...fields }));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function actorName(payload) {
  if (payload && typeof payload.displayName === "string" && payload.displayName) return payload.displayName;
  if (payload && typeof payload.username === "string" && payload.username) return `@${payload.username}`;
  return "Someone";
}

// Build the user-facing title/body/data for a notification row.
function buildMessageContent(record) {
  const payload = record.payload || {};
  const name = actorName(payload);
  if (record.type === "watch_invite") {
    const title = typeof payload.title === "string" ? payload.title : "a title";
    return {
      title: "Watch together?",
      body: `${name} wants to watch ${title} with you`,
      data: {
        type: "watch_invite",
        inviteId: payload.inviteId ?? null,
        roomCode: payload.roomCode ?? null,
        actorId: record.actor_id ?? null,
      },
    };
  }
  return {
    title: "New follower",
    body: `${name} started following you`,
    data: { type: "follow", actorId: record.actor_id ?? null },
  };
}

async function fetchPushTokens(env, userId) {
  const url =
    `${env.SUPABASE_URL}/rest/v1/user_push_tokens` +
    `?user_id=eq.${encodeURIComponent(userId)}&select=token,platform`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    logMetric("tokens_fetch_error", { status: res.status });
    return [];
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((row) => row.token).filter(Boolean) : [];
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      logMetric("misconfigured");
      return jsonResponse({ error: "not_configured" }, 503);
    }
    // Gate: only the Supabase Database Webhook (carrying the shared secret) may
    // trigger a send.
    if (env.WEBHOOK_SECRET) {
      const provided = request.headers.get("x-streambox-webhook-secret") || "";
      if (provided !== env.WEBHOOK_SECRET) {
        logMetric("unauthorized");
        return jsonResponse({ error: "unauthorized" }, 401);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "bad_request" }, 400);
    }

    // Supabase webhook shape: { type, table, schema, record, old_record }.
    const record = body && body.record;
    if (!record || !record.user_id || body.type !== "INSERT") {
      return jsonResponse({ ok: true, skipped: true });
    }

    const tokens = await fetchPushTokens(env, record.user_id);
    if (tokens.length === 0) {
      logMetric("no_tokens", { userId: record.user_id });
      return jsonResponse({ ok: true, delivered: 0 });
    }

    const content = buildMessageContent(record);
    const messages = tokens.map((token) => ({
      to: token,
      sound: "default",
      channelId: ANDROID_CHANNEL_ID,
      priority: "high",
      title: content.title,
      body: content.body,
      data: content.data,
    }));

    try {
      const endpoint = env.EXPO_PUSH_ENDPOINT || DEFAULT_EXPO_PUSH_ENDPOINT;
      const pushRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });
      if (!pushRes.ok) {
        logMetric("expo_error", { status: pushRes.status });
        return jsonResponse({ error: "push_upstream_error" }, 502);
      }
      logMetric("delivered", { count: messages.length, type: record.type });
      return jsonResponse({ ok: true, delivered: messages.length });
    } catch (error) {
      logMetric("exception", { message: String(error && error.message) });
      return jsonResponse({ error: "push_exception" }, 500);
    }
  },
};
