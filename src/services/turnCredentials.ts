// Fetches WebRTC ICE servers for a Watch Together call. Short-lived TURN
// credentials are minted by the Cloudflare Worker in workers/turn-credentials
// so the TURN API secret never ships in the app. A public STUN server is the
// fallback when the worker URL is unset (direct P2P will still work on many
// networks, just without a relay for symmetric-NAT cases).
//
// The request carries the caller's Supabase access token: once the worker has
// SUPABASE_JWT_SECRET configured it only mints relay credentials for signed-in
// StreamBox users, instead of for anyone who finds the URL (relay bandwidth is
// billed). Until then the worker ignores the header — sending it is free.

import { supabase } from "./supabase";

const TURN_CREDENTIALS_URL = process.env.EXPO_PUBLIC_TURN_CREDENTIALS_URL ?? "";

const STUN_FALLBACK = [{ urls: "stun:stun.l.google.com:19302" }];

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export async function fetchIceServers(): Promise<IceServer[]> {
  if (!TURN_CREDENTIALS_URL) {
    return STUN_FALLBACK;
  }
  try {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const accessToken = data.session?.access_token;
    const response = await fetch(TURN_CREDENTIALS_URL, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (!response.ok) {
      return STUN_FALLBACK;
    }
    const payload = (await response.json()) as { iceServers?: IceServer[] };
    return Array.isArray(payload.iceServers) && payload.iceServers.length > 0
      ? payload.iceServers
      : STUN_FALLBACK;
  } catch {
    return STUN_FALLBACK;
  }
}
