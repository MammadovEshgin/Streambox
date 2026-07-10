import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { VideoPlayer } from "expo-video";

import { useWatchRoom } from "./useWatchRoom";
import { useWebRtcPeers } from "./useWebRtcPeers";
import { useAudioDucking } from "./useAudioDucking";
import { downloadMemoryStill } from "../services/watchMemories";
import {
  WATCH_ROOM_DEFAULT_HARD_SEEK_SECONDS,
  WATCH_ROOM_HEARTBEAT_INTERVAL_MS,
  WATCH_ROOM_SEEK_COOLDOWN_MS,
  clockOffsetSampleMs,
  medianClockOffsetMs,
  resolveSyncDecision,
  type RemotePlaybackState,
} from "../utils/watchRoom";

export type FloatingReaction = { id: string; emoji: string };
export type PartnerStill = { nickname: string; uri: string; captureId: string };
export type CaptureRequest = { fromUserId: string; captureId: string };

type Options = {
  player: VideoPlayer | null;
  code: string;
  nickname: string;
};

// Binds the room channel + WebRTC media + host-authoritative playback sync to
// the live expo-video player. The host broadcasts a playback heartbeat; the
// guest reconciles its own playhead toward it (with a measured clock offset —
// see the sync-ping/pong probe below). Everything the in-session UI needs is
// returned from here.
export function useWatchRoomSession({ player, code, nickname }: Options) {
  const playerRef = useRef(player);
  playerRef.current = player;
  const isHostRef = useRef(false);
  const hostUserIdRef = useRef<string | null>(null);

  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null);
  const [captureDeclinedId, setCaptureDeclinedId] = useState<string | null>(null);
  const [partnerStill, setPartnerStill] = useState<PartnerStill | null>(null);
  // Cameras are OFF by default (privacy). Turning them on both reveals the face
  // bubbles and starts the WebRTC capture; nothing streams until then.
  const [camerasOn, setCamerasOn] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const [joinAttempt, setJoinAttempt] = useState(0);

  const pushReaction = useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((reaction) => reaction.id !== id)), 2600);
  }, []);

  // (host clock − guest clock), measured via sync-ping/pong. Without this, a
  // phone whose clock is a few seconds off NTP would hard-seek on every single
  // heartbeat — a permanent 3s stutter loop.
  const clockOffsetRef = useRef(0);
  const offsetSamplesRef = useRef<number[]>([]);
  const lastSeekAtRef = useRef(0);

  // Guest reconciles its playhead toward the host's broadcast.
  const applyRemotePlayback = useCallback((state: RemotePlaybackState) => {
    const p = playerRef.current;
    if (!p || isHostRef.current) return;
    // Backgrounded: the OS owns playback (phone call, screen lock) — fighting
    // it with play() every heartbeat helps nobody. Sync resumes on foreground.
    if (AppState.currentState !== "active") return;
    const decision = resolveSyncDecision(
      { isPlaying: Boolean((p as any).playing), positionSeconds: p.currentTime ?? 0 },
      state,
      Date.now(),
      { clockOffsetMs: clockOffsetRef.current }
    );
    if (decision.setPlaying === true) p.play();
    else if (decision.setPlaying === false) p.pause();
    if (decision.seekToSeconds != null) {
      const now = Date.now();
      const buffering = (p as any).status === "loading";
      // Cooldown so a buffering stall can't trigger a seek→rebuffer→seek loop.
      if (!buffering && now - lastSeekAtRef.current >= WATCH_ROOM_SEEK_COOLDOWN_MS) {
        lastSeekAtRef.current = now;
        p.currentTime = decision.seekToSeconds;
      }
    }
  }, []);

  const webrtcHandleRef = useRef<(signal: any) => void>(() => undefined);
  const sendSyncPongRef = useRef<(t0: number) => void>(() => undefined);

  const room = useWatchRoom({
    onWebrtcSignal: (signal) => webrtcHandleRef.current(signal),
    // Playback authority is the host, full stop — any other sender (including a
    // spoofed `from`) is ignored.
    onPlayback: (state, fromUserId) => {
      if (hostUserIdRef.current && fromUserId !== hostUserIdRef.current) return;
      applyRemotePlayback(state);
    },
    onReaction: (emoji) => pushReaction(emoji),
    onSyncPing: (_fromUserId, t0) => {
      if (isHostRef.current) sendSyncPongRef.current(t0);
    },
    onSyncPong: (t0, t1) => {
      const samples = offsetSamplesRef.current;
      samples.push(clockOffsetSampleMs(t0, t1, Date.now()));
      if (samples.length > 5) samples.shift();
      clockOffsetRef.current = medianClockOffsetMs(samples);
    },
    onCaptureRequest: (fromUserId, captureId) => setCaptureRequest({ fromUserId, captureId }),
    onCaptureStill: async ({ captureId, nickname: partnerNickname, imagePath }) => {
      // Compose from a LOCAL file — see downloadMemoryStill.
      const uri = await downloadMemoryStill(imagePath);
      if (uri) setPartnerStill({ nickname: partnerNickname, uri, captureId });
    },
    onCaptureUnavailable: (captureId) => setCaptureDeclinedId(captureId),
  });

  isHostRef.current = room.isHost;
  hostUserIdRef.current = room.room?.hostUserId ?? null;
  sendSyncPongRef.current = room.sendSyncPong;

  const bothPresent = room.members.length >= 2;

  // Local media starts as soon as YOU turn cameras on (so you see your own
  // self-view immediately, even before a partner joins). The peer connection
  // only negotiates once both are present — handled by the readiness handshake
  // inside the hook, so an early-created connection just waits for the partner.
  const webrtc = useWebRtcPeers({
    enabled: camerasOn,
    isInitiator: room.isHost,
    selfUserId: room.selfUserId,
    sendSignal: room.send,
  });
  webrtcHandleRef.current = webrtc.handleSignal;

  // Movie ducking: drop the film volume while the partner (or you) speaks and
  // ramp it back after — active only while a live call is up.
  useAudioDucking({
    player,
    getAudioLevels: webrtc.getAudioLevels,
    active: camerasOn && webrtc.connectionState === "connected",
  });

  // Join + connect when the session mounts (join is idempotent server-side).
  // A failed join is surfaced (joinFailed) instead of swallowed — the retry
  // bumps joinAttempt to run this again.
  const joinedRef = useRef(false);
  const { joinAndConnect } = room;
  useEffect(() => {
    if (joinedRef.current || !code || !nickname) return;
    joinedRef.current = true;
    setJoinFailed(false);
    void joinAndConnect(code, nickname).catch(() => setJoinFailed(true));
    // room's own unmount effect disconnects the channel.
  }, [code, nickname, joinAttempt, joinAndConnect]);

  const retryJoin = useCallback(() => {
    joinedRef.current = false;
    setJoinFailed(false);
    setJoinAttempt((attempt) => attempt + 1);
  }, []);

  // Guest measures the host clock offset: a burst of pings once connected
  // (median of 5), then a slow refresh for the rest of the movie.
  const { isHost, connectionState, sendSyncPing } = room;
  useEffect(() => {
    if (isHost || connectionState !== "connected") return;
    offsetSamplesRef.current = [];
    let sent = 0;
    sendSyncPing();
    const burst = setInterval(() => {
      sent += 1;
      sendSyncPing();
      if (sent >= 4) clearInterval(burst);
    }, 1_200);
    const refresh = setInterval(() => sendSyncPing(), 60_000);
    return () => {
      clearInterval(burst);
      clearInterval(refresh);
    };
  }, [isHost, connectionState, sendSyncPing]);

  // Host broadcasts the playback heartbeat (interval + on play/pause change +
  // immediately on a seek jump, so the guest doesn't trail a seek by 3s).
  const { sendPlayback } = room;
  useEffect(() => {
    if (!isHost || !player) return;
    const broadcast = () => {
      sendPlayback({
        isPlaying: Boolean((player as any).playing),
        positionSeconds: player.currentTime ?? 0,
        updatedAtEpochMs: Date.now(),
      });
    };
    const interval = setInterval(broadcast, WATCH_ROOM_HEARTBEAT_INTERVAL_MS);
    const playSub = player.addListener("playingChange", broadcast);
    // Seek detection: a position jump beyond what wall-clock playback explains.
    let last = { pos: player.currentTime ?? 0, at: Date.now(), playing: Boolean((player as any).playing) };
    const prevTimeUpdateInterval = (player as any).timeUpdateEventInterval;
    (player as any).timeUpdateEventInterval = 1;
    const timeSub = player.addListener("timeUpdate", (event: any) => {
      const now = Date.now();
      const pos = event?.currentTime ?? player.currentTime ?? 0;
      const expected = last.pos + (last.playing ? (now - last.at) / 1000 : 0);
      if (Math.abs(pos - expected) > WATCH_ROOM_DEFAULT_HARD_SEEK_SECONDS) broadcast();
      last = { pos, at: now, playing: Boolean((player as any).playing) };
    });
    broadcast();
    return () => {
      clearInterval(interval);
      playSub.remove();
      timeSub.remove();
      try {
        (player as any).timeUpdateEventInterval = prevTimeUpdateInterval ?? 0;
      } catch {
        /* player already released */
      }
    };
  }, [isHost, player, sendPlayback]);

  // Backgrounding / screen lock / incoming call: release the camera + mic (the
  // partner gets a clean placeholder instead of a frozen last frame) and bring
  // them back on return.
  const camerasWereOnRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (camerasWereOnRef.current) {
          camerasWereOnRef.current = false;
          setCamerasOn(true);
        }
      } else if (next === "background") {
        setCamerasOn((on) => {
          if (on) camerasWereOnRef.current = true;
          return false;
        });
      }
    });
    return () => sub.remove();
  }, []);

  const clearCapture = useCallback(() => {
    setCaptureRequest(null);
    setCaptureDeclinedId(null);
    setPartnerStill(null);
  }, []);

  return {
    // room
    room: room.room,
    members: room.members,
    partner: room.partner,
    selfUserId: room.selfUserId,
    isHost: room.isHost,
    connectionState: room.connectionState,
    chatMessages: room.chatMessages,
    bothPresent,
    joinFailed,
    retryJoin,
    fetchRoomMembers: room.fetchRoomMembers,
    // media
    localStream: webrtc.localStream,
    remoteStream: webrtc.remoteStream,
    mediaState: webrtc.connectionState,
    micEnabled: webrtc.micEnabled,
    cameraEnabled: webrtc.cameraEnabled,
    camerasOn,
    setCamerasOn,
    toggleMic: webrtc.toggleMic,
    switchCamera: webrtc.switchCamera,
    restartMedia: webrtc.restartMedia,
    // reactions
    reactions,
    sendReaction: (emoji: string) => {
      room.sendReaction(emoji);
      pushReaction(emoji);
    },
    // chat
    sendChat: room.sendChat,
    // capture
    captureRequest,
    captureDeclinedId,
    partnerStill,
    requestCapture: room.requestCapture,
    sendCaptureStill: room.sendCaptureStill,
    sendCaptureUnavailable: room.sendCaptureUnavailable,
    clearCapture,
    // lifecycle
    leave: room.leave,
  };
}
