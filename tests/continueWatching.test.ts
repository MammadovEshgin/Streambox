import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CONTINUE_WATCHING_MIN_POSITION_SECONDS,
  CONTINUE_WATCHING_MIN_WATCH_SECONDS,
  accumulateWatchedDelta,
  applyPlaybackSnapshot,
  clearFinishedTarget,
  createEmptyContinueWatchingState,
  findResumeEntry,
  formatPlaybackTime,
  getResumePositionSeconds,
  parseContinueWatchingState,
  type ContinueWatchingEntry,
  type ContinueWatchingState,
  type PlaybackSnapshot,
} from "../src/utils/continueWatching";

const NOW = 1_750_000_000_000;

function movieSnapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    mediaType: "movie",
    tmdbId: 27205, // Inception
    title: "Inception",
    positionSeconds: 300,
    durationSeconds: 8880,
    watchedSeconds: CONTINUE_WATCHING_MIN_WATCH_SECONDS,
    now: NOW,
    ...overrides,
  };
}

function seriesSnapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    mediaType: "tv",
    tmdbId: 1396, // Breaking Bad
    title: "Breaking Bad",
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 600,
    durationSeconds: 3480,
    watchedSeconds: CONTINUE_WATCHING_MIN_WATCH_SECONDS,
    now: NOW,
    ...overrides,
  };
}

function stateWith(entries: { movie?: ContinueWatchingEntry; series?: ContinueWatchingEntry }): ContinueWatchingState {
  return { version: 1, ...entries };
}

function savedMovie(overrides: Partial<ContinueWatchingEntry> = {}): ContinueWatchingEntry {
  return {
    mediaType: "movie",
    tmdbId: 27205,
    title: "Inception",
    positionSeconds: 300,
    durationSeconds: 8880,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

function savedSeries(overrides: Partial<ContinueWatchingEntry> = {}): ContinueWatchingEntry {
  return {
    mediaType: "tv",
    tmdbId: 1396,
    title: "Breaking Bad",
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 600,
    durationSeconds: 3480,
    updatedAt: NOW - 60_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Persistence parsing — corrupt storage must degrade to an empty state
// ---------------------------------------------------------------------------

test("parse: null, garbage and non-object payloads produce an empty state", () => {
  assert.deepEqual(parseContinueWatchingState(null), { version: 1 });
  assert.deepEqual(parseContinueWatchingState("not json {"), { version: 1 });
  assert.deepEqual(parseContinueWatchingState("42"), { version: 1 });
  assert.deepEqual(parseContinueWatchingState(JSON.stringify(["a"])), { version: 1 });
});

test("parse: valid state round-trips; invalid or slot-mismatched entries are dropped", () => {
  const valid = stateWith({ movie: savedMovie(), series: savedSeries() });
  assert.deepEqual(parseContinueWatchingState(JSON.stringify(valid)), valid);

  // A tv entry in the movie slot (and vice versa) is corrupt — drop it.
  const swapped = { version: 1, movie: savedSeries(), series: savedMovie() };
  assert.deepEqual(parseContinueWatchingState(JSON.stringify(swapped)), { version: 1 });

  const broken = { version: 1, movie: { ...savedMovie(), positionSeconds: "300" } };
  assert.deepEqual(parseContinueWatchingState(JSON.stringify(broken)), { version: 1 });
});

// ---------------------------------------------------------------------------
// Watched-time accumulation — only real playback counts
// ---------------------------------------------------------------------------

test("accumulate: consecutive playback ticks add up, first tick adds nothing", () => {
  assert.equal(accumulateWatchedDelta(null, 12), 0);
  assert.equal(accumulateWatchedDelta(12, 13), 1);
  assert.equal(accumulateWatchedDelta(13, 16), 3); // boundary gap still counts
});

test("accumulate: pauses, seeks and stream swaps add nothing", () => {
  assert.equal(accumulateWatchedDelta(100, 100), 0); // paused
  assert.equal(accumulateWatchedDelta(100, 40), 0); // seek back / stream restart
  assert.equal(accumulateWatchedDelta(100, 400), 0); // seek forward
  assert.equal(accumulateWatchedDelta(100, NaN), 0);
});

// ---------------------------------------------------------------------------
// Earning a slot — the 2-minute real-watch-time rule
// ---------------------------------------------------------------------------

test("a movie below the watch-time threshold is not saved", () => {
  const empty = createEmptyContinueWatchingState();
  const result = applyPlaybackSnapshot(
    empty,
    movieSnapshot({ watchedSeconds: CONTINUE_WATCHING_MIN_WATCH_SECONDS - 1 })
  );
  assert.equal(result.changed, false);
  assert.equal(result.state, empty);
});

test("scrubbing deep into a movie without watching does not save (seek is not watching)", () => {
  const result = applyPlaybackSnapshot(
    createEmptyContinueWatchingState(),
    movieSnapshot({ positionSeconds: 3000, watchedSeconds: 20 })
  );
  assert.equal(result.changed, false);
});

test("a movie crossing the watch-time threshold earns the movie slot", () => {
  const result = applyPlaybackSnapshot(createEmptyContinueWatchingState(), movieSnapshot());
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.movie, {
    mediaType: "movie",
    tmdbId: 27205,
    seasonNumber: undefined,
    episodeNumber: undefined,
    title: "Inception",
    positionSeconds: 300,
    durationSeconds: 8880,
    updatedAt: NOW,
  });
  assert.equal(result.state.series, undefined);
});

test("positions below the save floor never persist, even past the threshold", () => {
  const result = applyPlaybackSnapshot(
    createEmptyContinueWatchingState(),
    movieSnapshot({ positionSeconds: CONTINUE_WATCHING_MIN_POSITION_SECONDS - 1 })
  );
  assert.equal(result.changed, false);
});

// ---------------------------------------------------------------------------
// One slot per kind — the Inception / Breaking Bad / Interstellar scenario
// ---------------------------------------------------------------------------

test("movie and series slots are independent", () => {
  let state = applyPlaybackSnapshot(createEmptyContinueWatchingState(), movieSnapshot()).state;
  state = applyPlaybackSnapshot(state, seriesSnapshot()).state;
  assert.equal(state.movie?.title, "Inception");
  assert.equal(state.series?.title, "Breaking Bad");
});

test("a new qualifying movie replaces the previous one", () => {
  let state = applyPlaybackSnapshot(createEmptyContinueWatchingState(), movieSnapshot()).state;
  state = applyPlaybackSnapshot(
    state,
    movieSnapshot({ tmdbId: 157336, title: "Interstellar", positionSeconds: 600 })
  ).state;
  assert.equal(state.movie?.title, "Interstellar");
  assert.equal(state.movie?.tmdbId, 157336);
});

// ---------------------------------------------------------------------------
// Updating an owned slot — later sessions move the position freely
// ---------------------------------------------------------------------------

test("the owning title updates its position without re-earning the threshold", () => {
  const state = stateWith({ movie: savedMovie({ positionSeconds: 2400 }) });
  const result = applyPlaybackSnapshot(
    state,
    movieSnapshot({ positionSeconds: 2430, watchedSeconds: 25 })
  );
  assert.equal(result.changed, true);
  assert.equal(result.state.movie?.positionSeconds, 2430);
});

test("an accidental restart in the first seconds does not wipe a deep position", () => {
  const state = stateWith({ movie: savedMovie({ positionSeconds: 2400 }) });
  const result = applyPlaybackSnapshot(
    state,
    movieSnapshot({ positionSeconds: 8, watchedSeconds: 8 })
  );
  assert.equal(result.changed, false);
  assert.equal(result.state.movie?.positionSeconds, 2400);
});

// ---------------------------------------------------------------------------
// Series episode semantics
// ---------------------------------------------------------------------------

test("peeking at another episode below the threshold keeps the saved episode", () => {
  const state = stateWith({ series: savedSeries() });
  const result = applyPlaybackSnapshot(
    state,
    seriesSnapshot({ episodeNumber: 2, positionSeconds: 45, watchedSeconds: 45 })
  );
  assert.equal(result.changed, false);
  assert.equal(result.state.series?.episodeNumber, 1);
});

test("watching another episode past the threshold moves the slot to it", () => {
  const state = stateWith({ series: savedSeries() });
  const result = applyPlaybackSnapshot(state, seriesSnapshot({ episodeNumber: 2 }));
  assert.equal(result.changed, true);
  assert.equal(result.state.series?.episodeNumber, 2);
});

test("a different show past the threshold takes over the series slot", () => {
  const state = stateWith({ series: savedSeries() });
  const result = applyPlaybackSnapshot(
    state,
    seriesSnapshot({ tmdbId: 66732, title: "Stranger Things" })
  );
  assert.equal(result.state.series?.title, "Stranger Things");
});

// ---------------------------------------------------------------------------
// Completion — finishing clears instead of saving a credits position
// ---------------------------------------------------------------------------

test("reaching the completion ratio clears the owned slot", () => {
  const state = stateWith({ movie: savedMovie(), series: savedSeries() });
  const result = applyPlaybackSnapshot(
    state,
    movieSnapshot({ positionSeconds: 8700, durationSeconds: 8880 }) // ~98%
  );
  assert.equal(result.changed, true);
  assert.equal(result.state.movie, undefined);
  assert.equal(result.state.series?.title, "Breaking Bad"); // untouched
});

test("finishing a title that does not own the slot leaves the slot alone", () => {
  const state = stateWith({ movie: savedMovie() });
  const result = applyPlaybackSnapshot(
    state,
    movieSnapshot({ tmdbId: 157336, title: "Interstellar", positionSeconds: 8700, durationSeconds: 8880 })
  );
  assert.equal(result.changed, false);
  assert.equal(result.state.movie?.title, "Inception");
});

test("finishing any episode of a show clears an older saved episode (playToEnd path)", () => {
  const state = stateWith({ series: savedSeries({ episodeNumber: 4 }) });
  const result = clearFinishedTarget(state, {
    mediaType: "tv",
    tmdbId: 1396,
    seasonNumber: 1,
    episodeNumber: 5,
  });
  assert.equal(result.changed, true);
  assert.equal(result.state.series, undefined);
});

test("finishing an episode of a different show leaves the slot alone", () => {
  const state = stateWith({ series: savedSeries() });
  const result = clearFinishedTarget(state, {
    mediaType: "tv",
    tmdbId: 66732,
    seasonNumber: 1,
    episodeNumber: 1,
  });
  assert.equal(result.changed, false);
});

// ---------------------------------------------------------------------------
// Resume prompt lookup
// ---------------------------------------------------------------------------

test("resume entry is found only for the exact saved target", () => {
  const state = stateWith({ movie: savedMovie(), series: savedSeries() });

  assert.equal(findResumeEntry(state, { mediaType: "movie", tmdbId: 27205 })?.title, "Inception");
  assert.equal(findResumeEntry(state, { mediaType: "movie", tmdbId: 157336 }), null);

  const episodeTarget = { mediaType: "tv" as const, tmdbId: 1396, seasonNumber: 1, episodeNumber: 1 };
  assert.equal(findResumeEntry(state, episodeTarget)?.positionSeconds, 600);
  assert.equal(findResumeEntry(state, { ...episodeTarget, episodeNumber: 2 }), null);
});

test("stale entries (completed or below the floor) never prompt", () => {
  const completed = stateWith({ movie: savedMovie({ positionSeconds: 8800 }) });
  assert.equal(findResumeEntry(completed, { mediaType: "movie", tmdbId: 27205 }), null);

  const shallow = stateWith({ movie: savedMovie({ positionSeconds: 10 }) });
  assert.equal(findResumeEntry(shallow, { mediaType: "movie", tmdbId: 27205 }), null);
});

test("resume position rewinds for context and clamps at zero", () => {
  assert.equal(getResumePositionSeconds(savedMovie({ positionSeconds: 300 })), 290);
  assert.equal(getResumePositionSeconds(savedMovie({ positionSeconds: 4 })), 0);
});

// ---------------------------------------------------------------------------
// Prompt time formatting
// ---------------------------------------------------------------------------

test("playback time formats as m:ss under an hour and h:mm:ss above", () => {
  assert.equal(formatPlaybackTime(0), "0:00");
  assert.equal(formatPlaybackTime(65), "1:05");
  assert.equal(formatPlaybackTime(3725), "1:02:05");
  assert.equal(formatPlaybackTime(NaN), "0:00");
  assert.equal(formatPlaybackTime(-20), "0:00");
});

// ---------------------------------------------------------------------------
// Wiring guards — protect the PlayerScreen integration (and the 1.0.2 port)
// ---------------------------------------------------------------------------

const rootPath = path.resolve(process.cwd());

test("player screen gates autoplay through continue-watching and renders the prompt", () => {
  const source = fs.readFileSync(path.join(rootPath, "src", "screens", "PlayerScreen.tsx"), "utf8");
  assert.equal(source.includes("useContinueWatching"), true);
  assert.equal(source.includes("handleContinueWatchingReady()"), true);
  assert.equal(source.includes("<ContinueWatchingModal"), true);
});

test("the tracking hook listens to real playback signals and flushes on lifecycle edges", () => {
  const source = fs.readFileSync(path.join(rootPath, "src", "hooks", "useContinueWatching.ts"), "utf8");
  assert.equal(source.includes('addListener("timeUpdate"'), true);
  assert.equal(source.includes('addListener("playToEnd"'), true);
  assert.equal(source.includes('addListener("playingChange"'), true);
  assert.equal(source.includes("AppState.addEventListener"), true);
});

test("sign-out wipes the continue-watching slots", () => {
  const source = fs.readFileSync(path.join(rootPath, "src", "services", "userDataSync.ts"), "utf8");
  const clearBlock = source.slice(source.indexOf("clearLocalUserDataCache"));
  assert.equal(clearBlock.includes("CONTINUE_WATCHING_STORAGE_KEY"), true);
});
