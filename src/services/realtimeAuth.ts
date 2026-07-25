import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Shared Realtime token authorization. Extracted from the battle-tested
// WatchRoomService.authorizeRealtime so every long-lived Realtime subscription
// (watch rooms, the social inbox) refreshes tokens the same way.
//
// The Supabase client is created with autoRefreshToken:false app-wide, so a
// subscription that outlives the ~1h access token must (a) refresh it before it
// expires and (b) push the fresh token into the Realtime socket via setAuth —
// otherwise postgres_changes / private channels silently stop delivering when
// the token lapses. This module owns exactly that.
// ---------------------------------------------------------------------------

// Refresh this far ahead of expiry so the socket never drops mid-session.
export const REALTIME_AUTH_MARGIN_MS = 60_000;
// Retry a failed refresh soon rather than waiting a full token lifetime.
export const REALTIME_AUTH_RETRY_MS = 10_000;

export type RealtimeAuthResult = {
  /** setAuth succeeded and the (possibly refreshed) token is not already expired. */
  ok: boolean;
  /** Epoch ms the current token expires. */
  expiresAtMs: number;
  /** A refresh was needed but failed — schedule a short retry, don't wait a lifetime. */
  refreshFailed: boolean;
};

/**
 * Point the shared Realtime socket at a fresh access token. Call once before
 * subscribing and again on the schedule returned by nextRealtimeAuthDelayMs.
 */
export async function authorizeRealtime(
  marginMs: number = REALTIME_AUTH_MARGIN_MS
): Promise<RealtimeAuthResult> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  let refreshFailed = false;

  if (session?.expires_at && session.expires_at - nowSec <= marginMs / 1000) {
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    if (refreshed?.data.session) session = refreshed.data.session;
    else refreshFailed = true;
  }

  const expiresAtMs = (session?.expires_at ?? nowSec + 3600) * 1000;

  if (!session?.access_token) {
    return { ok: false, expiresAtMs, refreshFailed: true };
  }

  try {
    await supabase.realtime.setAuth(session.access_token);
  } catch {
    return { ok: false, expiresAtMs, refreshFailed: true };
  }

  return { ok: expiresAtMs > nowMs, expiresAtMs, refreshFailed };
}

/** When to next re-authorize: a bit before expiry, or a short retry after a failure. */
export function nextRealtimeAuthDelayMs(input: {
  expiresAtMs: number;
  nowMs: number;
  refreshFailed: boolean;
  marginMs?: number;
}): number {
  if (input.refreshFailed) return REALTIME_AUTH_RETRY_MS;
  const margin = input.marginMs ?? REALTIME_AUTH_MARGIN_MS;
  return Math.max(1_000, input.expiresAtMs - input.nowMs - margin);
}

/** Exponential reconnect backoff (0→1s, 1→2s, 2→4s, capped at 15s). */
export function realtimeReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(15_000, 1_000 * 2 ** Math.min(safeAttempt, 4));
}
