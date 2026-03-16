import assert from "node:assert/strict";
import test from "node:test";

import { getAlternateTmdbAuthMode, resolveTmdbAuth } from "../src/api/tmdbAuth";

test("prefers API key when both API key and bearer token exist", () => {
  const resolved = resolveTmdbAuth("api-key-123", "token-xyz");
  assert.equal(resolved.mode, "api_key");
  assert.equal(resolved.apiKeyParam, "api-key-123");
  assert.equal(resolved.bearerToken, "token-xyz");
});

test("uses bearer token when API key is missing", () => {
  const resolved = resolveTmdbAuth(undefined, "token-xyz");
  assert.equal(resolved.mode, "bearer");
  assert.equal(resolved.bearerToken, "token-xyz");
  assert.equal(resolved.apiKeyParam, undefined);
});

test("returns none when credentials are empty", () => {
  const resolved = resolveTmdbAuth("   ", "   ");
  assert.equal(resolved.mode, "none");
  assert.equal(resolved.apiKeyParam, undefined);
  assert.equal(resolved.bearerToken, undefined);
});

test("trims credential values", () => {
  const resolved = resolveTmdbAuth("  key-trim  ", "  token-trim  ");
  assert.equal(resolved.mode, "api_key");
  assert.equal(resolved.apiKeyParam, "key-trim");
});

test("alternate auth mode switches api_key -> bearer when both are available", () => {
  const resolved = resolveTmdbAuth("key-a", "token-b");
  const alternate = getAlternateTmdbAuthMode("api_key", resolved);
  assert.equal(alternate, "bearer");
});

test("alternate auth mode switches bearer -> api_key when both are available", () => {
  const resolved = resolveTmdbAuth("key-a", "token-b");
  const alternate = getAlternateTmdbAuthMode("bearer", resolved);
  assert.equal(alternate, "api_key");
});

test("alternate auth mode is null when no fallback exists", () => {
  const resolved = resolveTmdbAuth("key-a", undefined);
  const alternate = getAlternateTmdbAuthMode("api_key", resolved);
  assert.equal(alternate, null);
});
