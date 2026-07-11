import assert from "node:assert/strict";
import test from "node:test";

import {
  WATCH_ROOM_CODE_ALPHABET,
  WATCH_ROOM_CODE_LENGTH,
  canStartWatchRoomCapture,
  clockOffsetSampleMs,
  deriveWatchRoomPresenceUiState,
  generateRoomCode,
  isNicknameAvailable,
  isValidNickname,
  isValidRoomCode,
  medianClockOffsetMs,
  normalizeNickname,
  normalizeRoomCode,
  projectRemotePosition,
  resolveSyncDecision,
  secureRandomFraction,
  watchRoomAuthTimerDelayMs,
  watchRoomChannelName,
  watchRoomReconnectDelayMs,
  type RemotePlaybackState,
} from "../src/utils/watchRoom";

test("generateRoomCode is deterministic under a seeded random and stays in the alphabet", () => {
  const values = [0, 0.5, 0.99, 0.1, 0.7, 0.33];
  let i = 0;
  const seeded = () => values[i++ % values.length];
  const code = generateRoomCode(seeded);
  assert.equal(code.length, WATCH_ROOM_CODE_LENGTH);
  // 0→A, 0.5→S, 0.99→9, 0.1→D, 0.7→Y, 0.33→M
  assert.equal(code, "AS9DYM");
  assert.ok([...code].every((ch) => WATCH_ROOM_CODE_ALPHABET.includes(ch)));
});

test("generateRoomCode never indexes past the alphabet even when random returns 1", () => {
  const code = generateRoomCode(() => 1);
  const last = WATCH_ROOM_CODE_ALPHABET[WATCH_ROOM_CODE_ALPHABET.length - 1];
  assert.equal(code, last.repeat(WATCH_ROOM_CODE_LENGTH));
});

test("room code normalization strips separators and ambiguous casing", () => {
  assert.equal(normalizeRoomCode(" a2-nz ct j "), "A2NZCTJ");
  assert.equal(isValidRoomCode("anzctj"), true);
  assert.equal(isValidRoomCode("ANZCT"), false); // too short
  assert.equal(isValidRoomCode("ANZCT0"), false); // 0 is not in the alphabet
});

test("nicknames collapse whitespace and enforce length bounds", () => {
  assert.equal(normalizeNickname("  Eshgin   Movie   "), "Eshgin Movie");
  assert.equal(isValidNickname(""), false);
  assert.equal(isValidNickname("   "), false);
  assert.equal(isValidNickname("A"), true);
  assert.equal(isValidNickname("x".repeat(20)), true);
  assert.equal(isValidNickname("x".repeat(21)), false);
});

test("nickname availability is case-insensitive within a room", () => {
  const taken = ["Eshgin", "Night Owl"];
  assert.equal(isNicknameAvailable("eshgin", taken), false);
  assert.equal(isNicknameAvailable("  NIGHT   owl ", taken), false);
  assert.equal(isNicknameAvailable("Popcorn", taken), true);
  assert.equal(isNicknameAvailable("   ", taken), false);
});

test("projectRemotePosition holds still when paused and advances by elapsed time when playing", () => {
  const paused: RemotePlaybackState = { isPlaying: false, positionSeconds: 100, updatedAtEpochMs: 1_000 };
  assert.equal(projectRemotePosition(paused, 9_999), 100);

  const playing: RemotePlaybackState = { isPlaying: true, positionSeconds: 100, updatedAtEpochMs: 1_000 };
  // 2s of wall-clock elapsed since the sample → playhead should read 102.
  assert.equal(projectRemotePosition(playing, 3_000), 102);
});

test("projectRemotePosition applies a measured clock offset", () => {
  const playing: RemotePlaybackState = { isPlaying: true, positionSeconds: 50, updatedAtEpochMs: 10_000 };
  // Host clock runs 500ms ahead of the guest → subtract it from elapsed.
  assert.equal(projectRemotePosition(playing, 12_000, 500), 51.5);
});

test("resolveSyncDecision leaves small drift alone but hard-seeks large drift", () => {
  const remote: RemotePlaybackState = { isPlaying: true, positionSeconds: 100, updatedAtEpochMs: 0 };

  // Local is 1s behind the projected target (102) → within the 2s window.
  const small = resolveSyncDecision({ isPlaying: true, positionSeconds: 101 }, remote, 2_000);
  assert.equal(small.seekToSeconds, null);
  assert.equal(small.setPlaying, null);

  // Local is ~5s behind the target → hard seek to the projected position.
  const large = resolveSyncDecision({ isPlaying: true, positionSeconds: 97 }, remote, 2_000);
  assert.equal(large.seekToSeconds, 102);
});

test("resolveSyncDecision reconciles transport state independently of position", () => {
  const remote: RemotePlaybackState = { isPlaying: false, positionSeconds: 100, updatedAtEpochMs: 0 };
  const decision = resolveSyncDecision({ isPlaying: true, positionSeconds: 100 }, remote, 5_000);
  assert.equal(decision.setPlaying, false); // host paused → guest must pause
  assert.equal(decision.seekToSeconds, null); // position matches while paused
});

test("channel name is stable regardless of how the code was typed", () => {
  assert.equal(watchRoomChannelName(" an-z ctj "), "watch-room:ANZCTJ");
});

test("secureRandomFraction stays in [0, 1) so it can drive the code alphabet", () => {
  for (let i = 0; i < 200; i += 1) {
    const value = secureRandomFraction();
    assert.ok(value >= 0 && value < 1);
  }
});

test("clock offset sample is the NTP-style midpoint estimate", () => {
  // Guest sends at t0=1000, host replies with its clock t1=1600, guest receives
  // at t2=1200 → RTT 200ms, host clock is 500ms ahead.
  assert.equal(clockOffsetSampleMs(1_000, 1_600, 1_200), 500);
  // Symmetric case: clocks agree, 100ms RTT → offset 0.
  assert.equal(clockOffsetSampleMs(1_000, 1_050, 1_100), 0);
});

test("median clock offset resists a single delayed outlier", () => {
  assert.equal(medianClockOffsetMs([]), 0);
  assert.equal(medianClockOffsetMs([500]), 500);
  // One pong stuck behind a burst of traffic reads as a huge offset — the
  // median ignores it.
  assert.equal(medianClockOffsetMs([480, 510, 4_000, 495, 505]), 505);
  assert.equal(medianClockOffsetMs([100, 200]), 150);
});

test("presence UI keeps the join code exclusive to the initial lobby", () => {
  assert.equal(
    deriveWatchRoomPresenceUiState({
      connectionState: "connecting",
      bothPresent: false,
      hasEverConnected: false,
      hasEverPartner: false,
    }),
    "lobby"
  );
  assert.equal(
    deriveWatchRoomPresenceUiState({
      connectionState: "connected",
      bothPresent: false,
      hasEverConnected: true,
      hasEverPartner: true,
    }),
    "partner-left"
  );
});

test("presence UI prioritizes reconnecting over a stale presence roster", () => {
  assert.equal(
    deriveWatchRoomPresenceUiState({
      connectionState: "error",
      bothPresent: true,
      hasEverConnected: true,
      hasEverPartner: true,
    }),
    "reconnecting"
  );
  assert.equal(
    deriveWatchRoomPresenceUiState({
      connectionState: "connected",
      bothPresent: true,
      hasEverConnected: true,
      hasEverPartner: true,
    }),
    "ready"
  );
});

test("transport recovery helpers cap backoff and retry failed auth promptly", () => {
  assert.deepEqual([0, 1, 2, 3, 8].map(watchRoomReconnectDelayMs), [2_000, 4_000, 8_000, 15_000, 15_000]);
  assert.equal(
    watchRoomAuthTimerDelayMs({ expiresAtMs: 3_600_000, nowMs: 0, refreshFailed: false }),
    3_540_000
  );
  assert.equal(
    watchRoomAuthTimerDelayMs({ expiresAtMs: 30_000, nowMs: 0, refreshFailed: true }),
    10_000
  );
});

test("capture eligibility requires a live channel, partner, and expired cooldown", () => {
  const ready = {
    connectionState: "connected" as const,
    bothPresent: true,
    capturing: false,
    cooldownUntilMs: 1_000,
    nowMs: 1_000,
  };
  assert.equal(canStartWatchRoomCapture(ready), true);
  assert.equal(canStartWatchRoomCapture({ ...ready, connectionState: "connecting" }), false);
  assert.equal(canStartWatchRoomCapture({ ...ready, bothPresent: false }), false);
  assert.equal(canStartWatchRoomCapture({ ...ready, capturing: true }), false);
  assert.equal(canStartWatchRoomCapture({ ...ready, nowMs: 999 }), false);
});
