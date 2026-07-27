// ---------------------------------------------------------------------------
// Player autonomy — pure decision logic (no React Native imports, see
// tests/playerProgress.test.ts).
//
// Two industry-standard client heuristics (Plex/Jellyfin shipped these before
// server-side ML credit-detectors; we don't have content-pipeline access to
// third-party streams, so ML is out of scope — see the prompt's research note):
//   1. Auto-mark-watched at 95% progress, gated by a real-engagement floor so
//      seeking to the end never counts as "watched".
//   2. Next-episode end detection (+ optional auto-advance countdown).
//
// The engagement floor uses REAL accumulated watch time (accumulateWatchedDelta
// semantics in continueWatching.ts) — NOT wall clock and NOT playhead position.
// ---------------------------------------------------------------------------

// ── Auto-mark watched ───────────────────────────────────────────────────────
export const AUTO_MARK_WATCHED_PROGRESS = 0.95;
// Real-engagement floor before a title counts as watched (anti-seek-to-end).
// 60s (1 min) per product decision 2026-07-26.
export const AUTO_MARK_WATCHED_MIN_ENGAGED_SECONDS = 60;

export type AutoMarkWatchedInput = {
  positionSeconds: number;
  durationSeconds: number;
  /** Real playback seconds accumulated this session (not wall clock, not seeks). */
  engagedSeconds: number;
};

/**
 * True when the title should be auto-marked watched: >= 95% of a known duration
 * AND at least 2 minutes of actual watching. Seeking to 110/120min with 30s of
 * real playback must NOT mark watched; watching 2min then seeking to the end
 * MUST. Non-finite / zero / negative duration never marks.
 */
export function shouldAutoMarkWatched(input: AutoMarkWatchedInput): boolean {
  const { positionSeconds, durationSeconds, engagedSeconds } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false;
  if (!Number.isFinite(engagedSeconds) || engagedSeconds < AUTO_MARK_WATCHED_MIN_ENGAGED_SECONDS) {
    return false;
  }
  return positionSeconds / durationSeconds >= AUTO_MARK_WATCHED_PROGRESS;
}

// ── Next-episode end detection ──────────────────────────────────────────────
// Tunable. Whichever fires first shows the card. Reveal within the last 45s or
// at 97% progress (2026-07-26: progress trigger lowered from 98.5% to 97%).
export const NEXT_EPISODE_REMAINING_SECONDS = 45;
export const NEXT_EPISODE_MIN_PROGRESS = 0.97;
export const AUTO_ADVANCE_COUNTDOWN_SECONDS = 10;

export type NextEpisodeInput = {
  positionSeconds: number;
  durationSeconds: number;
};

/**
 * True when the "Next Episode" affordance should appear: within the last 45s OR
 * past 97% progress. Guards non-finite / zero duration (some HLS streams never
 * report one) — no pill without a known duration.
 */
export function shouldShowNextEpisode(input: NextEpisodeInput): boolean {
  const { positionSeconds, durationSeconds } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false;
  const remaining = durationSeconds - positionSeconds;
  const progress = positionSeconds / durationSeconds;
  return remaining <= NEXT_EPISODE_REMAINING_SECONDS || progress >= NEXT_EPISODE_MIN_PROGRESS;
}

// ── Auto-advance countdown reducer ──────────────────────────────────────────
// Drives the pill: hidden -> (prompt | counting) -> fired/cancelled. The player
// component owns the 1s ticks and the actual episode switch; this reducer keeps
// the transition rules pure and unit-tested.
export type NextEpisodeCountdownPhase =
  | "hidden"
  | "prompt" // manual pill visible (auto-play off)
  | "counting" // auto-advance countdown running
  | "cancelled" // user cancelled auto-advance
  | "fired"; // countdown completed -> switch now

export type NextEpisodeCountdownState = {
  phase: NextEpisodeCountdownPhase;
  secondsLeft: number;
};

export type NextEpisodeCountdownAction =
  | { type: "show"; autoPlay: boolean } // end-detection fired
  | { type: "tick" } // 1s elapsed while counting
  | { type: "cancel" } // user tapped Cancel
  | { type: "hide" } // seeked back out of the trigger zone
  | { type: "reset" }; // new episode / player session

export function createNextEpisodeCountdownState(): NextEpisodeCountdownState {
  return { phase: "hidden", secondsLeft: AUTO_ADVANCE_COUNTDOWN_SECONDS };
}

export function nextEpisodeCountdownReducer(
  state: NextEpisodeCountdownState,
  action: NextEpisodeCountdownAction
): NextEpisodeCountdownState {
  switch (action.type) {
    case "reset":
      return createNextEpisodeCountdownState();
    case "hide":
      // Seeking back out of the end zone hides the pill and forgets a prior
      // cancel, so re-entering the zone can prompt again. A completed switch
      // ("fired") is left alone.
      return state.phase === "fired" ? state : createNextEpisodeCountdownState();
    case "show":
      // Once cancelled / counting / fired, a repeated end-detection tick is a
      // no-op — don't restart a countdown the user already dismissed.
      if (state.phase === "cancelled" || state.phase === "counting" || state.phase === "fired") {
        return state;
      }
      return action.autoPlay
        ? { phase: "counting", secondsLeft: AUTO_ADVANCE_COUNTDOWN_SECONDS }
        : { phase: "prompt", secondsLeft: AUTO_ADVANCE_COUNTDOWN_SECONDS };
    case "tick": {
      if (state.phase !== "counting") return state;
      const secondsLeft = state.secondsLeft - 1;
      if (secondsLeft <= 0) return { phase: "fired", secondsLeft: 0 };
      return { phase: "counting", secondsLeft };
    }
    case "cancel":
      if (state.phase === "counting" || state.phase === "prompt") {
        return { phase: "cancelled", secondsLeft: state.secondsLeft };
      }
      return state;
    default:
      return state;
  }
}

/** Should the "Next Episode" pill be visible for this reducer state? */
export function isNextEpisodePillVisible(state: NextEpisodeCountdownState): boolean {
  return state.phase === "prompt" || state.phase === "counting" || state.phase === "cancelled";
}
