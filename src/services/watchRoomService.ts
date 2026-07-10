import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import {
  mapWatchRoomRow,
  watchRoomChannelName,
  type WatchRoom,
  type WatchRoomMedia,
  type WatchRoomMember,
  type WatchRoomRole,
  type WatchRoomRow,
  type WatchRoomSignal,
  type WatchRoomStatus,
} from "../utils/watchRoom";

// ---------------------------------------------------------------------------
// Watch Together transport. One instance owns one room's lifecycle:
//   · create/join/end via the SECURITY DEFINER RPCs (join-by-code),
//   · a Supabase Realtime channel for presence (lobby roster) + broadcast
//     (WebRTC signaling, playback sync, chat, reactions),
//   · keeping the Realtime socket authorized despite autoRefreshToken:false.
// The actual camera/mic never touches this — it rides WebRTC peer-to-peer.
// ---------------------------------------------------------------------------

export type WatchRoomConnectionState = "idle" | "connecting" | "connected" | "closed" | "error";

type PresenceMeta = {
  userId: string;
  nickname: string;
  role: WatchRoomRole;
};

export type WatchRoomListeners = {
  onSignal?: (signal: WatchRoomSignal) => void;
  onMembersChange?: (members: WatchRoomMember[]) => void;
  onConnectionStateChange?: (state: WatchRoomConnectionState) => void;
};

// Refresh the access token this far (ms) before it expires so the Realtime
// socket never drops mid-movie. autoRefreshToken is off app-wide, so the room
// session refreshes explicitly while it is active.
const REALTIME_AUTH_MARGIN_MS = 60_000;
// How long the initial channel join may take before connect() rejects and the
// caller shows a retry.
const SUBSCRIBE_TIMEOUT_MS = 12_000;
const RECONNECT_MAX_DELAY_MS = 15_000;

export class WatchRoomService {
  private channel: RealtimeChannel | null = null;
  private listeners: WatchRoomListeners = {};
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private hadConnected = false;
  private closedByUser = false;
  private self: PresenceMeta | null = null;
  private room: WatchRoom | null = null;

  setListeners(listeners: WatchRoomListeners) {
    this.listeners = listeners;
  }

  async createRoom(media: WatchRoomMedia, nickname: string): Promise<WatchRoom> {
    const { generateRoomCode } = await import("../utils/watchRoom");
    // A code collision (unique constraint) just means "roll again" — it should
    // never surface to the user as a failed create.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateRoomCode();
      const { data, error } = await supabase.rpc("create_watch_room", {
        p_code: code,
        p_media_type: media.mediaType,
        p_tmdb_id: media.tmdbId,
        p_title: media.title,
        p_nickname: nickname.trim(),
        p_poster_path: media.posterPath ?? null,
        p_backdrop_path: media.backdropPath ?? null,
        p_season_number: media.seasonNumber ?? null,
        p_episode_number: media.episodeNumber ?? null,
        p_imdb_id: media.imdbId ?? null,
        p_year: media.year ?? null,
        p_original_title: media.originalTitle ?? null,
      });
      if (!error) return mapWatchRoomRow(data as WatchRoomRow);
      lastError = error;
      const isCodeCollision =
        (error as { code?: string }).code === "23505" || /duplicate key/i.test(error.message ?? "");
      if (!isCodeCollision) throw error;
    }
    throw lastError;
  }

  async joinRoom(code: string, nickname: string): Promise<WatchRoom> {
    const { data, error } = await supabase.rpc("join_watch_room", {
      p_code: code.trim().toUpperCase(),
      p_nickname: nickname.trim(),
    });
    if (error) throw error;
    return mapWatchRoomRow(data as WatchRoomRow);
  }

  async fetchMembers(roomId: string): Promise<WatchRoomMember[]> {
    const { data, error } = await supabase
      .from("watch_room_members")
      .select("user_id, nickname, role")
      .eq("room_id", roomId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      userId: row.user_id,
      nickname: row.nickname,
      role: row.role as WatchRoomRole,
    }));
  }

  async setStatus(roomId: string, status: WatchRoomStatus): Promise<void> {
    const { error } = await supabase
      .from("watch_rooms")
      .update({ status })
      .eq("id", roomId);
    if (error) throw error;
  }

  async endRoom(roomId: string): Promise<void> {
    // Awaiting the builder resolves to { error } rather than throwing; end is
    // best-effort (the room also auto-expires), so a returned error is ignored.
    await supabase.rpc("end_watch_room", { p_room_id: roomId });
  }

  // Open the Realtime channel and start tracking presence as `self`. Resolves
  // only once the channel is actually SUBSCRIBED — a send fired before that is
  // silently dropped by realtime-js, which is exactly how the first
  // webrtc-ready used to vanish. Rejects on join failure/timeout so the caller
  // can surface a retry instead of a forever-empty lobby.
  async connect(room: WatchRoom, self: PresenceMeta): Promise<void> {
    this.room = room;
    this.self = self;
    this.closedByUser = false;
    this.hadConnected = false;
    this.reconnectAttempts = 0;
    await this.openChannel();
  }

  private async openChannel(): Promise<void> {
    const room = this.room;
    const self = this.self;
    if (!room || !self || this.closedByUser) return;

    this.emitConnectionState("connecting");
    await this.authorizeRealtime();

    // Replace any previous channel; null the field first so the old channel's
    // late status callbacks (CLOSED from removeChannel) are ignored below.
    const stale = this.channel;
    this.channel = null;
    if (stale) {
      await supabase.removeChannel(stale).catch(() => undefined);
    }

    const channel = supabase.channel(watchRoomChannelName(room.code), {
      config: {
        // Private channel: receiving/sending requires the realtime.messages RLS
        // policies from migration 20260710190000 — the join code alone is no
        // longer enough to eavesdrop or inject signals; membership is.
        private: true,
        broadcast: { self: false, ack: false },
        presence: { key: self.userId },
      },
    });

    channel.on("broadcast", { event: "signal" }, (message: any) => {
      const payload = message?.payload as WatchRoomSignal | undefined;
      if (payload && payload.from !== self.userId) {
        this.listeners.onSignal?.(payload);
      }
    });

    channel.on("presence", { event: "sync" }, () => {
      this.emitMembersFromPresence(channel);
    });

    this.channel = channel;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Realtime subscribe timed out"));
        }
      }, SUBSCRIBE_TIMEOUT_MS);

      channel.subscribe(async (status: string) => {
        // A replaced channel keeps emitting while it tears down — ignore it.
        if (this.channel !== channel) return;

        if (status === "SUBSCRIBED") {
          this.hadConnected = true;
          this.reconnectAttempts = 0;
          await channel.track(self);
          this.emitConnectionState("connected");
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.emitConnectionState("error");
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Realtime channel ${status}`));
          } else if (this.hadConnected) {
            // Mid-session flap: rebuild the channel (and re-track presence)
            // rather than waiting on realtime-js internals.
            this.scheduleReconnect();
          }
        } else if (status === "CLOSED") {
          this.emitConnectionState("closed");
          if (settled && this.hadConnected && !this.closedByUser) {
            this.scheduleReconnect();
          }
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, 2_000 * 2 ** Math.min(this.reconnectAttempts, 3));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openChannel().catch(() => this.scheduleReconnect());
    }, delay);
  }

  send(signal: WatchRoomSignal): void {
    void this.channel?.send({ type: "broadcast", event: "signal", payload: signal });
  }

  async disconnect(): Promise<void> {
    this.closedByUser = true;
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      const channel = this.channel;
      this.channel = null;
      await supabase.removeChannel(channel);
    }
    this.emitConnectionState("closed");
  }

  private emitConnectionState(state: WatchRoomConnectionState) {
    this.listeners.onConnectionStateChange?.(state);
  }

  private emitMembersFromPresence(channel: RealtimeChannel) {
    const state = channel.presenceState() as Record<string, PresenceMeta[]>;
    const members: WatchRoomMember[] = [];
    const seen = new Set<string>();
    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        if (entry?.userId && !seen.has(entry.userId)) {
          seen.add(entry.userId);
          members.push({ userId: entry.userId, nickname: entry.nickname, role: entry.role });
        }
      }
    }
    this.listeners.onMembersChange?.(members);
  }

  // Point Realtime at a fresh access token and schedule the next refresh before
  // it expires. Works around the app-wide autoRefreshToken:false.
  private async authorizeRealtime(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    const nowSec = Math.floor(Date.now() / 1000);
    if (session?.expires_at && session.expires_at - nowSec < REALTIME_AUTH_MARGIN_MS / 1000) {
      const refreshed = await supabase.auth.refreshSession().catch(() => null);
      session = refreshed?.data.session ?? session;
    }
    if (!session?.access_token) return;

    supabase.realtime.setAuth(session.access_token);

    if (this.authTimer) clearTimeout(this.authTimer);
    const expiresAtMs = (session.expires_at ?? nowSec + 3600) * 1000;
    const delay = Math.max(REALTIME_AUTH_MARGIN_MS, expiresAtMs - Date.now() - REALTIME_AUTH_MARGIN_MS);
    this.authTimer = setTimeout(() => {
      void this.authorizeRealtime();
    }, delay);
  }
}
