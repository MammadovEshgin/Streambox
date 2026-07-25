import assert from "node:assert/strict";
import test from "node:test";

import {
  USERNAME_CHANGE_COOLDOWN_DAYS,
  canChangeUsername,
  formatHandle,
  isReservedUsername,
  normalizeUsername,
  usernameCooldownRemainingDays,
  usernameCooldownRemainingMs,
  validateUsername,
} from "../src/utils/usernames";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_750_000_000_000;

test("normalizeUsername trims and lowercases", () => {
  assert.equal(normalizeUsername("  EshGin_07 "), "eshgin_07");
  assert.equal(normalizeUsername(""), "");
});

test("validateUsername accepts a valid handle and returns the normalized value", () => {
  const result = validateUsername("  EshGin_07 ");
  assert.deepEqual(result, { valid: true, normalized: "eshgin_07" });
});

test("validateUsername rejects empty / whitespace-only", () => {
  assert.deepEqual(validateUsername("   "), { valid: false, error: "empty" });
});

test("validateUsername enforces length bounds on the normalized value", () => {
  assert.deepEqual(validateUsername("ab"), { valid: false, error: "too_short" });
  assert.deepEqual(validateUsername("a".repeat(21)), { valid: false, error: "too_long" });
  assert.equal(validateUsername("abc").valid, true);
  assert.equal(validateUsername("a".repeat(20)).valid, true);
});

test("validateUsername rejects disallowed characters", () => {
  assert.deepEqual(validateUsername("has space"), { valid: false, error: "invalid_chars" });
  assert.deepEqual(validateUsername("dash-name"), { valid: false, error: "invalid_chars" });
  assert.deepEqual(validateUsername("dot.name"), { valid: false, error: "invalid_chars" });
  assert.deepEqual(validateUsername("emoji😀x"), { valid: false, error: "invalid_chars" });
});

test("validateUsername rejects reserved handles (case-insensitively)", () => {
  assert.deepEqual(validateUsername("Admin"), { valid: false, error: "reserved" });
  assert.deepEqual(validateUsername("streambox"), { valid: false, error: "reserved" });
  assert.ok(isReservedUsername("SUPPORT"));
  assert.ok(!isReservedUsername("eshgin"));
});

test("cooldown: null/undefined/invalid change time means changeable now", () => {
  assert.equal(usernameCooldownRemainingMs(null, NOW), 0);
  assert.equal(usernameCooldownRemainingMs(undefined, NOW), 0);
  assert.equal(usernameCooldownRemainingMs("not-a-date", NOW), 0);
  assert.ok(canChangeUsername(null, NOW));
});

test("cooldown: within 30 days blocks, past 30 days allows", () => {
  const tenDaysAgo = new Date(NOW - 10 * DAY_MS).toISOString();
  const remaining = usernameCooldownRemainingMs(tenDaysAgo, NOW);
  assert.equal(remaining, 20 * DAY_MS);
  assert.ok(!canChangeUsername(tenDaysAgo, NOW));
  assert.equal(usernameCooldownRemainingDays(tenDaysAgo, NOW), 20);

  const overCooldown = new Date(NOW - (USERNAME_CHANGE_COOLDOWN_DAYS + 1) * DAY_MS).toISOString();
  assert.equal(usernameCooldownRemainingMs(overCooldown, NOW), 0);
  assert.ok(canChangeUsername(overCooldown, NOW));
  assert.equal(usernameCooldownRemainingDays(overCooldown, NOW), 0);
});

test("cooldown remaining days rounds up a partial day", () => {
  const changed = new Date(NOW - (USERNAME_CHANGE_COOLDOWN_DAYS - 1) * DAY_MS - 1000).toISOString();
  // Just under 1 day remaining -> rounds up to 1.
  assert.equal(usernameCooldownRemainingDays(changed, NOW), 1);
});

test("formatHandle prefixes @, empty stays empty", () => {
  assert.equal(formatHandle("eshgin"), "@eshgin");
  assert.equal(formatHandle(""), "");
  assert.equal(formatHandle(null), "");
  assert.equal(formatHandle("  "), "");
});
