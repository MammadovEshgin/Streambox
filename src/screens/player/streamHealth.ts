/**
 * streamHealth
 *
 * Decisions for a native stream that has started and then stops moving. Pure,
 * so the player's rules can be tested without a player.
 *
 * Provider CDNs freeze mid-film without reporting an error: the connection
 * stays open, no bytes arrive, and the player buffers for ever. HDFilm's own
 * web player carries a 5s "position has not moved" watchdog for exactly this
 * (it reloads the source and seeks back), and re-issues the link once its
 * lifetime is over. The native player had neither: it only recovered when
 * ExoPlayer reported an error, so a silent freeze was a spinner until the
 * viewer gave up (Past Lives, 2026-11-19).
 */

/** No progress for this long, when there should be some, is a freeze, not a slow patch. */
export const STREAM_FREEZE_MS = 20_000;
/** How often the player is sampled. */
export const STREAM_HEALTH_SAMPLE_MS = 2_000;
/**
 * In-place recoveries are budgeted so a dead stream cannot loop for ever. The
 * budget refills once playback has gone this long without needing one — a
 * two-hour film is allowed more than three hiccups.
 */
export const RECOVERY_BUDGET_RESET_MS = 120_000;
/** A fresh link is asked for at most once per this window. */
export const STREAM_REFRESH_MIN_INTERVAL_MS = 60_000;
/** Seconds of movement that count as progress (timestamps jitter while stalled). */
const PROGRESS_EPSILON_SECONDS = 0.25;

export type StallWatch = { position: number; since: number };

export type StreamSample = {
  /** Playback position in seconds. */
  position: number;
  /**
   * The position ought to be advancing: the player is waiting for data
   * (expo-video's `loading` status) or says it is playing. False when paused
   * on data it already has, or ended.
   */
  expectingProgress: boolean;
  now: number;
};

/**
 * Feed one sample; get the watch to carry to the next sample and whether the
 * stream is frozen. Progress, and a player that is not expected to make any
 * (paused with data in hand, ended), reset the watch.
 */
export function nextStallWatch(
  previous: StallWatch | null,
  sample: StreamSample,
  freezeMs: number = STREAM_FREEZE_MS
): { watch: StallWatch | null; frozen: boolean } {
  if (!sample.expectingProgress || !Number.isFinite(sample.position)) return { watch: null, frozen: false };
  if (!previous || Math.abs(sample.position - previous.position) > PROGRESS_EPSILON_SECONDS) {
    return { watch: { position: sample.position, since: sample.now }, frozen: false };
  }
  return { watch: previous, frozen: sample.now - previous.since >= freezeMs };
}

/**
 * Whether a stream link has outlived itself. HDFilm's links carry their issue
 * time and lifetime as `s` and `e` (seconds); past `s + e` every request is a
 * 403, and reloading the same link can never work. Links without both
 * parameters are never reported expired.
 */
export function isStreamLinkExpired(streamUrl: string | null | undefined, now: number = Date.now()): boolean {
  if (!streamUrl) return false;
  try {
    const params = new URL(streamUrl).searchParams;
    const issuedAt = Number(params.get("s"));
    const lifetime = Number(params.get("e"));
    if (!Number.isFinite(issuedAt) || !Number.isFinite(lifetime) || issuedAt <= 0 || lifetime <= 0) return false;
    return now / 1000 > issuedAt + lifetime;
  } catch {
    return false;
  }
}

export type RecoveryState = {
  /** In-place reloads used in the current budget window. */
  attempts: number;
  /** When the last recovery of either kind started (0 = never). */
  lastRecoveryAt: number;
  /** When a fresh link was last asked for (0 = never). */
  lastRefreshAt: number;
};

export type RecoveryStep =
  /** Re-open the same link at the position it stopped on. */
  | "reload"
  /** Resolve the title again for a new link, and resume at the position. */
  | "refresh"
  /** Out of options for now. */
  | "none";

/**
 * What to do about a stream that errored or froze. Reload in place while the
 * budget lasts; when it is spent, or the link itself has expired, ask for a
 * fresh link — but not more than once a minute, so a title that cannot be
 * re-resolved does not hammer the provider.
 */
export function planStreamRecovery(
  state: RecoveryState,
  options: { linkExpired: boolean; maxAttempts: number; now: number }
): { step: RecoveryStep; state: RecoveryState } {
  const { now, maxAttempts, linkExpired } = options;
  const rested = state.lastRecoveryAt > 0 && now - state.lastRecoveryAt > RECOVERY_BUDGET_RESET_MS;
  const attempts = rested ? 0 : state.attempts;

  if (!linkExpired && attempts < maxAttempts) {
    return { step: "reload", state: { ...state, attempts: attempts + 1, lastRecoveryAt: now } };
  }
  const refreshAllowed = state.lastRefreshAt === 0 || now - state.lastRefreshAt > STREAM_REFRESH_MIN_INTERVAL_MS;
  if (refreshAllowed) {
    // A new link starts with a clean budget.
    return { step: "refresh", state: { attempts: 0, lastRecoveryAt: now, lastRefreshAt: now } };
  }
  return { step: "none", state: { ...state, attempts } };
}
