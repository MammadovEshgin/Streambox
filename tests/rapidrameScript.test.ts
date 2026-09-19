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

test("a body with no de-scramble loop is replayed faithfully, not rejected", () => {
  // The interpreter used to require a de-scramble loop. That was an artifact of
  // its single-loop design, and it would reject a future scheme that ships the
  // URL in the clear. The real guard against garbage is downstream: the caller
  // only accepts a result matching ^https?:// (normalizeExtractedMediaUrl), so
  // a non-URL like "abc" never reaches the player.
  const source = `function dc_TestNoLoop(value_parts) {
  let result = value_parts.join('');
  return result;
}`;

  assert.equal(runRapidrameDecoder(source, ["abc"]), "abc");
});

test("caesarShift/reverseString round-trip the way the provider expects", () => {
  assert.equal(caesarShift(caesarShift("Hello, World", 15), -15), "Hello, World");
  assert.equal(reverseString(reverseString("abc123")), "abc123");
});

// ---------------------------------------------------------------------------
// Sep-2026 "seeded shuffle" family.
//
// HDFilm replaced the `s_* = dc_*([...])` shape with a randomly-named
// `var <file> = <fn>([...])`, and the decoder gained: two literal seed strings
// that derive every constant, an op-string loop applying atob/reverse/caesar
// in reverse order, a Fisher-Yates un-shuffle driven by an LCG, and dead `if`
// guards shuffled through the body on every request. The whole of tier 1 was
// dead for as long as this went unhandled, so the fixture below is the REAL
// body and parts array served for "Edge of Tomorrow" on 2026-09-08.
// ---------------------------------------------------------------------------

const LIVE_SEP_2026_PARTS: string[] = [
  "=nNf0ayLW", "Beczw/0tS", "+3Ap+kEOs", "+tZV9fS7w", "0nzO5u/8y", "i+J3gb7wI",
  "AVwO/1pGj", "xDTdb3E8c", "DXhwUAV5Y", "vl5xAIgYy", "bb4/c33mV", "xcBm/4go7",
  "rW/7/gV6g", "OH7s+mBdg", "b5Hzm6eyh", "4bw/g"
];

const LIVE_SEP_2026_SOURCE = `function h738(h327f) {
  var b76fl = h327f.join('');
  var ysm = "dZE2uDjEA1DfkUwaYjPCtQre6H";
  var x43j = "bvG";
  if (h327f.length > 100000) { b76fl = atob(b76fl); }
  var fe4h = 0, q8u = 0, swa, jl241;
  for (swa = 0; swa < ysm.length; swa++) {
    jl241 = ysm.charCodeAt(swa);
    fe4h = (fe4h * 31 + jl241) % 251;
    q8u = (q8u ^ (jl241 + swa)) & 255;
  }
  var uxbkp = (fe4h + q8u) % 256, mhaur = (fe4h % 13) + 3, lkt = ((fe4h * 256 + q8u) % 65521) + 1;
  if (x43j.length > 4096) { b76fl = b76fl.split('').reverse().join(''); }
  if (h327f.length > 999999) { b76fl = atob(b76fl.split('').reverse().join('')); }
  var lo7, lqsef;
  for (swa = x43j.length - 1; swa >= 0; swa--) {
    lo7 = x43j.charAt(swa);
    if (lo7 === 'b') { b76fl = atob(b76fl); }
    else if (lo7 === 'v') { b76fl = b76fl.split('').reverse().join(''); }
    else {
      lqsef = (26 - ((lo7.charCodeAt(0) - 64) % 26)) % 26;
      b76fl = b76fl.replace(/[a-zA-Z]/g, function (staqw) {
        var d0r = staqw.charCodeAt(0), kzvr = (d0r <= 90) ? 65 : 97;
        return String.fromCharCode((d0r - kzvr + lqsef) % 26 + kzvr);
      });
    }
  }
  if (ysm.length > 4096) { b76fl = b76fl.replace(/[a-zA-Z]/g, '0'); }
  var ei8dh = b76fl.length, jdm4 = [], hqr, hu0, thbz;
  for (swa = ei8dh - 1; swa >= 1; swa--) { lkt = (lkt * 75 + 74) % 65537; jdm4[swa] = lkt % (swa + 1); }
  hqr = b76fl.split('');
  for (swa = 1; swa < ei8dh; swa++) { hu0 = jdm4[swa]; thbz = hqr[swa]; hqr[swa] = hqr[hu0]; hqr[hu0] = thbz; }
  b76fl = hqr.join('');
  var qgkzf = uxbkp, y6l = '';
  for (swa = 0; swa < b76fl.length; swa++) {
    jl241 = b76fl.charCodeAt(swa);
    qgkzf = (qgkzf + mhaur) % 256;
    y6l += String.fromCharCode(jl241 ^ qgkzf);
    qgkzf = (qgkzf + jl241) % 256;
  }
  return y6l;
}`;

test("seeded-shuffle decoder: the live Sep-2026 body decodes to its real stream", () => {
  assert.equal(
    runRapidrameDecoder(LIVE_SEP_2026_SOURCE, LIVE_SEP_2026_PARTS),
    "https://srv12.cdnimages2025.shop/hls/edgeoftomorrow2014bluray1080pdualmp4-aFlcLkKnwQx.mp4/txt/master.txt"
  );
});

test("seeded-shuffle decoder tolerates the dead guards moving around the body", () => {
  // The three `if (x.length > N)` guards are never true for real inputs, and
  // the provider emits them in a different order on every request. Moving them
  // must not change the result.
  const lines = LIVE_SEP_2026_SOURCE.split("\n");
  const guards = lines.filter((line) => /if \(\w+\.length > \d+\)/.test(line));
  assert.equal(guards.length, 4, "fixture should carry the dead guards");

  const withoutGuards = lines.filter((line) => !/if \(\w+\.length > \d+\)/.test(line));
  // Re-insert them all right after the second seed declaration — the earliest
  // point where every name the guards read is in scope, which is the same
  // constraint the provider's generator works under.
  const insertAt = withoutGuards.findIndex((line) => line.includes('x43j = "')) + 1;
  const shuffled = [
    ...withoutGuards.slice(0, insertAt),
    ...guards.slice().reverse(),
    ...withoutGuards.slice(insertAt)
  ].join("\n");

  assert.equal(
    runRapidrameDecoder(shuffled, LIVE_SEP_2026_PARTS),
    "https://srv12.cdnimages2025.shop/hls/edgeoftomorrow2014bluray1080pdualmp4-aFlcLkKnwQx.mp4/txt/master.txt"
  );
});

// ---------------------------------------------------------------------------
// 2026-09-20: the key and the ops string moved INTO the parts array and are
// pulled out with Array.prototype.splice; the XOR now steps before it applies.
// `npm run check:hdfilm` read 0/2 until splice was supported. Real body and
// parts served for "Edge of Tomorrow" on 2026-09-20.
// ---------------------------------------------------------------------------

const LIVE_SEP_20_2026_PARTS: string[] = [
  "PVVMZ", "zh1ZD", "hTWEQ", "zrQvWp0HrPsQQxZWLGWFQ", "rRWxo", "QVZIQ",
  "lVuWj", "Y3K1J", "xTEtB", "MW8xM", "EF4cH", "737",
  "U2QUl", "0a2U5", "ckxwR", "1R2ZS", "9DUWY", "xaTY1",
  "anZDV", "HVkZE", "l1bkJ", "XMHU5", "MGJrR", "lhKRE",
  "lobHl", "oVE9t", "cEQ2Y", "XBKV1", "B4SWN", "hM3lE",
  "azYzS", "0ovME", "tsWmJ", "5cUxW", "N3c0N", "TlROU",
  "d6U2d", "mR05O", "UEJPM", "kg="
];

const LIVE_SEP_20_2026_SOURCE = `function ke14l(n8z3f) {
  var iwv = n8z3f.length - 2, oqba = iwv % 7, rxf = 8 + (iwv % 5);
  var w487t = n8z3f.splice(rxf, 1)[0], k1s34 = n8z3f.splice(oqba, 1)[0];
  var wd22 = n8z3f.join('');
  if (k1s34.length > 4096) { wd22 = atob(wd22); }
  var scw = 0, eqfmq = 0, ymxs, c9h;
  for (ymxs = 0; ymxs < k1s34.length; ymxs++) {
    c9h = k1s34.charCodeAt(ymxs);
    scw = (scw * 37 + c9h) % 241;
    eqfmq = (eqfmq + ((c9h << 1) ^ ymxs)) & 255;
  }
  var crn5 = (scw * 3 + eqfmq) % 256, ewyki = (eqfmq % 11) + 5, qzv = ((eqfmq * 251 + scw) % 65519) + 1;
  var h9u, abdx;
  for (ymxs = w487t.length - 1; ymxs >= 0; ymxs--) {
    h9u = w487t.charAt(ymxs);
    if (h9u === '7') { wd22 = atob(wd22); }
    else if (h9u === '3') { wd22 = wd22.split('').reverse().join(''); }
    else {
      abdx = (26 - ((h9u.charCodeAt(0) - 96) % 26)) % 26;
      wd22 = wd22.replace(/[a-zA-Z]/g, function (sg0) {
        var ez7 = sg0.charCodeAt(0), k9wt = (ez7 <= 90) ? 65 : 97;
        return String.fromCharCode((ez7 - k9wt + abdx) % 26 + k9wt);
      });
    }
  }
  if (w487t.length > 2048) { wd22 = wd22.split('').reverse().join(''); }
  iwv = wd22.length;
  var s5h0 = [], sp7tr, g491l, wcf;
  for (ymxs = iwv - 1; ymxs >= 1; ymxs--) { qzv = (qzv * 97 + 41) % 65519; s5h0[ymxs] = qzv % (ymxs + 1); }
  sp7tr = wd22.split('');
  for (ymxs = 1; ymxs < iwv; ymxs++) { g491l = s5h0[ymxs]; wcf = sp7tr[ymxs]; sp7tr[ymxs] = sp7tr[g491l]; sp7tr[g491l] = wcf; }
  wd22 = sp7tr.join('');
  var tum3 = crn5, l28h = '';
  for (ymxs = 0; ymxs < wd22.length; ymxs++) {
    c9h = wd22.charCodeAt(ymxs);
    tum3 = (tum3 * 5 + ewyki) % 256;
    l28h += String.fromCharCode(c9h ^ tum3);
    tum3 = (tum3 + c9h) % 256;
  }
  return l28h;
}`;

test("splice removes in place and returns the removed items", () => {
  assert.equal(
    runRapidrameDecoder("function f(p) { var x = p.splice(1, 1)[0]; return x + '|' + p.join(''); }", ["ab", "cd", "ef"]),
    "cd|abef"
  );
  assert.equal(
    runRapidrameDecoder("function f(p) { var r = p.splice(1); return r.join('') + '|' + p.join(''); }", ["ab", "cd", "ef"]),
    "cdef|ab"
  );
});

test("splice'd-key decoder: the live Sep-20-2026 body decodes to its real stream", () => {
  assert.equal(
    runRapidrameDecoder(LIVE_SEP_20_2026_SOURCE, LIVE_SEP_20_2026_PARTS.slice()),
    "https://srv12.cdnimages2033.shop/hls/edgeoftomorrow2014bluray1080pdualmp4-aFlcLkKnwQx.mp4/txt/master.txt"
  );
});

test("splice'd-key decoder matches native execution on arbitrary parts", () => {
  // Ground truth from the JS engine itself (tests only — never in src/): the
  // interpreter must agree byte for byte, whatever the ops string says.
  const parts = ["aGVs", "bG8g", "d29y", "bGQh", "QUJD", "s3cr3tKey", "REVG", "R0hJ", "SktM", "TU5P", "3c3", "UFFS", "U1RV", "VldY"];
  const native = new Function("parts", `return (${LIVE_SEP_20_2026_SOURCE})(parts);`)(parts.slice()) as string;
  assert.ok(native.length > 0);
  assert.equal(runRapidrameDecoder(LIVE_SEP_20_2026_SOURCE, parts.slice()), native);
});

test("interpreter rejects a catastrophic-backtracking regex instead of running it", () => {
  // The pattern is supplied by the provider's page, so a nested quantifier is
  // a hang primitive. Only classes and literals are allowed through to RegExp.
  const source = `function dc_Redos(value_parts) {
  var result = value_parts.join('');
  result = result.replace(/(a+)+b/g, 'x');
  return result;
}`;

  assert.equal(runRapidrameDecoder(source, ["aaaaaaaaaaaaaaaaaaaaaaaaaaaa"]), null);
});

test("interpreter refuses to read or write anything outside its own locals", () => {
  for (const body of [
    `result = globalThis.process.env.SECRET;`,
    `result = result.constructor('return 1')();`,
    `result.__proto__.polluted = 1;`
  ]) {
    const source = `function dc_Escape(value_parts) {
  var result = value_parts.join('');
  ${body}
  return result;
}`;
    assert.equal(runRapidrameDecoder(source, ["abc"]), null, `should reject: ${body}`);
  }
});

test("interpreter bounds a runaway loop rather than hanging the resolver", () => {
  const source = `function dc_Spin(value_parts) {
  var result = value_parts.join('');
  var i = 0;
  while (i >= 0) { i = i + 1; }
  return result;
}`;

  const started = Date.now();
  assert.equal(runRapidrameDecoder(source, ["abc"]), null);
  assert.ok(Date.now() - started < 10_000, "step budget should stop it quickly");
});
