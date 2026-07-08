import type { MediaType } from "../api/tmdb";

// ---------------------------------------------------------------------------
// Watch Together — pure logic (no React Native / native imports, see
// tests/watchRoom.test.ts). Covers three things the whole feature leans on:
//   1. Join codes            — how a room is shared and re-typed unambiguously.
//   2. Session nicknames      — per-room display names, unique within a room.
//   3. Playback sync math     — the host-authoritative clock that keeps both
//                               participants on (near) the same frame.
//
// The media itself (camera + mic) rides WebRTC peer-to-peer and never touches
// this module. Everything here is a small text payload broadcast over the
// room's Supabase Realtime channel (see WatchRoomSignal), so it stays trivially
// cheap on the free tier.
// ---------------------------------------------------------------------------

// ── Join codes ─────────────────────────────────────────────────────────────
export const WATCH_ROOM_CODE_LENGTH = 6;
// Ambiguous glyphs (0/O, 1/I/L) are excluded so a code that is read aloud or
// re-typed by the invitee is unambiguous. 31 symbols ^ 6 ≈ 887M combinations —
// paired with the 2-member cap and room expiry, that is enough to gate a
// private casual room.
export const WATCH_ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(
  randomFn: () => number = Math.random,
  length: number = WATCH_ROOM_CODE_LENGTH
): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    const raw = Math.floor(randomFn() * WATCH_ROOM_CODE_ALPHABET.length);
    const index = Math.min(WATCH_ROOM_CODE_ALPHABET.length - 1, Math.max(0, raw));
    code += WATCH_ROOM_CODE_ALPHABET[index];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw);
  if (code.length !== WATCH_ROOM_CODE_LENGTH) return false;
  return [...code].every((char) => WATCH_ROOM_CODE_ALPHABET.includes(char));
}

// ── Session nicknames ──────────────────────────────────────────────────────
export const WATCH_ROOM_NICKNAME_MIN_LENGTH = 1;
export const WATCH_ROOM_NICKNAME_MAX_LENGTH = 20;

export function normalizeNickname(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function isValidNickname(raw: string): boolean {
  const nickname = normalizeNickname(raw);
  return (
    nickname.length >= WATCH_ROOM_NICKNAME_MIN_LENGTH &&
    nickname.length <= WATCH_ROOM_NICKNAME_MAX_LENGTH
  );
}

// Session-unique: case-insensitive, whitespace-normalized. `taken` is the set
// of nicknames already claimed by other members of the same room.
export function isNicknameAvailable(raw: string, taken: readonly string[]): boolean {
  const candidate = normalizeNickname(raw).toLowerCase();
  if (!candidate) return false;
  return !taken.some((name) => normalizeNickname(name).toLowerCase() === candidate);
}

// ── Playback sync (host-authoritative clock) ───────────────────────────────
// The host samples its playhead and broadcasts a heartbeat; the guest projects
// where the host "should" be by now and only hard-corrects when drift is large
// enough that a viewer would notice. Small drift is left alone so we never
// stutter the picture chasing sub-second precision.

export type RemotePlaybackState = {
  isPlaying: boolean;
  positionSeconds: number;
  // Host wall-clock (epoch ms) sampled at the same instant as positionSeconds.
  updatedAtEpochMs: number;
};

export type LocalPlaybackState = {
  isPlaying: boolean;
  positionSeconds: number;
};

export type SyncDecision = {
  // Non-null → seek the local player to this second. Null → close enough, leave it.
  seekToSeconds: number | null;
  // Non-null → force local transport to this state. Null → already matches.
  setPlaying: boolean | null;
};

export type SyncOptions = {
  // (host clock − guest clock) in ms when measured via a ping/pong round-trip.
  // Defaults to 0, which assumes both phones are close to NTP time.
  clockOffsetMs?: number;
  // Drift beyond this many seconds triggers a hard seek. Below it, the playhead
  // is left untouched to avoid visible micro-stutter.
  hardSeekSeconds?: number;
};

export const WATCH_ROOM_DEFAULT_HARD_SEEK_SECONDS = 2;
// How often the host broadcasts its playback heartbeat while a room is active.
export const WATCH_ROOM_HEARTBEAT_INTERVAL_MS = 3_000;

export function projectRemotePosition(
  remote: RemotePlaybackState,
  nowEpochMs: number,
  clockOffsetMs = 0
): number {
  if (!remote.isPlaying) {
    return Math.max(0, remote.positionSeconds);
  }
  const elapsedMs = nowEpochMs - remote.updatedAtEpochMs - clockOffsetMs;
  return Math.max(0, remote.positionSeconds + Math.max(0, elapsedMs) / 1000);
}

export function resolveSyncDecision(
  local: LocalPlaybackState,
  remote: RemotePlaybackState,
  nowEpochMs: number,
  options: SyncOptions = {}
): SyncDecision {
  const hardSeekSeconds = options.hardSeekSeconds ?? WATCH_ROOM_DEFAULT_HARD_SEEK_SECONDS;
  const target = projectRemotePosition(remote, nowEpochMs, options.clockOffsetMs ?? 0);
  const drift = local.positionSeconds - target;
  const seekToSeconds = Math.abs(drift) > hardSeekSeconds ? target : null;
  const setPlaying = local.isPlaying !== remote.isPlaying ? remote.isPlaying : null;
  return { seekToSeconds, setPlaying };
}

// ── Room + wire types ──────────────────────────────────────────────────────
export type WatchRoomStatus = "lobby" | "watching" | "ended";
export type WatchRoomRole = "host" | "guest";

export type WatchRoomMedia = {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type WatchRoomMember = {
  userId: string;
  nickname: string;
  role: WatchRoomRole;
};

export type WatchRoom = WatchRoomMedia & {
  id: string;
  code: string;
  hostUserId: string;
  status: WatchRoomStatus;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
};

// The typed contract for everything broadcast over a room's Realtime channel.
// `from` is the sender's Supabase user id. WebRTC signaling (offer/answer/ice)
// only fires during connection setup — the actual media never crosses this
// channel.
export type WatchRoomSignal =
  | { type: "webrtc-offer"; from: string; sdp: string }
  | { type: "webrtc-answer"; from: string; sdp: string }
  | { type: "webrtc-ice"; from: string; candidate: unknown }
  | { type: "playback"; from: string; state: RemotePlaybackState }
  | { type: "reaction"; from: string; emoji: string; at: number }
  | { type: "chat"; from: string; text: string; at: number }
  | { type: "capture-request"; from: string; at: number }
  | { type: "capture-still"; from: string; nickname: string; imagePath: string; at: number };

export const WATCH_ROOM_CHANNEL_PREFIX = "watch-room";

export function watchRoomChannelName(code: string): string {
  return `${WATCH_ROOM_CHANNEL_PREFIX}:${normalizeRoomCode(code)}`;
}
