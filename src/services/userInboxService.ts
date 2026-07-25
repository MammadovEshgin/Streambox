import { AppState, type AppStateStatus } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  mapNotification,
  mapWatchInvite,
  type AppNotification,
  type NotificationRow,
  type WatchInvite,
  type WatchInviteRow,
} from "../api/social";
import {
  authorizeRealtime,
  nextRealtimeAuthDelayMs,
  realtimeReconnectDelayMs,
} from "./realtimeAuth";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Social realtime inbox — one app-wide singleton, modeled on WatchRoomService's
// lifecycle (generation guards, explicit token refresh via authorizeRealtime,
// reconnect with backoff). Foreground-only: it subscribes when the app becomes
// active and tears down on background so a backgrounded app holds no socket.
//
// It listens on postgres_changes (RLS applies) for:
//   · user_notifications INSERT (user_id = me)      → onNotification
//   · watch_invites      INSERT (to_user = me)      → onInviteIncoming (popup)
//   · watch_invites      UPDATE (to_user = me)      → onInviteUpdate (cancel/expire)
//   · watch_invites      UPDATE (from_user = me)    → onInviteUpdate (accept/decline)
//
// Screens/overlays that need a hard guarantee against a dead socket poll on
// top of this (NotificationsScreen every 60s; the invite waiting overlay every
// 5s) — Realtime is the fast path, polling is the floor.
// ---------------------------------------------------------------------------

const SUBSCRIBE_TIMEOUT_MS = 12_000;

export type InboxConnectionState = "idle" | "connecting" | "connected" | "error";

export type UserInboxListeners = {
  onNotification?: (notification: AppNotification) => void;
  onInviteIncoming?: (invite: WatchInvite) => void;
  onInviteUpdate?: (invite: WatchInvite) => void;
  onConnectionStateChange?: (state: InboxConnectionState) => void;
};

class UserInboxService {
  private channel: RealtimeChannel | null = null;
  private listeners: Set<UserInboxListeners> = new Set();
  private userId: string | null = null;
  private generation = 0;
  private reconnectAttempts = 0;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionState: InboxConnectionState = "idle";
  private appStateSub: { remove: () => void } | null = null;
  private started = false;

  /** Multiple UI surfaces can listen; returns an unsubscribe. */
  addListener(listener: UserInboxListeners): () => void {
    this.listeners.add(listener);
    // Late subscribers still want the current connection state.
    listener.onConnectionStateChange?.(this.connectionState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getConnectionState(): InboxConnectionState {
    return this.connectionState;
  }

  /** Begin foreground-managed delivery for a signed-in user. Idempotent. */
  start(userId: string): void {
    if (this.started && this.userId === userId) return;
    this.stop();
    this.started = true;
    this.userId = userId;
    this.appStateSub = AppState.addEventListener("change", this.handleAppStateChange);
    if (AppState.currentState === "active") {
      void this.openChannel(++this.generation);
    }
  }

  /** Tear everything down (sign-out / unmount). */
  stop(): void {
    this.started = false;
    this.userId = null;
    this.generation += 1;
    this.reconnectAttempts = 0;
    this.clearTimers();
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
    const channel = this.channel;
    this.channel = null;
    if (channel) void supabase.removeChannel(channel).catch(() => undefined);
    this.emitConnectionState("idle");
  }

  private handleAppStateChange = (state: AppStateStatus) => {
    if (!this.started || !this.userId) return;
    if (state === "active") {
      // Rejoin on foreground; a socket dropped while backgrounded is common.
      if (this.connectionState !== "connected" && this.connectionState !== "connecting") {
        this.reconnectAttempts = 0;
        void this.openChannel(++this.generation);
      }
    } else {
      // Background: drop the socket, keep the listeners + userId so foreground
      // re-subscribes cleanly.
      this.generation += 1;
      this.clearTimers();
      const channel = this.channel;
      this.channel = null;
      if (channel) void supabase.removeChannel(channel).catch(() => undefined);
      this.emitConnectionState("idle");
    }
  };

  private async openChannel(generation: number): Promise<void> {
    const userId = this.userId;
    if (!userId || !this.isActive(generation)) return;

    this.emitConnectionState("connecting");
    const auth = await authorizeRealtime();
    if (!this.isActive(generation)) return;
    if (!auth.ok) {
      this.scheduleReconnect(generation);
      return;
    }
    this.scheduleAuthRefresh(generation, auth);

    const stale = this.channel;
    this.channel = null;
    if (stale) await supabase.removeChannel(stale).catch(() => undefined);
    if (!this.isActive(generation)) return;

    const channel = supabase.channel(`user-inbox:${userId}`, {
      config: { private: false },
    });

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow;
        this.forEachListener((l) => l.onNotification?.(mapNotification(row)));
      }
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "watch_invites", filter: `to_user=eq.${userId}` },
      (payload) => {
        this.forEachListener((l) => l.onInviteIncoming?.(mapWatchInvite(payload.new as WatchInviteRow)));
      }
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "watch_invites", filter: `to_user=eq.${userId}` },
      (payload) => {
        this.forEachListener((l) => l.onInviteUpdate?.(mapWatchInvite(payload.new as WatchInviteRow)));
      }
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "watch_invites", filter: `from_user=eq.${userId}` },
      (payload) => {
        this.forEachListener((l) => l.onInviteUpdate?.(mapWatchInvite(payload.new as WatchInviteRow)));
      }
    );

    this.channel = channel;

    const timer = setTimeout(() => {
      if (this.channel === channel && this.connectionState !== "connected") {
        this.emitConnectionState("error");
        this.scheduleReconnect(generation);
      }
    }, SUBSCRIBE_TIMEOUT_MS);

    channel.subscribe((status) => {
      if (!this.isActive(generation) || this.channel !== channel) return;
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        this.reconnectAttempts = 0;
        this.emitConnectionState("connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        this.emitConnectionState("error");
        this.scheduleReconnect(generation);
      }
    });
  }

  private scheduleReconnect(generation: number): void {
    if (!this.isActive(generation) || this.reconnectTimer) return;
    const delay = realtimeReconnectDelayMs(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isActive(generation)) return;
      void this.openChannel(this.generation);
    }, delay);
  }

  private scheduleAuthRefresh(
    generation: number,
    auth: { expiresAtMs: number; refreshFailed: boolean }
  ): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    const delay = nextRealtimeAuthDelayMs({
      expiresAtMs: auth.expiresAtMs,
      nowMs: Date.now(),
      refreshFailed: auth.refreshFailed,
    });
    this.authTimer = setTimeout(() => {
      if (!this.isActive(generation)) return;
      void authorizeRealtime().then((next) => {
        if (!this.isActive(generation)) return;
        if (next.ok) this.scheduleAuthRefresh(generation, next);
        else this.scheduleReconnect(generation);
      });
    }, delay);
  }

  private clearTimers(): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.authTimer = null;
    this.reconnectTimer = null;
  }

  private isActive(generation: number): boolean {
    return this.started && generation === this.generation;
  }

  private emitConnectionState(state: InboxConnectionState): void {
    this.connectionState = state;
    this.forEachListener((l) => l.onConnectionStateChange?.(state));
  }

  private forEachListener(fn: (listener: UserInboxListeners) => void): void {
    this.listeners.forEach((listener) => {
      try {
        fn(listener);
      } catch {
        // A misbehaving listener must not break delivery to the others.
      }
    });
  }
}

export const userInboxService = new UserInboxService();
