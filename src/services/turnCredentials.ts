// Fetches WebRTC ICE servers for a Watch Together call. Short-lived TURN
// credentials are minted by the Cloudflare Worker in workers/turn-credentials
// so the TURN API secret never ships in the app. A public STUN server is the
// fallback when the worker URL is unset (direct P2P will still work on many
// networks, just without a relay for symmetric-NAT cases).

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
    const response = await fetch(TURN_CREDENTIALS_URL);
    if (!response.ok) {
      return STUN_FALLBACK;
    }
    const data = (await response.json()) as { iceServers?: IceServer[] };
    return Array.isArray(data.iceServers) && data.iceServers.length > 0
      ? data.iceServers
      : STUN_FALLBACK;
  } catch {
    return STUN_FALLBACK;
  }
}
