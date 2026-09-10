import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const monitorSource = fs.readFileSync(
  path.join(process.cwd(), "workers", "provider-monitor", "src", "index.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// The 2026-09-10 false alarm.
//
// Dizipal began serving Cloudflare challenge pages to a fraction of requests.
// The monitor runs every 12 hours and took the first 403 as final, so three
// consecutive runs each caught one and paged "Dizipal is down" for 36 hours —
// while the same Worker egress answered 36/36 clean when re-probed by hand.
//
// Worse, a challenge is served AT the requested host, so nothing redirects and
// `compareOrigins` sees no rotation. Dizipal had in fact rotated 2127 → 2130
// underneath, and the 403 hid the only fact that needed acting on.
// ---------------------------------------------------------------------------

test("a challenged request is retried before the endpoint is called down", () => {
  assert.match(monitorSource, /const CHALLENGE_RETRIES = \d+;/);
  assert.match(monitorSource, /function isChallengeResponse\(response, body\)/);

  // The retry must wrap BOTH the fetch and the body read — a challenge is only
  // recognisable from the body, so re-reading a kept response proves nothing.
  const loopStart = monitorSource.indexOf("for (let attempt = 0; attempt <= CHALLENGE_RETRIES; attempt++)");
  assert.notEqual(loopStart, -1, "the retry loop should exist");
  const loopBody = monitorSource.slice(loopStart, monitorSource.indexOf("const validatorResult", loopStart));
  assert.ok(loopBody.includes("await fetchWithTimeout("), "the fetch must be inside the retry loop");
  assert.ok(loopBody.includes("await readLimitedText(response)"), "the body read must be inside the retry loop");
  assert.ok(loopBody.includes("if (!isChallengeResponse(response, body)) break;"), "a clean response must exit early");
});

test("only a genuine interstitial is retried, not any 403", () => {
  const start = monitorSource.indexOf("function isChallengeResponse");
  const fn = monitorSource.slice(start, monitorSource.indexOf("}", start) + 1);
  // A bare status check would retry real permission failures three times and
  // triple the run's latency for nothing.
  assert.ok(fn.includes("looksLikeChallengePage(body)"), "the body must be inspected, not just the status");
  assert.ok(fn.includes("403") && fn.includes("503"), "both interstitial statuses count");
});

test("a rotation is reported even when the check itself fails", () => {
  assert.match(monitorSource, /const rotationNote = rotation\.rotated/);
  const start = monitorSource.indexOf("const reason = !transport");
  assert.notEqual(start, -1, "the reason ternary should exist");
  const branch = monitorSource.slice(start, start + 260);
  assert.ok(
    branch.includes("rotationNote ? `${failureReason}"),
    "a failing check must still carry the rotation note — that is how 2127 → 2130 stayed hidden"
  );
});

test("the monitor still refuses to probe HDFilm, and says why in current terms", () => {
  assert.equal(monitorSource.includes("hdfilmcehennemi.nl"), true);
  // The workflow this used to point at was deleted; GitHub runners are
  // datacenter IPs and are challenged exactly like Worker egress.
  assert.equal(
    monitorSource.includes(".github/workflows/provider-health.yml"),
    false,
    "the comment must not point at a workflow that no longer exists and must never exist"
  );
  assert.match(monitorSource, /check:hdfilm/);
  assert.match(monitorSource, /player_resolve/);
});

test("no HDFilm host is ever fetched from the Worker", () => {
  // Everything the monitor fetches is built from a provider baseUrl; the only
  // hdfilm mention allowed is prose inside a comment block.
  const withoutComments = monitorSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/hdfilm/i.test(withoutComments), false);
});
