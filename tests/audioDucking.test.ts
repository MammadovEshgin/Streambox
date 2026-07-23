import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_DUCKING_CONFIG, DuckingController } from "../src/utils/audioDucking";

// Sample cadence used by the hook.
const TICK = 200;

function feed(controller: DuckingController, levels: number[], startMs = 0): Array<"duck" | "restore" | null> {
  return levels.map((level, i) => controller.sample(level, startMs + i * TICK));
}

test("ducks only after sustained speech, not a single spike", () => {
  const c = new DuckingController();
  // One loud sample then silence → no duck (a door slam is not a sentence).
  assert.deepEqual(feed(c, [0.5, 0.0, 0.0]), [null, null, null]);
  assert.equal(c.isDucked, false);
  // Two consecutive loud samples → duck fires on the second.
  assert.deepEqual(feed(c, [0.5, 0.5], 10_000), [null, "duck"]);
  assert.equal(c.isDucked, true);
});

test("holds the duck through the minimum window even if speech stops instantly", () => {
  const c = new DuckingController();
  c.sample(0.5, 0);
  assert.equal(c.sample(0.5, TICK), "duck");
  // Immediate silence: releaseMs (1s) passes, but minDuckMs (1.5s) has not.
  let action: string | null = null;
  for (let t = TICK * 2; t <= 1_400; t += TICK) action = c.sample(0.0, t);
  assert.equal(action, null);
  assert.equal(c.isDucked, true);
  // Past both windows → restore.
  assert.equal(c.sample(0.0, 2_600), "restore");
  assert.equal(c.isDucked, false);
});

test("keeps the duck alive while the speaker is still talking", () => {
  const c = new DuckingController();
  c.sample(0.5, 0);
  c.sample(0.5, TICK);
  // Continuous speech far beyond both windows — never restores.
  for (let t = TICK * 2; t <= 10_000; t += TICK) {
    assert.equal(c.sample(0.3, t), null);
  }
  assert.equal(c.isDucked, true);
});

test("re-triggering ducks raise the attack threshold (movie-bleed oscillation guard)", () => {
  const c = new DuckingController();
  const base = DEFAULT_DUCKING_CONFIG.attackThreshold;
  assert.equal(c.effectiveAttackThreshold, base);

  // Simulate 7 duck/restore cycles inside the 30s window.
  let t = 0;
  for (let cycle = 0; cycle < 7; cycle += 1) {
    c.sample(0.5, t);
    c.sample(0.5, (t += TICK));
    assert.equal(c.isDucked, true);
    t += 2_000; // silence long enough to restore
    c.sample(0.0, t);
    c.sample(0.0, (t += 1_200));
    assert.equal(c.isDucked, false);
    t += 300;
  }
  assert.ok(c.effectiveAttackThreshold > base);
  assert.ok(c.effectiveAttackThreshold <= DEFAULT_DUCKING_CONFIG.maxAttackThreshold);
});

test("reset clears state and adaptive boost", () => {
  const c = new DuckingController();
  c.sample(0.5, 0);
  c.sample(0.5, TICK);
  assert.equal(c.isDucked, true);
  c.reset();
  assert.equal(c.isDucked, false);
  assert.equal(c.effectiveAttackThreshold, DEFAULT_DUCKING_CONFIG.attackThreshold);
});
