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
  onCaptureRequest?: (fromUserId: string, captureId: string) => void;
  onCaptureStill?: (payload: { fromUserId: string; captureId: string; nickname: string; imagePath: string }) => void;
  onCaptureUnavailable?: (captureId: string) => void;
  onPolaroidPreview?: (payload: { fromUserId: string; captureId: string; imagePath: string }) => void;
  onSyncPing?: (fromUserId: string, t0: number) => void;
  onSyncPong?: (t0: number, t1: number) => void;
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
            // Capped so a chat-heavy multi-hour session can't grow memory unbounded.
            setChatMessages((prev) => [
              ...prev,
              { id: `${signal.from}-${signal.at}`, fromUserId: signal.from, text: signal.text, at: signal.at, mine: false },
            ].slice(-200));
            break;
          case "reaction":
            handlersRef.current.onReaction?.(signal.emoji, signal.from);
            break;
          case "playback":
            handlersRef.current.onPlayback?.(signal.state, signal.from);
            break;
          case "sync-ping":
            handlersRef.current.onSyncPing?.(signal.from, signal.t0);
            break;
          case "sync-pong":
            handlersRef.current.onSyncPong?.(signal.t0, signal.t1);
            break;
          case "capture-request":
            handlersRef.current.onCaptureRequest?.(signal.from, signal.captureId);
            break;
          case "capture-still":
            handlersRef.current.onCaptureStill?.({
              fromUserId: signal.from,
              captureId: signal.captureId,
              nickname: signal.nickname,
              imagePath: signal.imagePath,
            });
            break;
          case "capture-unavailable":
            handlersRef.current.onCaptureUnavailable?.(signal.captureId);
            break;
          case "polaroid-preview":
            handlersRef.current.onPolaroidPreview?.({
              fromUserId: signal.from,
              captureId: signal.captureId,
              imagePath: signal.imagePath,
            });
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
      const trimmed = text.trim().slice(0, 500);
      if (!trimmed) return;
      const at = Date.now();
      send({ type: "chat", from: selfUserId, text: trimmed, at });
      setChatMessages((prev) =>
        [...prev, { id: `${selfUserId}-${at}`, fromUserId: selfUserId, text: trimmed, at, mine: true }].slice(-200)
      );
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

  const sendSyncPing = useCallback(
    () => send({ type: "sync-ping", from: selfUserId, t0: Date.now() }),
    [selfUserId, send]
  );

  const sendSyncPong = useCallback(
    (t0: number) => send({ type: "sync-pong", from: selfUserId, t0, t1: Date.now() }),
    [selfUserId, send]
  );

  const requestCapture = useCallback(
    (captureId: string) => send({ type: "capture-request", from: selfUserId, captureId, at: Date.now() }),
    [selfUserId, send]
  );

  const sendCaptureStill = useCallback(
    (captureId: string, nickname: string, imagePath: string) =>
      send({ type: "capture-still", from: selfUserId, captureId, nickname, imagePath, at: Date.now() }),
    [selfUserId, send]
  );

  const sendCaptureUnavailable = useCallback(
    (captureId: string) => send({ type: "capture-unavailable", from: selfUserId, captureId }),
    [selfUserId, send]
  );

  const sendPolaroidPreview = useCallback(
    (captureId: string, imagePath: string) =>
      send({ type: "polaroid-preview", from: selfUserId, captureId, imagePath }),
    [selfUserId, send]
  );

  // Durable membership from the DB — presence can flap, and anything persisted
  // (memory participant ids) must never be derived from a live roster snapshot.
  const fetchRoomMembers = useCallback(async (): Promise<WatchRoomMember[]> => {
    if (!room) return [];
    return serviceRef.current!.fetchMembers(room.id);
  }, [room]);

  const startWatching = useCallback(async () => {
    if (room && isHost) {
      await serviceRef.current?.setStatus(room.id, "watching").catch(() => undefined);
      setRoom((prev) => (prev ? { ...prev, status: "watching" } : prev));
    }
  }, [room, isHost]);

  // Leaving no longer ends the room: an accidental host exit used to strand the
  // guest permanently (the code stopped resolving). The room stays joinable
  // until its 12h expiry so the pair can re-form; expiry is the cleanup.
  const leave = useCallback(async () => {
    await serviceRef.current?.disconnect();
    setRoom(null);
    setMembers([]);
    setChatMessages([]);
  }, []);

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
    sendSyncPing,
    sendSyncPong,
    requestCapture,
    sendCaptureStill,
    sendCaptureUnavailable,
    sendPolaroidPreview,
    fetchRoomMembers,
    send,
    startWatching,
    leave,
  };
}
