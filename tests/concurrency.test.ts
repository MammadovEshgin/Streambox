import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeInFlight, mapWithConcurrency } from "../src/utils/concurrency";

test("mapWithConcurrency preserves order and caps active tasks", async () => {
  let active = 0;
  let maxActive = 0;

  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30, 40, 50]);
  assert.equal(maxActive, 2);
});

test("dedupeInFlight shares one promise for concurrent identical keys", async () => {
  const registry = new Map<string, Promise<number>>();
  let calls = 0;

  const factory = () =>
    new Promise<number>((resolve) => {
      calls += 1;
      setTimeout(() => resolve(42), 10);
    });

  const [a, b, c] = await Promise.all([
    dedupeInFlight(registry, "k", factory),
    dedupeInFlight(registry, "k", factory),
    dedupeInFlight(registry, "k", factory)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], [42, 42, 42]);
  assert.equal(registry.size, 0); // entry cleared after settle
});

test("dedupeInFlight clears the entry on failure so the next call retries", async () => {
  const registry = new Map<string, Promise<number>>();
  let calls = 0;

  await assert.rejects(
    dedupeInFlight(registry, "k", () => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    })
  );
  assert.equal(registry.size, 0);

  const value = await dedupeInFlight(registry, "k", () => {
    calls += 1;
    return Promise.resolve(7);
  });
  assert.equal(value, 7);
  assert.equal(calls, 2); // failure was not cached
});

test("dedupeInFlight runs distinct keys independently", async () => {
  const registry = new Map<string, Promise<string>>();
  const [a, b] = await Promise.all([
    dedupeInFlight(registry, "a", () => Promise.resolve("A")),
    dedupeInFlight(registry, "b", () => Promise.resolve("B"))
  ]);
  assert.equal(a, "A");
  assert.equal(b, "B");
});
