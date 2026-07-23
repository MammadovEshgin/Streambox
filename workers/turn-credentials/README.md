# streambox-turn-credentials

Mints short-lived [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)
credentials for the Watch Together WebRTC layer. The app fetches ICE servers
from `GET /ice` at call setup; the long-lived TURN Token API secret stays here
as a Worker secret and never ships in the app bundle.

## Why a TURN relay at all

WebRTC connects the two phones **directly** whenever it can (lowest latency).
A TURN relay is only used as a fallback when both devices sit behind carrier
NAT that blocks a direct path — common on mobile networks. Without it, a large
share of phone-to-phone calls fail to connect.

## Setup

1. In the Cloudflare dashboard, create a **Realtime → TURN** key. Note the
   **Key ID** and generate an **API Token** for it.
2. Set the secrets:
   ```
   wrangler secret put TURN_KEY_ID
   wrangler secret put TURN_KEY_API_TOKEN
   ```
3. Deploy: `wrangler deploy`
4. Put the deployed URL (+ `/ice`) into the app env as
   `EXPO_PUBLIC_TURN_CREDENTIALS_URL`.

## Response shape

```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": ["turn:turn.cloudflare.com:3478?transport=udp", "..."], "username": "…", "credential": "…" }
  ],
  "ttl": 86400
}
```

Feed `iceServers` straight into `new RTCPeerConnection({ iceServers })`.
