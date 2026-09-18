import assert from "node:assert/strict";
import test from "node:test";

import monitor from "../workers/provider-monitor/src/index.js";

// ---------------------------------------------------------------------------
// The 2026-09-18 rejected /set_dizipal.
//
// Dizipal rotated 2132 → 2133 and the new host answered the Worker 403 for its
// first minutes. The monitor's rotation alert said "/set_dizipal
// https://dizipal2133.com"; the command re-ran the checks against 2133, got the
// same 403 and refused to save — the bot rejected the exact command it had just
// told the user to send. These drive the real webhook handler end to end.
// ---------------------------------------------------------------------------

const SUPABASE = "https://supabase.test";
const env = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  TELEGRAM_BOT_TOKEN: "bot",
  TELEGRAM_CHAT_ID: "42",
  TELEGRAM_WEBHOOK_SECRET: "hook",
  REQUEST_TIMEOUT_MS: "5000",
  PROVIDER_MONITOR_KV: { get: async () => null, put: async () => {} },
};

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });
const forbidden = () => new Response("<html><title>403 Forbidden</title></html>", { status: 403 });

function healthyDizipal(url: URL): Response {
  if (url.pathname === "/ajax-search") {
    return new Response(JSON.stringify({ success: true, results: [] }), { status: 200 });
  }
  if (url.pathname.startsWith("/bolum/")) {
    const cfg = btoa(JSON.stringify({ v: "https://player.test/e/1", t: "token" }));
    return new Response(`<div id="videoContainer" data-cfg="${cfg}"></div>`, { status: 200 });
  }
  return new Response("<html>home</html>", { status: 200 });
}

/**
 * Stubs `fetch` for one webhook call. `dizipal` answers every request to a
 * dizipal host; returning a 3xx makes a `redirect: "follow"` request land on
 * the Location (as a real fetch would), while `redirect: "manual"` sees the
 * 3xx itself.
 */
async function sendCommand(text: string, configured: string, dizipal: Route) {
  const telegram: string[] = [];
  const patches: Array<Record<string, string>> = [];
  const originalFetch = globalThis.fetch;

  const route = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    if (url.origin === SUPABASE && url.pathname === "/functions/v1/provider-configs") {
      return new Response(JSON.stringify({
        success: true,
        providers: { dizipal: { baseUrl: configured, referer: `${configured}/` } },
      }), { status: 200 });
    }
    if (url.origin === SUPABASE && init.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return new Response("[]", { status: 200 });
    }
    if (url.hostname === "api.telegram.org") {
      telegram.push(JSON.parse(String(init.body)).text);
      return new Response("{}", { status: 200 });
    }
    if (url.hostname.includes("dizibal")) {
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }
    if (url.hostname.includes("dizipal")) {
      let current = url;
      for (let hop = 0; hop < 30; hop++) {
        const response = await dizipal(current, init);
        const location = response.headers.get("location");
        if (init.redirect === "manual" || response.status < 300 || response.status >= 400 || !location) {
          return withUrl(response, current.href);
        }
        current = new URL(location, current);
      }
      throw new Error("redirect loop");
    }
    throw new Error(`unexpected fetch ${input}`);
  };

  globalThis.fetch = ((input: string, init?: RequestInit) => route(String(input), init)) as typeof fetch;
  try {
    const request = new Request("https://monitor.test/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "hook" },
      body: JSON.stringify({ message: { chat: { id: 42 }, text } }),
    });
    const response = await monitor.fetch(request, env);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { telegram, patches };
}

test("the command the rotation alert suggests is saved even while the new host is failing", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2133.com",
    "https://dizipal2132.com",
    (url) => (url.hostname === "dizipal2132.com" ? redirect(`https://dizipal2133.com${url.pathname}`) : forbidden()),
  );

  assert.equal(patches.length, 1, "the Supabase row must be updated");
  assert.equal(patches[0].base_url, "https://dizipal2133.com");
  assert.equal(telegram.length, 1);
  assert.match(telegram[0], /dizipal updated — but it is failing right now/);
  assert.match(telegram[0], /https:\/\/dizipal2132\.com redirects here/);
  // The refusal reason is diagnosable, not a bare status.
  assert.match(telegram[0], /HTTP 403 \(page: "403 Forbidden"\)/);
});

test("the upstream's redirect still vouches for a host that does not answer at all", async () => {
  const { patches } = await sendCommand(
    "/set_dizipal https://dizipal2133.com",
    "https://dizipal2132.com",
    (url) => {
      if (url.hostname === "dizipal2132.com") return redirect(`https://dizipal2133.com${url.pathname}`);
      throw new TypeError("fetch failed");
    },
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].base_url, "https://dizipal2133.com");
});

test("a failing candidate that nothing redirects to is still rejected", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2199.com",
    "https://dizipal2132.com",
    (url) => (url.hostname === "dizipal2132.com" ? redirect(`https://dizipal2133.com${url.pathname}`) : forbidden()),
  );
  assert.equal(patches.length, 0, "a wrong domain must never be written");
  assert.match(telegram[0], /dizipal update rejected/);
});

test("a stale candidate is rejected and the newer head suggested", async () => {
  // Configured 2131 → 2132 → 2133; the user sends 2132, which is itself a hop.
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2132.com",
    "https://dizipal2131.com",
    (url) => {
      if (url.hostname === "dizipal2131.com") return redirect(`https://dizipal2132.com${url.pathname}`);
      if (url.hostname === "dizipal2132.com") return redirect(`https://dizipal2133.com${url.pathname}`);
      return forbidden();
    },
  );
  assert.equal(patches.length, 0);
  assert.match(telegram[0], /Use: {2}\/set_dizipal https:\/\/dizipal2133\.com/);
});

test("a healthy candidate is saved without a warning", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2133.com",
    "https://dizipal2132.com",
    (url) => (url.hostname === "dizipal2132.com" ? redirect(`https://dizipal2133.com${url.pathname}`) : healthyDizipal(url)),
  );
  assert.equal(patches.length, 1);
  assert.match(telegram[0], /dizipal updated successfully/);
  assert.doesNotMatch(telegram[0], /failing right now/);
});

test("a Cloudflare challenge is recognised by its header, not only by English page text", async () => {
  let calls = 0;
  const { patches } = await sendCommand(
    "/set_dizipal https://dizipal2133.com",
    "https://dizipal2133.com",
    (url) => {
      // First home request gets a localised interstitial; the retry is clean.
      if (url.pathname === "/" && calls++ === 0) {
        return new Response("<title>Bir dakika lütfen...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } });
      }
      return healthyDizipal(url);
    },
  );
  assert.equal(patches.length, 1, "one challenged request must not fail validation");
});
