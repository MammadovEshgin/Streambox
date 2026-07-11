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

// Prefer the platform CSPRNG when one exists (Hermes exposes
// crypto.getRandomValues in recent RN releases); Math.random is the fallback so
// the module stays dependency-free and node-testable.
export function secureRandomFraction(): number {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoObj.getRandomValues(buf);
    return buf[0] / 0x1_0000_0000;
  }
  return Math.random();
}

export function generateRoomCode(
  randomFn: () => number = secureRandomFraction,
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
// A guest never hard-seeks more often than this: a stall/buffer on either side
// would otherwise trigger a seek→rebuffer→seek loop on every heartbeat.
export const WATCH_ROOM_SEEK_COOLDOWN_MS = 5_000;

// ── Transport recovery + presence UI ──────────────────────────────────────
// Kept pure so the state transitions that users see during a channel flap are
// testable without React Native or a live Supabase socket.
export type WatchRoomConnectionState = "idle" | "connecting" | "connected" | "closed" | "error";
export type WatchRoomPresenceUiState = "lobby" | "ready" | "partner-left" | "reconnecting";

export function deriveWatchRoomPresenceUiState(input: {
  connectionState: WatchRoomConnectionState;
  bothPresent: boolean;
  hasEverConnected: boolean;
  hasEverPartner: boolean;
}): WatchRoomPresenceUiState {
  // Presence can remain stale while the local channel is down. Once this
  // client has subscribed, transport health wins over that stale roster.
  if (input.hasEverConnected && input.connectionState !== "connected") return "reconnecting";
  if (input.bothPresent) return "ready";
  // A real mid-session departure is never a new lobby: showing the join code
  // again suggests the still-connected partner needs to re-enter it.
  if (input.hasEverPartner) return "partner-left";
  return "lobby";
}

export function canStartWatchRoomCapture(input: {
  connectionState: WatchRoomConnectionState;
  bothPresent: boolean;
  capturing: boolean;
  cooldownUntilMs: number;
  nowMs: number;
}): boolean {
  return (
    input.connectionState === "connected" &&
    input.bothPresent &&
    !input.capturing &&
    input.nowMs >= input.cooldownUntilMs
  );
}

export const WATCH_ROOM_RECONNECT_BASE_DELAY_MS = 2_000;
export const WATCH_ROOM_RECONNECT_MAX_DELAY_MS = 15_000;

export function watchRoomReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(WATCH_ROOM_RECONNECT_MAX_DELAY_MS, WATCH_ROOM_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(safeAttempt, 3));
}

export const WATCH_ROOM_REALTIME_AUTH_MARGIN_MS = 60_000;
export const WATCH_ROOM_REALTIME_AUTH_RETRY_MS = 10_000;

export function watchRoomAuthTimerDelayMs(input: {
  expiresAtMs: number;
  nowMs: number;
  refreshFailed: boolean;
}): number {
  if (input.refreshFailed) return WATCH_ROOM_REALTIME_AUTH_RETRY_MS;
  return Math.max(1_000, input.expiresAtMs - input.nowMs - WATCH_ROOM_REALTIME_AUTH_MARGIN_MS);
}

// ── Clock offset (host clock − guest clock) via ping/pong ──────────────────
// The guest sends sync-ping with its clock t0; the host answers sync-pong with
// its clock t1; the guest reads its clock t2 on arrival. Standard NTP-style
// estimate: offset ≈ t1 − (t0 + t2) / 2 (assumes symmetric network latency).
export function clockOffsetSampleMs(t0: number, t1: number, t2: number): number {
  return t1 - (t0 + t2) / 2;
}

// Median of the collected samples — robust against the odd delayed pong.
export function medianClockOffsetMs(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
  // Carried into the room so BOTH participants resolve the same title — the
  // provider match scoring in WebPlayerService needs the IMDb id + year, not
  // just the title (otherwise "Obsession" 2026 can match "Fear" 1996).
  imdbId?: string | null;
  year?: string | null;
  originalTitle?: string | null;
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
  // Readiness handshake: a peer announces it has a live RTCPeerConnection ready
  // to negotiate. Prevents the host's offer from racing ahead of the guest's
  // peer connection (which would silently drop the offer and never connect).
  | { type: "webrtc-ready"; from: string }
  | { type: "playback"; from: string; state: RemotePlaybackState }
  | { type: "reaction"; from: string; emoji: string; at: number }
  | { type: "chat"; from: string; text: string; at: number }
  // Clock-offset probe (guest → host → guest); see clockOffsetSampleMs.
  | { type: "sync-ping"; from: string; t0: number }
  | { type: "sync-pong"; from: string; t0: number; t1: number }
  // captureId ties a partner's still to the exact capture that requested it, so
  // a late-arriving still can never leak into the NEXT polaroid.
  | { type: "capture-request"; from: string; captureId: string; at: number }
  | { type: "capture-still"; from: string; captureId: string; nickname: string; imagePath: string; at: number }
  // The partner declined to contribute (face-cam off / permission missing) —
  // lets the author compose immediately instead of waiting out the timeout.
  | { type: "capture-unavailable"; from: string; captureId: string }
  // The author's composed polaroid, uploaded to Storage — lets the partner see
  // the finished card too (both decide whether it's a keeper or a retake).
  | { type: "polaroid-preview"; from: string; captureId: string; imagePath: string };

// What a peer should do when it hears the other side is "ready": the host
// (initiator) answers with an SDP offer; the guest re-announces its own
// readiness so a host that enabled its camera later still learns to offer.
// Because only the host ever offers, there is no offer glare to arbitrate.
export function negotiationActionOnPeerReady(isInitiator: boolean): "offer" | "announce-ready" {
  return isInitiator ? "offer" : "announce-ready";
}

export const WATCH_ROOM_CHANNEL_PREFIX = "watch-room";

export function watchRoomChannelName(code: string): string {
  return `${WATCH_ROOM_CHANNEL_PREFIX}:${normalizeRoomCode(code)}`;
}

// Shape of the watch_rooms row returned by the create/join RPCs.
export type WatchRoomRow = {
  id: string;
  code: string;
  host_user_id: string;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  season_number: number | null;
  episode_number: number | null;
  imdb_id: string | null;
  year: string | null;
  original_title: string | null;
  status: WatchRoomStatus;
  created_at: string;
  expires_at: string;
};

// Pure snake_case row → camelCase domain mapper (kept here, free of native
// imports, so it stays unit-testable).
export function mapWatchRoomRow(row: WatchRoomRow): WatchRoom {
  return {
    id: row.id,
    code: row.code,
    hostUserId: row.host_user_id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    title: row.title,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    imdbId: row.imdb_id,
    year: row.year,
    originalTitle: row.original_title,
    status: row.status,
    createdAtEpochMs: Date.parse(row.created_at),
    expiresAtEpochMs: Date.parse(row.expires_at),
  };
}
