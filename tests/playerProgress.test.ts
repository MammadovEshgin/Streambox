import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_ADVANCE_COUNTDOWN_SECONDS,
  AUTO_MARK_WATCHED_MIN_ENGAGED_SECONDS,
  type NextEpisodeCountdownState,
  createNextEpisodeCountdownState,
  isNextEpisodePillVisible,
  nextEpisodeCountdownReducer,
  shouldAutoMarkWatched,
  shouldShowNextEpisode,
} from "../src/utils/playerProgress";

// ── shouldAutoMarkWatched ──────────────────────────────────────────────────
test("auto-mark: 95% progress with >=2min engagement marks watched", () => {
  assert.ok(
    shouldAutoMarkWatched({ positionSeconds: 6840, durationSeconds: 7200, engagedSeconds: 300 })
  );
  // Exactly at both thresholds.
  assert.ok(
    shouldAutoMarkWatched({
      positionSeconds: 0.95 * 7200,
      durationSeconds: 7200,
      engagedSeconds: AUTO_MARK_WATCHED_MIN_ENGAGED_SECONDS,
    })
  );
});

test("auto-mark: seeking to the end with little engagement does NOT mark", () => {
  // 110/120min position but only 30s of real watching (below the 60s floor).
  assert.ok(
    !shouldAutoMarkWatched({ positionSeconds: 6600, durationSeconds: 7200, engagedSeconds: 30 })
  );
  // Just under the 1-minute floor still does not mark.
  assert.ok(
    !shouldAutoMarkWatched({ positionSeconds: 7200, durationSeconds: 7200, engagedSeconds: 59 })
  );
});

test("auto-mark: watching 1min then seeking to the end DOES mark", () => {
  assert.ok(
    shouldAutoMarkWatched({ positionSeconds: 7200, durationSeconds: 7200, engagedSeconds: 60 })
  );
});

test("auto-mark: below 95% never marks even with heavy engagement", () => {
  assert.ok(
    !shouldAutoMarkWatched({ positionSeconds: 6000, durationSeconds: 7200, engagedSeconds: 6000 })
  );
});

test("auto-mark: position past duration still marks (engaged)", () => {
  assert.ok(
    shouldAutoMarkWatched({ positionSeconds: 7300, durationSeconds: 7200, engagedSeconds: 200 })
  );
});

test("auto-mark: unknown / zero / NaN duration never marks", () => {
  for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(
      !shouldAutoMarkWatched({ positionSeconds: 9999, durationSeconds, engagedSeconds: 9999 }),
      `duration=${durationSeconds}`
    );
  }
});

test("auto-mark: NaN engagement / negative position guarded", () => {
  assert.ok(
    !shouldAutoMarkWatched({ positionSeconds: 7000, durationSeconds: 7200, engagedSeconds: Number.NaN })
  );
  assert.ok(
    !shouldAutoMarkWatched({ positionSeconds: -5, durationSeconds: 7200, engagedSeconds: 300 })
  );
});

// ── shouldShowNextEpisode ──────────────────────────────────────────────────
test("next-episode pill shows within the last 60s", () => {
  assert.ok(shouldShowNextEpisode({ positionSeconds: 2750, durationSeconds: 2800 })); // 50s left
  assert.ok(!shouldShowNextEpisode({ positionSeconds: 2680, durationSeconds: 2800 })); // 120s left, 95.7%
});

test("next-episode pill shows past 97% even with >60s left", () => {
  // 10000s runtime: 97.5% => 250s remaining (>60s) but progress triggers.
  assert.ok(shouldShowNextEpisode({ positionSeconds: 9750, durationSeconds: 10000 }));
  // Just under 97% with plenty of time left does not trigger.
  assert.ok(!shouldShowNextEpisode({ positionSeconds: 9690, durationSeconds: 10000 })); // 96.9%, 310s left
});

test("next-episode: non-finite / zero duration never shows", () => {
  for (const durationSeconds of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(!shouldShowNextEpisode({ positionSeconds: 100, durationSeconds }), `dur=${durationSeconds}`);
  }
});

// ── nextEpisodeCountdownReducer ────────────────────────────────────────────
function drive(
  actions: Parameters<typeof nextEpisodeCountdownReducer>[1][],
  initial: NextEpisodeCountdownState = createNextEpisodeCountdownState()
): NextEpisodeCountdownState {
  return actions.reduce((state, action) => nextEpisodeCountdownReducer(state, action), initial);
}

test("countdown: auto-play show starts counting from the full countdown", () => {
  const state = nextEpisodeCountdownReducer(createNextEpisodeCountdownState(), {
    type: "show",
    autoPlay: true,
  });
  assert.equal(state.phase, "counting");
  assert.equal(state.secondsLeft, AUTO_ADVANCE_COUNTDOWN_SECONDS);
  assert.ok(isNextEpisodePillVisible(state));
});

test("countdown: manual (auto-play off) shows a prompt, no countdown progress", () => {
  const state = drive([
    { type: "show", autoPlay: false },
    { type: "tick" }, // tick is a no-op while in 'prompt'
    { type: "tick" },
  ]);
  assert.equal(state.phase, "prompt");
  assert.equal(state.secondsLeft, AUTO_ADVANCE_COUNTDOWN_SECONDS);
});

test("countdown: ticking to zero fires exactly once", () => {
  let state = nextEpisodeCountdownReducer(createNextEpisodeCountdownState(), {
    type: "show",
    autoPlay: true,
  });
  for (let i = 0; i < AUTO_ADVANCE_COUNTDOWN_SECONDS; i += 1) {
    state = nextEpisodeCountdownReducer(state, { type: "tick" });
  }
  assert.equal(state.phase, "fired");
  assert.equal(state.secondsLeft, 0);
  // Further ticks / shows stay fired (idempotent switch).
  assert.equal(nextEpisodeCountdownReducer(state, { type: "tick" }).phase, "fired");
  assert.equal(nextEpisodeCountdownReducer(state, { type: "show", autoPlay: true }).phase, "fired");
});

test("countdown: cancel stops the countdown and a repeat show does not restart it", () => {
  const cancelled = drive([
    { type: "show", autoPlay: true },
    { type: "tick" },
    { type: "cancel" },
    { type: "show", autoPlay: true }, // must NOT restart
    { type: "tick" },
  ]);
  assert.equal(cancelled.phase, "cancelled");
  assert.ok(isNextEpisodePillVisible(cancelled));
});

test("countdown: seeking back out of the zone hides and forgets a prior cancel", () => {
  const afterHide = drive([
    { type: "show", autoPlay: true },
    { type: "cancel" },
    { type: "hide" },
  ]);
  assert.equal(afterHide.phase, "hidden");
  assert.ok(!isNextEpisodePillVisible(afterHide));
  // Re-entering the zone can now prompt again.
  const reshown = nextEpisodeCountdownReducer(afterHide, { type: "show", autoPlay: true });
  assert.equal(reshown.phase, "counting");
});

test("countdown: reset returns to the initial hidden state", () => {
  const state = drive([{ type: "show", autoPlay: true }, { type: "tick" }, { type: "reset" }]);
  assert.deepEqual(state, createNextEpisodeCountdownState());
});

test("countdown: hide after fired keeps fired (switch already committed)", () => {
  let state = nextEpisodeCountdownReducer(createNextEpisodeCountdownState(), {
    type: "show",
    autoPlay: true,
  });
  for (let i = 0; i < AUTO_ADVANCE_COUNTDOWN_SECONDS; i += 1) {
    state = nextEpisodeCountdownReducer(state, { type: "tick" });
  }
  assert.equal(nextEpisodeCountdownReducer(state, { type: "hide" }).phase, "fired");
});
