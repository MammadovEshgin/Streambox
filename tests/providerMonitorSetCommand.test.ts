import assert from "node:assert/strict";
import test from "node:test";

import monitor from "../workers/provider-monitor/src/index.js";

// ---------------------------------------------------------------------------
// The 2026-09-18 rejected /set_dizipal.
//
// Dizipal rotated 2132 → 2133 and the new host (behind DDoS-Guard) answered the
// Worker 403. The monitor's rotation alert said "/set_dizipal
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

// Captured live from dizipal2134 on 2026-09-27: the embed URL AES-256-CBC
// encrypted under k1 XOR k2; decrypts to a formationfeed.net embed.
const LIVE_DIZIPAL_ENC = {
  c: "o5irVx5+DwZCGGsM2PNbCsB0y4akHXfR2VfKykP4JjQ0/w/tb6ae+s9TdUbTixr0tlrHXteInorq/mM/oqtn5w==",
  iv: "s8qim3i9nTgiiChU89Mavg==",
  k1: "ZV4WZlCa1O3ApwvEZgGcd5TrXAgfDdaJAqyJjDw2oZc=",
  k2: "H8RXmPx0JzZo4AyKInxzMeIigcVeL0p6bXevC5oyu4w=",
};
const DIZIPAL_CFG = "808f8efbd4a5820a3d3fde3fb7f9edd8";

/** /ajax-player-config as dizipal2134 answers it: the cfg only on its own session. */
let dizipalPlayerConfig: (init: RequestInit) => Response = (init) => {
  const headers = new Headers(init.headers);
  const valid = String(init.body) === `cfg=${DIZIPAL_CFG}` && headers.get("cookie") === "PHPSESSID=sess1";
  return new Response(
    JSON.stringify(valid
      ? { success: true, config: { v: "", t: "embed", p: "" }, enc: LIVE_DIZIPAL_ENC }
      : { success: false, message: "Invalid token" }),
    { status: 200 },
  );
};

function healthyDizipal(url: URL, init: RequestInit = {}): Response {
  if (url.pathname === "/ajax-search") {
    return new Response(JSON.stringify({ success: true, results: [] }), { status: 200 });
  }
  if (url.pathname === "/ajax-player-config" && init.method === "POST") {
    return dizipalPlayerConfig(init);
  }
  if (url.pathname.startsWith("/bolum/")) {
    return new Response(`<div id="videoContainer" data-cfg="${DIZIPAL_CFG}"></div>`, {
      status: 200,
      headers: { "set-cookie": "PHPSESSID=sess1; path=/; secure; HttpOnly" },
    });
  }
  return new Response("<html>home</html>", { status: 200 });
}

/**
 * Stubs `fetch` for one webhook call. `dizipal` answers every request to a
 * dizipal host; returning a 3xx makes a `redirect: "follow"` request land on
 * the Location (as a real fetch would), while `redirect: "manual"` sees the
 * 3xx itself.
 */
/** DNS-over-HTTPS answer for a host: resolves, or the placeholder SERVFAIL. */
function dohAnswer(url: URL, resolving: string[] | null): Response {
  if (resolving === null) throw new TypeError("fetch failed");
  const name = url.searchParams.get("name") ?? "";
  return new Response(
    JSON.stringify(
      resolving.includes(name)
        ? { Status: 0, Answer: [{ name, type: 1, data: "95.129.238.70" }] }
        : { Status: 2 }
    ),
    { status: 200 }
  );
}

// Dizibal's own origin since its Sept 2026 rebuild, for any datacenter IP.
const dizibalIpBan = () =>
  new Response(
    "<html><title>403 — Erişim Engellendi</title><p>Erişiminiz engellendi. Bu IP adresi güvenlik nedeniyle yasaklanmıştır.</p></html>",
    { status: 403, headers: { server: "cloudflare" } },
  );

// The pilavyer player page Dizibal embeds; it answers the Worker.
let dizibalPlayer: (url: URL, init: RequestInit) => Response = (_url, init) =>
  new Headers(init.headers).get("referer") === "https://dizibal.org/"
    ? new Response(`<script>window.__PLAYER__ = {"v":"b0ef","stream":"https://pilavyerplay.top/api/stream.php?v=b0ef&token=t","subs":[]};</script>`, { status: 200 })
    : new Response("<title>Erişim engellendi</title>", { status: 403 });

const ddosGuardWall = () =>
  new Response("<html><title>Error 403</title><body>DDoS-Guard</body></html>", {
    status: 403,
    headers: { server: "ddos-guard" },
  });

async function sendCommand(text: string, configured: string, dizipal: Route, resolving: string[] | null = null) {
  const request = new Request("https://monitor.test/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "hook" },
    body: JSON.stringify({ message: { chat: { id: 42 }, text } }),
  });
  return callMonitor(request, env, configured, dizipal, resolving);
}

async function callMonitor(
  request: Request,
  monitorEnv: Record<string, unknown>,
  configured: string,
  dizipal: Route,
  resolving: string[] | null
) {
  const telegram: string[] = [];
  const patches: Array<Record<string, string>> = [];
  const originalFetch = globalThis.fetch;

  const route = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    if (url.hostname === "cloudflare-dns.com" || url.hostname === "dns.google") {
      return dohAnswer(url, resolving);
    }
    if (url.origin === SUPABASE && url.pathname === "/functions/v1/provider-configs") {
      return new Response(JSON.stringify({
        success: true,
        providers: {
          dizipal: { baseUrl: configured, referer: `${configured}/` },
          dizibal: { baseUrl: "https://dizibal.org", referer: "https://dizibal.org/" },
        },
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
    if (url.hostname.includes("dizibal")) return dizibalIpBan();
    if (url.hostname === "pilavyerplay.top") return dizibalPlayer(url, init);
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
  let body: any;
  try {
    const response = await monitor.fetch(request, monitorEnv);
    assert.equal(response.status, 200);
    body = await response.json();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { telegram, patches, body };
}

/** A scheduled-style run through `/run`, with KV state carried between calls. */
async function runOnce(configured: string, dizipal: Route, resolving: string[] | null, kv: Map<string, string>) {
  const runEnv = {
    ...env,
    MANUAL_RUN_TOKEN: "run",
    PROVIDER_MONITOR_KV: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => { kv.set(key, value); },
    },
  };
  const request = new Request("https://monitor.test/run", { headers: { "x-monitor-token": "run" } });
  return callMonitor(request, runEnv, configured, dizipal, resolving);
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
    (url, init) => (url.hostname === "dizipal2132.com" ? redirect(`https://dizipal2133.com${url.pathname}`) : healthyDizipal(url, init)),
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
    (url, init) => {
      // First home request gets a localised interstitial; the retry is clean.
      if (url.pathname === "/" && calls++ === 0) {
        return new Response("<title>Bir dakika lütfen...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } });
      }
      return healthyDizipal(url, init);
    },
  );
  assert.equal(patches.length, 1, "one challenged request must not fail validation");
});

// ---------------------------------------------------------------------------
// DDoS-Guard (2026-09-18 onward).
//
// Since 2133, DDoS-Guard answers every request from Cloudflare's network 403,
// so the Worker sees neither the new domain's pages nor the old domain's 301.
// The bot reported a permanent outage and could neither detect the next
// rotation nor accept the /set_dizipal for it. DNS is outside the wall:
// Dizipal's pre-registered future domains SERVFAIL until the day they go live.
// ---------------------------------------------------------------------------

test("a walled candidate that resolves in DNS is saved", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2134.com",
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    ["dizipal2133.com", "dizipal2134.com"],
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].base_url, "https://dizipal2134.com");
  assert.match(telegram[0], /dizipal updated\./);
  assert.match(telegram[0], /resolves in DNS/);
  assert.match(telegram[0], /BLOCKED Dizipal home: 403 \(blocked by DDoS-Guard/);
});

test("a walled candidate that does not resolve is rejected, with the force escape hatch", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2135.com",
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    ["dizipal2133.com"],
  );
  assert.equal(patches.length, 0);
  assert.match(telegram[0], /dizipal update rejected/);
  assert.match(telegram[0], /does not resolve in DNS/);
  assert.match(telegram[0], /\/set_dizipal https:\/\/dizipal2135\.com force/);
});

test("a walled candidate is not saved when DNS cannot be asked", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2134.com",
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    null,
  );
  assert.equal(patches.length, 0);
  assert.match(telegram[0], /DNS could not be checked/);
});

test("a candidate older than the configured domain is rejected even if it resolves", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2132.com",
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    ["dizipal2132.com", "dizipal2133.com"],
  );
  assert.equal(patches.length, 0);
  assert.match(telegram[0], /older than the configured https:\/\/dizipal2133\.com/);
});

test("force saves a candidate the checks cannot confirm", async () => {
  const { telegram, patches } = await sendCommand(
    "/set_dizipal https://dizipal2135.com force",
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    [],
  );
  assert.equal(patches.length, 1);
  assert.equal(patches[0].base_url, "https://dizipal2135.com");
  assert.match(telegram[0], /forced/);
});

test("Dizipal's playback check wants the hex data-cfg token the app posts", async () => {
  // dizipal2134 (2026-09-25): data-cfg is a 32-hex single-use token.
  const healthy = await sendCommand(
    "/set_dizipal https://dizipal2134.com",
    "https://dizipal2133.com",
    healthyDizipal,
  );
  assert.equal(healthy.patches.length, 1);
  assert.match(healthy.telegram[0], /dizipal updated successfully/);

  // Any other shape means the app's player-config exchange no longer fits.
  const cfg = '{&quot;ciphertext&quot;:&quot;abc+/=&quot;,&quot;iv&quot;:&quot;00&quot;,&quot;salt&quot;:&quot;aa&quot;}';
  const changed = await sendCommand(
    "/set_dizipal https://dizipal2134.com",
    "https://dizipal2133.com",
    (url, init) => url.pathname.startsWith("/bolum/")
      ? new Response(`<div id="videoContainer" data-cfg="${cfg}"></div>`, { status: 200 })
      : healthyDizipal(url, init),
  );
  assert.match(changed.telegram[0], /data-cfg is no longer a hex token/);
});

test("Dizipal's playback check posts the cfg on the page's session and decrypts the embed URL", async () => {
  // 2026-09-27: data-cfg kept its hex shape while the player-config answer
  // moved the embed URL into `enc`, and every Dizipal title stopped playing
  // with the monitor green. The check now does the app's exchange.
  const playback = async () => {
    const { body } = await runOnce("https://dizipal2134.com", healthyDizipal, ["dizipal2134.com"], new Map());
    return body.results.find((r: { id: string }) => r.id === "dizipal_playback");
  };
  const healthy = dizipalPlayerConfig;
  try {
    const encrypted = await playback();
    assert.equal(encrypted.ok, true, encrypted.reason);

    dizipalPlayerConfig = () =>
      new Response(JSON.stringify({ success: true, config: { v: "https://formationfeed.net/embed-x.html", t: "embed" } }), { status: 200 });
    assert.equal((await playback()).ok, true, "a clear config.v still counts");

    dizipalPlayerConfig = () =>
      new Response(JSON.stringify({ success: true, config: { v: "", t: "embed" }, enc: { ...LIVE_DIZIPAL_ENC, k2: LIVE_DIZIPAL_ENC.k1 } }), { status: 200 });
    let result = await playback();
    assert.equal(result.ok, false);
    assert.equal(result.blocked, false);
    assert.match(result.reason, /enc no longer decrypts .* push OTA/);

    dizipalPlayerConfig = () => new Response(JSON.stringify({ success: true, config: { v: "", t: "embed" } }), { status: 200 });
    assert.match((await playback()).reason, /answers no embed URL — push OTA/);

    dizipalPlayerConfig = () => new Response(JSON.stringify({ success: false, message: "Invalid token" }), { status: 200 });
    assert.match((await playback()).reason, /refused the page's cfg: "Invalid token" — push OTA/);

    dizipalPlayerConfig = () => new Response("Not Found", { status: 404 });
    assert.match((await playback()).reason, /endpoint moved \(HTTP 404\) — push OTA/);

    // A wall on the POST alone is `blocked`, never "down".
    dizipalPlayerConfig = () => ddosGuardWall();
    result = await playback();
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.match(result.reason, /blocked by DDoS-Guard — player-config HTTP 403/);
  } finally {
    dizipalPlayerConfig = healthy;
  }
});

test("a run detects the rotation through DNS while the pages are walled, and never pages 'down'", async () => {
  const kv = new Map<string, string>();
  const walled = () => ddosGuardWall();

  // Three runs on 2133 with nothing newer in DNS: walled, not down.
  for (let run = 0; run < 3; run++) {
    const { telegram, body } = await runOnce("https://dizipal2133.com", walled, ["dizipal2133.com"], kv);
    assert.equal(telegram.some((text) => /is down/.test(text)), false, "a walled check must never page 'down'");
    const domain = body.results.find((r: { id: string }) => r.id === "dizipal_domain");
    assert.equal(domain.ok, true);
    if (run === 0) {
      assert.equal(telegram.filter((text) => /can't see these checks/.test(text)).length, 1, "the wall is reported once, merged");
    } else {
      assert.equal(telegram.some((text) => /can't see these checks/.test(text)), false, "and only once");
    }
  }
  const state = JSON.parse(kv.get("provider-monitor-state-v1")!);
  assert.equal(state.checks.dizipal_home.status, "blocked");

  // 2134 goes live.
  const { telegram, body } = await runOnce("https://dizipal2133.com", walled, ["dizipal2133.com", "dizipal2134.com"], kv);
  const domain = body.results.find((r: { id: string }) => r.id === "dizipal_domain");
  assert.equal(domain.rotated, true);
  assert.equal(domain.latestBaseUrl, "https://dizipal2134.com");
  const alert = telegram.find((text) => /rotated/.test(text));
  assert.ok(alert, "the rotation must be alerted");
  assert.match(alert!, /\/set_dizipal https:\/\/dizipal2134\.com/);

  // The same rotation is not re-alerted on the next run.
  const again = await runOnce("https://dizipal2133.com", walled, ["dizipal2133.com", "dizipal2134.com"], kv);
  assert.equal(again.telegram.some((text) => /rotated/.test(text)), false);
});

test("a skipped suffix is still found, and the newest live domain wins", async () => {
  const kv = new Map<string, string>();
  const { body } = await runOnce(
    "https://dizipal2133.com",
    () => ddosGuardWall(),
    ["dizipal2133.com", "dizipal2134.com", "dizipal2136.com"],
    kv,
  );
  const domain = body.results.find((r: { id: string }) => r.id === "dizipal_domain");
  assert.equal(domain.latestBaseUrl, "https://dizipal2136.com");
});

test("a configured domain that stops resolving with nothing newer counts towards down", async () => {
  const kv = new Map<string, string>();
  let last: Awaited<ReturnType<typeof runOnce>> | null = null;
  for (let run = 0; run < 3; run++) {
    last = await runOnce("https://dizipal2133.com", () => ddosGuardWall(), [], kv);
  }
  assert.ok(last!.telegram.some((text) => /Dizipal domain \(DNS\) failed/.test(text)));
});

test("DNS being unreachable is 'unknown', never 'down' or a rotation", async () => {
  const kv = new Map<string, string>();
  for (let run = 0; run < 3; run++) {
    const { telegram, body } = await runOnce("https://dizipal2133.com", () => ddosGuardWall(), null, kv);
    const domain = body.results.find((r: { id: string }) => r.id === "dizipal_domain");
    assert.equal(domain.blocked, true);
    assert.equal(domain.rotated, false);
    assert.equal(telegram.some((text) => /is down/.test(text)), false);
  }
});

test("/status: Dizibal's IP ban reads as blocked, and its player is still watched", async () => {
  const request = new Request("https://monitor.test/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "hook" },
    body: JSON.stringify({ message: { chat: { id: 42 }, text: "/status" } }),
  });
  const { telegram } = await callMonitor(request, env, "https://dizipal2133.com", () => ddosGuardWall(), ["dizipal2133.com"]);
  const dizibal = telegram[0].slice(telegram[0].indexOf("── dizibal ──"));
  assert.match(dizibal, /BLOCKED Dizibal search: 403 \(blocked by Dizibal's IP ban/);
  assert.match(dizibal, /OK Dizibal player: 200 \(ok\)/);
  assert.match(dizibal, /Up to date\./, "a wall is not a failing check");
  assert.doesNotMatch(dizibal, /FAIL/);
});

test("a Dizibal player that stops carrying a stream is a real failure, not a wall", async () => {
  const healthy = dizibalPlayer;
  dizibalPlayer = () => new Response("<title>Breaking Bad</title><script>window.__PLAYER__ = {\"v\":\"b0ef\"};</script>", { status: 200 });
  try {
    const kv = new Map<string, string>();
    const { body } = await runOnce("https://dizipal2133.com", () => ddosGuardWall(), ["dizipal2133.com"], kv);
    const player = body.results.find((r: { id: string }) => r.id === "dizibal_player");
    assert.equal(player.ok, false);
    assert.equal(player.blocked, false);
    assert.match(player.reason, /push OTA/);
  } finally {
    dizibalPlayer = healthy;
  }
});
