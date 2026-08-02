import assert from "node:assert/strict";
import test from "node:test";

import { caesarShift, reverseString, runRapidrameDecoder } from "../src/services/rapidrameScript";

// ---------------------------------------------------------------------------
// The decoder interpreter replays the live dc_*() body HDFilm ships with each
// embed. These tests encode BOTH de-scramble families seen in production (the
// legacy arithmetic unmix and the Aug-2026 rolling-XOR cipher) plus the
// randomized pre-passes, so a regression here surfaces as a red test instead
// of as "every HDFilm title silently plays from Dizibal in Turkish".
//
// Each test builds a payload by running the provider's ENCODE direction, then
// asserts the interpreter recovers the original URL from the decoder source.
// ---------------------------------------------------------------------------

const URL = "https://srv12.cdnimages1001.shop/hls/thedrama-2026-webmp4-4ERtVegpNs2.mp4/txt/master.txt";

function encodeBase64Binary(value: string): string {
  return Buffer.from(value, "latin1").toString("base64");
}

/** Inverse of the rolling-XOR loop: acc advances off the CIPHER byte. */
function scrambleRollingXor(plain: string, seed: number, step: number): string {
  let acc = seed;
  let out = "";
  for (let i = 0; i < plain.length; i += 1) {
    acc = (acc + step) % 256;
    const cipher = plain.charCodeAt(i) ^ acc;
    acc = (acc + cipher) % 256;
    out += String.fromCharCode(cipher);
  }
  return out;
}

/** Inverse of the legacy arithmetic unmix. */
function scrambleModular(plain: string, constant: number, offset: number): string {
  let out = "";
  for (let i = 0; i < plain.length; i += 1) {
    out += String.fromCharCode((plain.charCodeAt(i) + (constant % (i + offset))) % 256);
  }
  return out;
}

const CAESAR_SOURCE = (shift: number) => `
  result = result.replace(/[a-zA-Z]/g, function(c) {
    var o = c.charCodeAt(0), base = (o <= 90) ? 65 : 97;
    return String.fromCharCode((o - base + ${shift}) % 26 + base);
  });`;

const REVERSE_SOURCE = `\n  result = result.split('').reverse().join('');`;
const ATOB_SOURCE = `\n  result = atob(result);`;

function rollingXorDecoder(preSource: string, seed: number, step: number): string {
  return `function dc_TestXor(value_parts) {
  // parçaları birleştir
  let value = value_parts.join('');
  let result = value;${preSource}
  var acc = ${seed};
  let unmix = '';
  for (let i = 0; i < result.length; i++) {
    var b = result.charCodeAt(i);
    acc = (acc + ${step}) % 256;
    var plain = b ^ acc;
    acc = (acc + b) % 256;
    unmix += String.fromCharCode(plain);
  }
  return unmix;
}`;
}

/** Split a payload the way the provider chunks it into the s_* parts array. */
function chunk(value: string, size = 11): string[] {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += size) parts.push(value.slice(i, i + size));
  return parts;
}

test("rolling-XOR decoder (current scheme): reverse → base64 → unmix", () => {
  const scrambled = scrambleRollingXor(URL, 162, 17);
  const payload = reverseString(encodeBase64Binary(scrambled));
  const source = rollingXorDecoder(`${REVERSE_SOURCE}${ATOB_SOURCE}`, 162, 17);

  assert.equal(runRapidrameDecoder(source, chunk(payload)), URL);
});

test("rolling-XOR decoder survives triple base64 with no reverse", () => {
  const scrambled = scrambleRollingXor(URL, 14, 17);
  const payload = encodeBase64Binary(encodeBase64Binary(encodeBase64Binary(scrambled)));
  const source = rollingXorDecoder(`${ATOB_SOURCE}${ATOB_SOURCE}${ATOB_SOURCE}`, 14, 17);

  assert.equal(runRapidrameDecoder(source, chunk(payload)), URL);
});

test("rolling-XOR decoder applies caesar passes in source order", () => {
  // Live shape: reverse → caesar(+15) → base64 → unmix. The decoder shifts
  // FORWARD by 15, so the payload must be built with the inverse shift.
  const scrambled = scrambleRollingXor(URL, 139, 8);
  const payload = reverseString(caesarShift(encodeBase64Binary(scrambled), -15));
  const source = rollingXorDecoder(`${REVERSE_SOURCE}${CAESAR_SOURCE(15)}${ATOB_SOURCE}`, 139, 8);

  assert.equal(runRapidrameDecoder(source, chunk(payload)), URL);
});

test("rolling-XOR decoder handles three chained caesar passes between base64s", () => {
  const scrambled = scrambleRollingXor(URL, 248, 20);
  const inner = encodeBase64Binary(scrambled);
  // decode order: reverse → atob → caesar(14) → caesar(23) → caesar(2) → atob
  const afterCaesars = caesarShift(caesarShift(caesarShift(inner, -2), -23), -14);
  const payload = reverseString(encodeBase64Binary(afterCaesars));
  const source = rollingXorDecoder(
    `${REVERSE_SOURCE}${ATOB_SOURCE}${CAESAR_SOURCE(14)}${CAESAR_SOURCE(23)}${CAESAR_SOURCE(2)}${ATOB_SOURCE}`,
    248,
    20
  );

  assert.equal(runRapidrameDecoder(source, chunk(payload)), URL);
});

test("legacy arithmetic unmix still decodes (older embeds are still served)", () => {
  const scrambled = scrambleModular(URL, 3708627584, 10);
  const payload = reverseString(encodeBase64Binary(scrambled));
  const source = `function dc_TestMod(value_parts) {
  let value = value_parts.join('');
  let result = value;${REVERSE_SOURCE}${ATOB_SOURCE}
  let unmix = '';
  for (let i = 0; i < result.length; i++) {
    var nextCode = (result.charCodeAt(i) - (3708627584 % (i + 10)) + 256) % 256;
    unmix += String.fromCharCode(nextCode);
  }
  return unmix;
}`;

  assert.equal(runRapidrameDecoder(source, chunk(payload)), URL);
});

test("decoder fails closed on an unsupported body instead of returning garbage", () => {
  // `fetch(...)` is outside the supported subset — the caller must be able to
  // fall back to the static schemes rather than play a bogus URL.
  const source = `function dc_TestBad(value_parts) {
  let result = value_parts.join('');
  result = fetch('/steal?' + result);
  let unmix = '';
  for (let i = 0; i < result.length; i++) {
    unmix += String.fromCharCode(result.charCodeAt(i));
  }
  return unmix;
}`;

  assert.equal(runRapidrameDecoder(source, ["abc"]), null);
});

test("decoder rejects a body with no de-scramble loop", () => {
  const source = `function dc_TestNoLoop(value_parts) {
  let result = value_parts.join('');
  return result;
}`;

  assert.equal(runRapidrameDecoder(source, ["abc"]), null);
});

test("caesarShift/reverseString round-trip the way the provider expects", () => {
  assert.equal(caesarShift(caesarShift("Hello, World", 15), -15), "Hello, World");
  assert.equal(reverseString(reverseString("abc123")), "abc123");
});
