import assert from "node:assert/strict";
import test from "node:test";

import { LruMap } from "../src/utils/LruMap";

test("LruMap behaves like a Map within capacity", () => {
  const m = new LruMap<string, number>(3);
  m.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(m.size, 3);
  assert.equal(m.get("a"), 1);
  assert.equal(m.has("b"), true);
  assert.equal(m.get("missing"), undefined);
});

test("LruMap evicts the oldest entry when capacity is exceeded", () => {
  const m = new LruMap<string, number>(2);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3); // evicts "a"
  assert.equal(m.has("a"), false);
  assert.equal(m.has("b"), true);
  assert.equal(m.has("c"), true);
  assert.equal(m.size, 2);
});

test("LruMap get() marks a key as recently used, sparing it from eviction", () => {
  const m = new LruMap<string, number>(2);
  m.set("a", 1);
  m.set("b", 2);
  // Touch "a" so "b" is now the oldest.
  assert.equal(m.get("a"), 1);
  m.set("c", 3); // should evict "b", not "a"
  assert.equal(m.has("a"), true);
  assert.equal(m.has("b"), false);
  assert.equal(m.has("c"), true);
});

test("LruMap re-setting an existing key refreshes recency without growing size", () => {
  const m = new LruMap<string, number>(2);
  m.set("a", 1);
  m.set("b", 2);
  m.set("a", 11); // refresh "a", now "b" is oldest
  assert.equal(m.size, 2);
  m.set("c", 3); // evicts "b"
  assert.equal(m.get("a"), 11);
  assert.equal(m.has("b"), false);
  assert.equal(m.has("c"), true);
});

test("LruMap supports negative caching (null values via has/get)", () => {
  const m = new LruMap<string, string | null>(2);
  m.set("x", null);
  assert.equal(m.has("x"), true);
  assert.equal(m.get("x") ?? "fallback", "fallback");
});

test("LruMap rejects invalid capacity", () => {
  assert.throws(() => new LruMap<string, number>(0));
  assert.throws(() => new LruMap<string, number>(-5));
  assert.throws(() => new LruMap<string, number>(1.5));
});
