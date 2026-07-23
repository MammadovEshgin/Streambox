// Watch Together — movie-volume ducking, pure logic (no React / native
// imports; see tests/audioDucking.test.ts). While a partner speaks, the film's
// volume ramps down; when they stop, it ramps back. The controller here decides
// WHEN to duck/restore from a stream of audio-level samples; the hook in
// src/hooks/useAudioDucking.ts owns the polling and the actual volume ramps.
//
// The hard problem is movie bleed: with no headphones, the film itself enters
// the mic, reads as "speech", ducks the film, the level drops, the duck
// releases, the film gets loud again — an oscillation loop. Three defences:
// attack/release hysteresis, a minimum duck hold, and an adaptive attack
// threshold that rises when ducks start re-triggering too often.

export type DuckingConfig = {
  // Level (0..1) that counts as speech; must persist for attackSamples ticks.
  attackThreshold: number;
  attackSamples: number;
  // Level below this counts as silence; must persist for releaseMs.
  releaseThreshold: number;
  releaseMs: number;
  // A duck never releases faster than this, however short the utterance.
  minDuckMs: number;
  // Oscillation guard: more than maxDucks duck-starts inside windowMs raises
  // the attack threshold by adaptiveStep (capped at maxAttackThreshold).
  oscillationWindowMs: number;
  oscillationMaxDucks: number;
  adaptiveStep: number;
  maxAttackThreshold: number;
};

export const DEFAULT_DUCKING_CONFIG: DuckingConfig = {
  attackThreshold: 0.1,
  attackSamples: 2,
  releaseThreshold: 0.04,
  releaseMs: 1_000,
  minDuckMs: 1_500,
  oscillationWindowMs: 30_000,
  oscillationMaxDucks: 6,
  adaptiveStep: 0.05,
  maxAttackThreshold: 0.3,
};

// How far the movie drops while someone is talking.
export const DUCK_VOLUME_FACTOR = 0.35;
export const DUCK_RAMP_MS = 150;
export const RESTORE_RAMP_MS = 400;

export type DuckingAction = "duck" | "restore" | null;

export class DuckingController {
  private ducked = false;
  private consecutiveLoud = 0;
  private quietSinceMs: number | null = null;
  private duckedAtMs = 0;
  private duckStarts: number[] = [];
  private attackBoost = 0;

  constructor(private readonly config: DuckingConfig = DEFAULT_DUCKING_CONFIG) {}

  get isDucked(): boolean {
    return this.ducked;
  }

  get effectiveAttackThreshold(): number {
    return Math.min(this.config.maxAttackThreshold, this.config.attackThreshold + this.attackBoost);
  }

  // Feed one level sample; the return value is the transition to perform now.
  sample(level: number, nowMs: number): DuckingAction {
    if (!this.ducked) {
      if (level >= this.effectiveAttackThreshold) {
        this.consecutiveLoud += 1;
        if (this.consecutiveLoud >= this.config.attackSamples) {
          this.ducked = true;
          this.duckedAtMs = nowMs;
          this.quietSinceMs = null;
          this.consecutiveLoud = 0;
          this.registerDuckStart(nowMs);
          return "duck";
        }
      } else {
        this.consecutiveLoud = 0;
      }
      return null;
    }

    if (level >= this.config.releaseThreshold) {
      // Still talking (or the room is loud) — stay ducked.
      this.quietSinceMs = null;
      return null;
    }
    if (this.quietSinceMs == null) this.quietSinceMs = nowMs;
    const heldLongEnough = nowMs - this.duckedAtMs >= this.config.minDuckMs;
    const quietLongEnough = nowMs - this.quietSinceMs >= this.config.releaseMs;
    if (heldLongEnough && quietLongEnough) {
      this.ducked = false;
      this.quietSinceMs = null;
      return "restore";
    }
    return null;
  }

  reset(): void {
    this.ducked = false;
    this.consecutiveLoud = 0;
    this.quietSinceMs = null;
    this.duckStarts = [];
    this.attackBoost = 0;
  }

  private registerDuckStart(nowMs: number): void {
    this.duckStarts = this.duckStarts.filter((t) => nowMs - t < this.config.oscillationWindowMs);
    this.duckStarts.push(nowMs);
    if (this.duckStarts.length > this.config.oscillationMaxDucks) {
      this.attackBoost = Math.min(
        this.attackBoost + this.config.adaptiveStep,
        this.config.maxAttackThreshold - this.config.attackThreshold
      );
    }
  }
}
