import assert from "node:assert/strict";
import test from "node:test";

import worker from "../workers/turn-credentials/src/index.js";

// Executable test of the TURN Worker's auth gate. Every rejection happens
// before the Cloudflare TURN API call, so only the pass case stubs fetch.

type WorkerEnv = Record<string, string>;
const turnWorker = worker as { fetch(request: Request, env: WorkerEnv): Promise<Response> };

const SECRET = "test-secret-not-real";

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signHs256(
  payload: Record<string, unknown>,
  secret = SECRET,
  alg = "HS256"
): Promise<string> {
  const head = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`))
  );
  return `${head}.${body}.${b64url(sig)}`;
}

const future = Math.floor(Date.now() / 1000) + 3600;

function req(token?: string, headers: Record<string, string> = {}) {
  return new Request("https://turn.example/ice", {
    headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers,
  });
}

const env: WorkerEnv = {
  SUPABASE_JWT_SECRET: SECRET,
  TURN_KEY_ID: "k",
  TURN_KEY_API_TOKEN: "t",
  ALLOWED_ORIGINS: "",
};

test("503 when the JWT secret is not configured (never runs open)", async () => {
  const res = await turnWorker.fetch(req(), { ...env, SUPABASE_JWT_SECRET: "" });
  assert.equal(res.status, 503);
});

test("401 without a token", async () => {
  assert.equal((await turnWorker.fetch(req(), env)).status, 401);
});

test("401 for an anon-role token even when correctly signed", async () => {
  const token = await signHs256({ role: "anon", exp: future });
  assert.equal((await turnWorker.fetch(req(token), env)).status, 401);
});

test("401 for an authenticated token with no sub", async () => {
  const token = await signHs256({ role: "authenticated", exp: future });
  assert.equal((await turnWorker.fetch(req(token), env)).status, 401);
});

test("401 for an expired token", async () => {
  const token = await signHs256({ role: "authenticated", sub: "u1", exp: future - 7200 });
  assert.equal((await turnWorker.fetch(req(token), env)).status, 401);
});

test("401 for a token signed with the wrong secret", async () => {
  const token = await signHs256({ role: "authenticated", sub: "u1", exp: future }, "other");
  assert.equal((await turnWorker.fetch(req(token), env)).status, 401);
});

test("401 for a non-HS256 header", async () => {
  const token = await signHs256({ role: "authenticated", sub: "u1", exp: future }, SECRET, "none");
  assert.equal((await turnWorker.fetch(req(token), env)).status, 401);
});

test("a valid user token passes the gate (reaches the upstream call)", async () => {
  const token = await signHs256({ role: "authenticated", sub: "u1", exp: future });
  const originalFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = (async () => {
    upstreamCalled = true;
    return new Response(
      JSON.stringify({ iceServers: { urls: ["turn:x"], username: "u", credential: "c" } }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    const res = await turnWorker.fetch(req(token), env);
    assert.equal(res.status, 200);
    assert.equal(upstreamCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The live Supabase project signs user tokens with ES256 keys published at its
// JWKS endpoint, so the asymmetric path is what production actually exercises.
const SUPABASE_URL = "https://project.supabase.example";
const esKeyPairPromise = crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);

async function signEs256(payload: Record<string, unknown>, kid = "kid-1"): Promise<string> {
  const { privateKey } = await esKeyPairPromise;
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(`${head}.${body}`)
    )
  );
  return `${head}.${body}.${b64url(sig)}`;
}

async function withStubbedUpstreams<T>(run: (calls: string[]) => Promise<T>): Promise<T> {
  const { publicKey } = await esKeyPairPromise;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "kid-1", alg: "ES256" };
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ iceServers: { urls: ["turn:x"], username: "u", credential: "c" } }),
      { status: 200 }
    );
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const esEnv: WorkerEnv = { ...env, SUPABASE_JWT_SECRET: "", SUPABASE_URL };

test("an ES256 user token verified against the project JWKS passes the gate", async () => {
  const token = await signEs256({ role: "authenticated", sub: "u1", exp: future });
  await withStubbedUpstreams(async (calls) => {
    const res = await turnWorker.fetch(req(token), esEnv);
    assert.equal(res.status, 200);
    assert.ok(calls.some((url) => url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  });
});

test("401 for an ES256 anon-role token, an unknown kid, or a tampered payload", async () => {
  await withStubbedUpstreams(async () => {
    const anon = await signEs256({ role: "anon", exp: future });
    assert.equal((await turnWorker.fetch(req(anon), esEnv)).status, 401);

    const unknownKid = await signEs256({ role: "authenticated", sub: "u1", exp: future }, "kid-x");
    assert.equal((await turnWorker.fetch(req(unknownKid), esEnv)).status, 401);

    const [head, , sig] = (
      await signEs256({ role: "authenticated", sub: "u1", exp: future })
    ).split(".");
    const forgedBody = b64url(JSON.stringify({ role: "authenticated", sub: "admin", exp: future }));
    assert.equal(
      (await turnWorker.fetch(req(`${head}.${forgedBody}.${sig}`), esEnv)).status,
      401
    );
  });
});

test("CORS never reflects an unlisted Origin", async () => {
  const res = await turnWorker.fetch(req(undefined, { origin: "https://evil.example" }), env);
  assert.equal(res.headers.get("access-control-allow-origin"), "null");
  const allowed = await turnWorker.fetch(req(undefined, { origin: "https://ok.example" }), {
    ...env,
    ALLOWED_ORIGINS: "https://ok.example",
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://ok.example");
});
