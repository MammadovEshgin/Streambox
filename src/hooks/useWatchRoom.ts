import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../context/AuthContext";
import {
  WatchRoomService,
  type WatchRoomConnectionState,
} from "../services/watchRoomService";
import type {
  RemotePlaybackState,
  WatchRoom,
  WatchRoomMedia,
  WatchRoomMember,
  WatchRoomRole,
  WatchRoomSignal,
} from "../utils/watchRoom";

export type WatchRoomChatMessage = {
  id: string;
  fromUserId: string;
  text: string;
  at: number;
  mine: boolean;
};

// Signals the room forwards to specialised consumers (the WebRTC peer hook and
// the player's sync layer) rather than holding in React state.
export type WatchRoomSignalHandlers = {
  onWebrtcSignal?: (signal: Extract<WatchRoomSignal, { type: `webrtc-${string}` }>) => void;
  onPlayback?: (state: RemotePlaybackState, fromUserId: string) => void;
  onReaction?: (emoji: string, fromUserId: string) => void;
  onCaptureRequest?: (fromUserId: string) => void;
  onCaptureStill?: (payload: { fromUserId: string; nickname: string; imagePath: string }) => void;
};

export function useWatchRoom(handlers: WatchRoomSignalHandlers = {}) {
  const { user } = useAuth();
  const selfUserId = user?.id ?? "";

  const serviceRef = useRef<WatchRoomService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = new WatchRoomService();
  }

  const [room, setRoom] = useState<WatchRoom | null>(null);
  const [members, setMembers] = useState<WatchRoomMember[]>([]);
  const [connectionState, setConnectionState] = useState<WatchRoomConnectionState>("idle");
  const [chatMessages, setChatMessages] = useState<WatchRoomChatMessage[]>([]);

  // Keep the latest handlers without re-subscribing the channel on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const service = serviceRef.current!;
    service.setListeners({
      onConnectionStateChange: setConnectionState,
      onMembersChange: setMembers,
      onSignal: (signal) => {
        switch (signal.type) {
          case "chat":
            setChatMessages((prev) => [
              ...prev,
              { id: `${signal.from}-${signal.at}`, fromUserId: signal.from, text: signal.text, at: signal.at, mine: false },
            ]);
            break;
          case "reaction":
            handlersRef.current.onReaction?.(signal.emoji, signal.from);
            break;
          case "playback":
            handlersRef.current.onPlayback?.(signal.state, signal.from);
            break;
          case "capture-request":
            handlersRef.current.onCaptureRequest?.(signal.from);
            break;
          case "capture-still":
            handlersRef.current.onCaptureStill?.({ fromUserId: signal.from, nickname: signal.nickname, imagePath: signal.imagePath });
            break;
          case "webrtc-offer":
          case "webrtc-answer":
          case "webrtc-ice":
          case "webrtc-ready":
            handlersRef.current.onWebrtcSignal?.(signal);
            break;
        }
      },
    });
  }, []);

  useEffect(() => {
    return () => {
      void serviceRef.current?.disconnect();
    };
  }, []);

  const selfRole: WatchRoomRole = room && room.hostUserId === selfUserId ? "host" : "guest";
  const isHost = selfRole === "host";

  const createAndConnect = useCallback(
    async (media: WatchRoomMedia, nickname: string) => {
      const service = serviceRef.current!;
      const created = await service.createRoom(media, nickname);
      setRoom(created);
      await service.connect(created, { userId: selfUserId, nickname, role: "host" });
      return created;
    },
    [selfUserId]
  );

  const joinAndConnect = useCallback(
    async (code: string, nickname: string) => {
      const service = serviceRef.current!;
      const joined = await service.joinRoom(code, nickname);
      setRoom(joined);
      const role: WatchRoomRole = joined.hostUserId === selfUserId ? "host" : "guest";
      await service.connect(joined, { userId: selfUserId, nickname, role });
      return joined;
    },
    [selfUserId]
  );

  const send = useCallback(
    (signal: WatchRoomSignal) => {
      serviceRef.current?.send(signal);
    },
    []
  );

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const at = Date.now();
      send({ type: "chat", from: selfUserId, text: trimmed, at });
      setChatMessages((prev) => [...prev, { id: `${selfUserId}-${at}`, fromUserId: selfUserId, text: trimmed, at, mine: true }]);
    },
    [selfUserId, send]
  );

  const sendReaction = useCallback(
    (emoji: string) => send({ type: "reaction", from: selfUserId, emoji, at: Date.now() }),
    [selfUserId, send]
  );

  const sendPlayback = useCallback(
    (state: RemotePlaybackState) => send({ type: "playback", from: selfUserId, state }),
    [selfUserId, send]
  );

  const requestCapture = useCallback(
    () => send({ type: "capture-request", from: selfUserId, at: Date.now() }),
    [selfUserId, send]
  );

  const sendCaptureStill = useCallback(
    (nickname: string, imagePath: string) =>
      send({ type: "capture-still", from: selfUserId, nickname, imagePath, at: Date.now() }),
    [selfUserId, send]
  );

  const startWatching = useCallback(async () => {
    if (room && isHost) {
      await serviceRef.current?.setStatus(room.id, "watching").catch(() => undefined);
      setRoom((prev) => (prev ? { ...prev, status: "watching" } : prev));
    }
  }, [room, isHost]);

  const leave = useCallback(async () => {
    if (room && isHost) {
      await serviceRef.current?.endRoom(room.id).catch(() => undefined);
    }
    await serviceRef.current?.disconnect();
    setRoom(null);
    setMembers([]);
    setChatMessages([]);
  }, [room, isHost]);

  const partner = useMemo(
    () => members.find((member) => member.userId !== selfUserId) ?? null,
    [members, selfUserId]
  );

  return {
    room,
    members,
    partner,
    selfUserId,
    selfRole,
    isHost,
    connectionState,
    chatMessages,
    createAndConnect,
    joinAndConnect,
    sendChat,
    sendReaction,
    sendPlayback,
    requestCapture,
    sendCaptureStill,
    send,
    startWatching,
    leave,
  };
}
