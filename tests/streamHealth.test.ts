import assert from "node:assert/strict";
import test from "node:test";

import {
  RECOVERY_BUDGET_RESET_MS,
  STREAM_FREEZE_MS,
  STREAM_REFRESH_MIN_INTERVAL_MS,
  isStreamLinkExpired,
  nextStallWatch,
  planStreamRecovery,
  type RecoveryState,
  type StallWatch,
} from "../src/screens/player/streamHealth";

// ---------------------------------------------------------------------------
// A native stream that started and then stopped moving. Past Lives (HDFilm,
// 2026-11-19) sat on the buffering spinner: the CDN went quiet without an
// error, and nothing in the player watched for that.
// ---------------------------------------------------------------------------

function run(samples: Array<[position: number, expectingProgress: boolean, at: number]>): boolean[] {
  let watch: StallWatch | null = null;
  return samples.map(([position, expectingProgress, now]) => {
    const next = nextStallWatch(watch, { position, expectingProgress, now });
    watch = next.watch;
    return next.frozen;
  });
}

test("no progress for 20s while buffering or playing is a freeze", () => {
  const frozen = run([
    [600, true, 0],
    [600, true, 10_000],
    [600, true, STREAM_FREEZE_MS - 1],
    [600, true, STREAM_FREEZE_MS],
  ]);
  assert.deepEqual(frozen, [false, false, false, true]);
});

test("slow progress and a paused player with data are not freezes", () => {
  // Crawling forward: each bit of progress restarts the clock.
  assert.deepEqual(run([[600, true, 0], [601, true, 15_000], [602, true, 30_000], [603, true, 45_000]]), [false, false, false, false]);
  // Paused on buffered data, the position is not expected to move: the watch resets.
  assert.deepEqual(run([[600, true, 0], [600, false, 15_000], [600, true, 25_000], [600, true, 44_000]]), [false, false, false, false]);
  // A paused film is never a freeze, however long it sits.
  assert.deepEqual(run([[600, false, 0], [600, false, 3_600_000]]), [false, false]);
});

test("timestamp jitter while stalled is not progress", () => {
  assert.deepEqual(run([[600, true, 0], [600.1, true, 10_000], [600.2, true, STREAM_FREEZE_MS]]), [false, false, true]);
});

test("a link is expired once its issue time plus lifetime has passed", () => {
  const link = "https://s429.rapidrame.com/hls2/01/x/master.m3u8?t=abc&s=1795121196&e=14400&f=1";
  const issuedAtMs = 1795121196 * 1000;
  assert.equal(isStreamLinkExpired(link, issuedAtMs + 3_600_000), false, "an hour in");
  assert.equal(isStreamLinkExpired(link, issuedAtMs + 14_400_000 + 1_000), true, "past four hours");
  // Links that do not say are never called expired.
  assert.equal(isStreamLinkExpired("https://imagestoo.com/cdn/hls/x/master.m3u8?md5=a&expires=1", issuedAtMs), false);
  assert.equal(isStreamLinkExpired("not a url"), false);
  assert.equal(isStreamLinkExpired(null), false);
});

const fresh: RecoveryState = { attempts: 0, lastRecoveryAt: 0, lastRefreshAt: 0 };

test("recovery reloads in place while the budget lasts, then asks for a fresh link", () => {
  let state = fresh;
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) {
    const plan = planStreamRecovery(state, { linkExpired: false, maxAttempts: 3, now: 1_000 + i * 5_000 });
    steps.push(plan.step);
    state = plan.state;
  }
  // Three reloads, one fresh link (which resets the budget), then a reload of the new link.
  assert.deepEqual(steps, ["reload", "reload", "reload", "refresh", "reload"]);
});

test("the reload budget refills after two trouble-free minutes", () => {
  let state: RecoveryState = { attempts: 3, lastRecoveryAt: 10_000, lastRefreshAt: 9_000 };
  const soon = planStreamRecovery(state, { linkExpired: false, maxAttempts: 3, now: 20_000 });
  assert.equal(soon.step, "none", "budget spent and a fresh link was asked for seconds ago");

  const later = planStreamRecovery(state, { linkExpired: false, maxAttempts: 3, now: 10_000 + RECOVERY_BUDGET_RESET_MS + 1 });
  assert.equal(later.step, "reload", "the fourth hiccup of a two-hour film is not the end of it");
  assert.equal(later.state.attempts, 1);
  state = later.state;
});

test("an expired link is never reloaded; a fresh one is asked for at most once a minute", () => {
  const first = planStreamRecovery(fresh, { linkExpired: true, maxAttempts: 3, now: 100_000 });
  assert.equal(first.step, "refresh", "reloading an expired link can only 403 again");

  const again = planStreamRecovery(first.state, { linkExpired: true, maxAttempts: 3, now: 100_000 + 5_000 });
  assert.equal(again.step, "none");

  const afterWait = planStreamRecovery(first.state, { linkExpired: true, maxAttempts: 3, now: 100_000 + STREAM_REFRESH_MIN_INTERVAL_MS + 1 });
  assert.equal(afterWait.step, "refresh");
});
