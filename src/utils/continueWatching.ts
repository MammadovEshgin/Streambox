import type { MediaType } from "../api/tmdb";

// ---------------------------------------------------------------------------
// Continue-watching rules (pure logic — no React Native imports, see tests).
//
// Product rules:
// - Exactly one movie slot and one series slot. A new qualifying title
//   replaces whatever occupied its slot.
// - A title only EARNS a slot after the user actually watches it for
//   CONTINUE_WATCHING_MIN_WATCH_SECONDS of real playback time. Seeking to
//   minute 50 does not count — only the playhead advancing at playback speed
//   accumulates watch time (see accumulateWatchedDelta).
// - Once a slot is owned by a title, later sessions of that same title update
//   the saved position freely (no re-earning), but never with a position
//   below CONTINUE_WATCHING_MIN_POSITION_SECONDS — this keeps an accidental
//   "start over" tap from wiping a deep position within the first seconds.
// - Reaching CONTINUE_WATCHING_COMPLETION_RATIO of the runtime counts as
//   finished: the slot is cleared instead of saving a resume point inside
//   the credits. For series, finishing ANY episode of a show invalidates an
//   older saved episode of that show.
// ---------------------------------------------------------------------------

export const CONTINUE_WATCHING_MIN_WATCH_SECONDS = 120;
export const CONTINUE_WATCHING_MIN_POSITION_SECONDS = 30;
export const CONTINUE_WATCHING_COMPLETION_RATIO = 0.95;
export const CONTINUE_WATCHING_RESUME_REWIND_SECONDS = 10;
// timeUpdate ticks arrive ~1/s during playback; a gap beyond this is a seek
// (or a stream swap) and must not count as watched time.
export const CONTINUE_WATCHING_MAX_TICK_GAP_SECONDS = 3;
export const CONTINUE_WATCHING_SAVE_INTERVAL_MS = 15_000;

export type ContinueWatchingTarget = {
  mediaType: MediaType;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
};

export type ContinueWatchingEntry = ContinueWatchingTarget & {
  title: string;
  positionSeconds: number;
  durationSeconds: number; // 0 when the stream never reported a duration
  updatedAt: number;
  // Launch metadata captured from the player's route params so the
  // continue-watching card can reopen the exact same playback request
  // (title/year/imdbId feed the provider match scoring).
  originalTitle?: string;
  imdbId?: string | null;
  year?: string | null;
  castNames?: string[];
};

export type ContinueWatchingState = {
  version: 1;
  movie?: ContinueWatchingEntry;
  series?: ContinueWatchingEntry;
};

export type PlaybackSnapshot = ContinueWatchingTarget & {
  title: string;
  positionSeconds: number;
  durationSeconds: number;
  /** Real playback seconds accumulated this session (not wall clock, not seeks). */
  watchedSeconds: number;
  now?: number;
  originalTitle?: string;
  imdbId?: string | null;
  year?: string | null;
  castNames?: string[];
};

export function createEmptyContinueWatchingState(): ContinueWatchingState {
  return { version: 1 };
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidEntry(value: unknown): value is ContinueWatchingEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ContinueWatchingEntry>;
  if (entry.mediaType !== "movie" && entry.mediaType !== "tv") return false;
  if (typeof entry.tmdbId !== "number" || !Number.isFinite(entry.tmdbId) || entry.tmdbId <= 0) return false;
  if (typeof entry.title !== "string" || entry.title.length === 0) return false;
  if (!isFiniteNonNegative(entry.positionSeconds)) return false;
  if (!isFiniteNonNegative(entry.durationSeconds)) return false;
  if (!isFiniteNonNegative(entry.updatedAt)) return false;
  if (entry.seasonNumber !== undefined && !isFiniteNonNegative(entry.seasonNumber)) return false;
  if (entry.episodeNumber !== undefined && !isFiniteNonNegative(entry.episodeNumber)) return false;
  // Launch metadata is optional and only informative — tolerate any absence,
  // but reject wrong types so a corrupt entry can't reach the player request.
  if (entry.originalTitle !== undefined && typeof entry.originalTitle !== "string") return false;
  if (entry.imdbId !== undefined && entry.imdbId !== null && typeof entry.imdbId !== "string") return false;
  if (entry.year !== undefined && entry.year !== null && typeof entry.year !== "string") return false;
  if (entry.castNames !== undefined && (!Array.isArray(entry.castNames) || entry.castNames.some((name) => typeof name !== "string"))) return false;
  return true;
}

/** Safe parse of the persisted state; any corruption degrades to an empty state. */
export function parseContinueWatchingState(raw: string | null): ContinueWatchingState {
  if (!raw) return createEmptyContinueWatchingState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyContinueWatchingState();
  }
  if (!parsed || typeof parsed !== "object") return createEmptyContinueWatchingState();

  const candidate = parsed as { movie?: unknown; series?: unknown };
  const state = createEmptyContinueWatchingState();
  if (isValidEntry(candidate.movie) && candidate.movie.mediaType === "movie") {
    state.movie = candidate.movie;
  }
  if (isValidEntry(candidate.series) && candidate.series.mediaType === "tv") {
    state.series = candidate.series;
  }
  return state;
}

/**
 * Watched-time delta between two consecutive playback ticks. Returns 0 for
 * pauses/stalls (no movement), backward jumps and forward jumps larger than
 * a playback tick could produce (seeks, stream swaps).
 */
export function accumulateWatchedDelta(
  previousPositionSeconds: number | null,
  nextPositionSeconds: number
): number {
  if (previousPositionSeconds === null) return 0;
  if (!Number.isFinite(previousPositionSeconds) || !Number.isFinite(nextPositionSeconds)) return 0;
  const delta = nextPositionSeconds - previousPositionSeconds;
  if (delta <= 0 || delta > CONTINUE_WATCHING_MAX_TICK_GAP_SECONDS) return 0;
  return delta;
}

function slotKeyFor(mediaType: MediaType): "movie" | "series" {
  return mediaType === "movie" ? "movie" : "series";
}

export function isSameContinueWatchingTarget(
  entry: ContinueWatchingTarget,
  target: ContinueWatchingTarget
): boolean {
  if (entry.mediaType !== target.mediaType || entry.tmdbId !== target.tmdbId) return false;
  if (target.mediaType === "tv") {
    return (
      (entry.seasonNumber ?? null) === (target.seasonNumber ?? null) &&
      (entry.episodeNumber ?? null) === (target.episodeNumber ?? null)
    );
  }
  return true;
}

function isCompleted(positionSeconds: number, durationSeconds: number): boolean {
  return durationSeconds > 0 && positionSeconds / durationSeconds >= CONTINUE_WATCHING_COMPLETION_RATIO;
}

/**
 * Fold one playback snapshot into the persisted state. Returns the same state
 * reference with `changed: false` when nothing needs writing.
 */
export function applyPlaybackSnapshot(
  state: ContinueWatchingState,
  snapshot: PlaybackSnapshot
): { state: ContinueWatchingState; changed: boolean } {
  const position = isFiniteNonNegative(snapshot.positionSeconds) ? snapshot.positionSeconds : 0;
  const duration = isFiniteNonNegative(snapshot.durationSeconds) ? snapshot.durationSeconds : 0;

  if (isCompleted(position, duration)) {
    return clearFinishedTarget(state, snapshot);
  }

  if (position < CONTINUE_WATCHING_MIN_POSITION_SECONDS) return { state, changed: false };

  const slotKey = slotKeyFor(snapshot.mediaType);
  const slot = state[slotKey];
  const ownsSlot = slot ? isSameContinueWatchingTarget(slot, snapshot) : false;
  const earnedSlot = snapshot.watchedSeconds >= CONTINUE_WATCHING_MIN_WATCH_SECONDS;
  if (!ownsSlot && !earnedSlot) return { state, changed: false };

  const entry: ContinueWatchingEntry = {
    mediaType: snapshot.mediaType,
    tmdbId: snapshot.tmdbId,
    seasonNumber: snapshot.seasonNumber,
    episodeNumber: snapshot.episodeNumber,
    title: snapshot.title,
    positionSeconds: Math.round(position),
    durationSeconds: Math.round(duration),
    updatedAt: snapshot.now ?? Date.now(),
    originalTitle: snapshot.originalTitle,
    imdbId: snapshot.imdbId,
    year: snapshot.year,
    castNames: snapshot.castNames,
  };
  return { state: { ...state, [slotKey]: entry }, changed: true };
}

/**
 * Remove the slot owned by a title the user just finished. Series match by
 * show (any episode), so finishing S1E5 also drops a stale S1E4 resume point.
 */
export function clearFinishedTarget(
  state: ContinueWatchingState,
  target: ContinueWatchingTarget
): { state: ContinueWatchingState; changed: boolean } {
  const slotKey = slotKeyFor(target.mediaType);
  const slot = state[slotKey];
  if (!slot || slot.mediaType !== target.mediaType || slot.tmdbId !== target.tmdbId) {
    return { state, changed: false };
  }
  const next: ContinueWatchingState = { ...state };
  delete next[slotKey];
  return { state: next, changed: true };
}

/**
 * Whatever the slot for this media kind currently holds, if it is worth
 * resuming — drives the continue-watching card on the hub screens.
 */
export function getResumableSlotEntry(
  state: ContinueWatchingState,
  mediaType: MediaType
): ContinueWatchingEntry | null {
  const slot = state[slotKeyFor(mediaType)];
  if (!slot) return null;
  if (slot.positionSeconds < CONTINUE_WATCHING_MIN_POSITION_SECONDS) return null;
  if (isCompleted(slot.positionSeconds, slot.durationSeconds)) return null;
  return slot;
}

/** The saved entry to offer a resume prompt for, or null. Exact-episode match for series. */
export function findResumeEntry(
  state: ContinueWatchingState,
  target: ContinueWatchingTarget
): ContinueWatchingEntry | null {
  const slot = state[slotKeyFor(target.mediaType)];
  if (!slot || !isSameContinueWatchingTarget(slot, target)) return null;
  if (slot.positionSeconds < CONTINUE_WATCHING_MIN_POSITION_SECONDS) return null;
  if (isCompleted(slot.positionSeconds, slot.durationSeconds)) return null;
  return slot;
}

/** Resume slightly before the saved position so the user gets context back. */
export function getResumePositionSeconds(entry: ContinueWatchingEntry): number {
  return Math.max(0, entry.positionSeconds - CONTINUE_WATCHING_RESUME_REWIND_SECONDS);
}

/** 65 → "1:05", 3725 → "1:02:05" — for the resume prompt. */
export function formatPlaybackTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
