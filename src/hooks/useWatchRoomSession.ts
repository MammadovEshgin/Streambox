import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";

import { useWatchRoom } from "./useWatchRoom";
import { useWebRtcPeers } from "./useWebRtcPeers";
import { getMemoryImageUrl } from "../services/watchMemories";
import {
  WATCH_ROOM_HEARTBEAT_INTERVAL_MS,
  resolveSyncDecision,
  type RemotePlaybackState,
} from "../utils/watchRoom";

export type FloatingReaction = { id: string; emoji: string };
export type PartnerStill = { nickname: string; uri: string };

type Options = {
  player: VideoPlayer | null;
  code: string;
  nickname: string;
};

// Binds the room channel + WebRTC media + host-authoritative playback sync to
// the live expo-video player. The host broadcasts a playback heartbeat; the
// guest reconciles its own playhead toward it. Everything the in-session UI
// needs is returned from here.
export function useWatchRoomSession({ player, code, nickname }: Options) {
  const playerRef = useRef(player);
  playerRef.current = player;
  const isHostRef = useRef(false);

  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [captureRequestedBy, setCaptureRequestedBy] = useState<string | null>(null);
  const [partnerStill, setPartnerStill] = useState<PartnerStill | null>(null);
  // Cameras are OFF by default (privacy). Turning them on both reveals the face
  // bubbles and starts the WebRTC capture; nothing streams until then.
  const [camerasOn, setCamerasOn] = useState(false);

  const pushReaction = useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((prev) => [...prev, { id, emoji }]);
    setTimeout(() => setReactions((prev) => prev.filter((reaction) => reaction.id !== id)), 2600);
  }, []);

  // Guest reconciles its playhead toward the host's broadcast.
  const applyRemotePlayback = useCallback((state: RemotePlaybackState) => {
    const p = playerRef.current;
    if (!p || isHostRef.current) return;
    const decision = resolveSyncDecision(
      { isPlaying: Boolean((p as any).playing), positionSeconds: p.currentTime ?? 0 },
      state,
      Date.now()
    );
    if (decision.setPlaying === true) p.play();
    else if (decision.setPlaying === false) p.pause();
    if (decision.seekToSeconds != null) p.currentTime = decision.seekToSeconds;
  }, []);

  const webrtcHandleRef = useRef<(signal: any) => void>(() => undefined);

  const room = useWatchRoom({
    onWebrtcSignal: (signal) => webrtcHandleRef.current(signal),
    onPlayback: applyRemotePlayback,
    onReaction: (emoji) => pushReaction(emoji),
    onCaptureRequest: (fromUserId) => setCaptureRequestedBy(fromUserId),
    onCaptureStill: async ({ nickname: partnerNickname, imagePath }) => {
      const uri = await getMemoryImageUrl(imagePath);
      if (uri) setPartnerStill({ nickname: partnerNickname, uri });
    },
  });

  isHostRef.current = room.isHost;

  const bothPresent = room.members.length >= 2;

  const webrtc = useWebRtcPeers({
    enabled: bothPresent && camerasOn,
    isInitiator: room.isHost,
    selfUserId: room.selfUserId,
    sendSignal: room.send,
  });
  webrtcHandleRef.current = webrtc.handleSignal;

  // Join + connect once when the session mounts (join is idempotent server-side).
  const joinedRef = useRef(false);
  useEffect(() => {
    if (joinedRef.current || !code || !nickname) return;
    joinedRef.current = true;
    void room.joinAndConnect(code, nickname).catch(() => undefined);
    // room's own unmount effect disconnects the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, nickname]);

  // Host broadcasts the playback heartbeat (interval + on play/pause change).
  useEffect(() => {
    if (!room.isHost || !player) return;
    const broadcast = () => {
      room.sendPlayback({
        isPlaying: Boolean((player as any).playing),
        positionSeconds: player.currentTime ?? 0,
        updatedAtEpochMs: Date.now(),
      });
    };
    const interval = setInterval(broadcast, WATCH_ROOM_HEARTBEAT_INTERVAL_MS);
    const sub = player.addListener("playingChange", broadcast);
    broadcast();
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [room.isHost, player, room]);

  const clearCapture = useCallback(() => {
    setCaptureRequestedBy(null);
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
    // reactions
    reactions,
    sendReaction: (emoji: string) => {
      room.sendReaction(emoji);
      pushReaction(emoji);
    },
    // chat
    sendChat: room.sendChat,
    // capture
    captureRequestedBy,
    partnerStill,
    requestCapture: room.requestCapture,
    sendCaptureStill: room.sendCaptureStill,
    clearCapture,
    // lifecycle
    leave: room.leave,
  };
}
