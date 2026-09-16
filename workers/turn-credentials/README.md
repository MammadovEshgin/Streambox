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
   wrangler secret put SUPABASE_JWT_SECRET
   ```
   The Worker only mints credentials for a signed-in user's token
   (`role: authenticated` with a `sub`), never for the public anon key.
   ES256/RS256 tokens (asymmetric signing keys) are verified against the
   project JWKS at `SUPABASE_URL` (a var in `wrangler.jsonc`); legacy HS256
   tokens use `SUPABASE_JWT_SECRET` (Supabase dashboard → Settings → API).
   With neither configured the Worker returns 503.
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
  "ttl": 14400
}
```

Feed `iceServers` straight into `new RTCPeerConnection({ iceServers })`.

## Logs

Every request is logged (`head_sampling_rate: 1`). Open the Cloudflare dashboard →
Workers & Pages → `streambox-turn-credentials` → **Observability**, or stream live with
`npx wrangler tail streambox-turn-credentials`. The `event` field tells you what happened:

| event | meaning |
|---|---|
| `issued` | credentials minted for a signed-in user |
| `unauthorized` | no token, the anon key, or a token that failed verification |
| `misconfigured` | a required secret or `SUPABASE_URL` is missing |
| `verify_error` | the JWKS fetch or token parsing threw |
| `cf_error` / `exception` | Cloudflare's TURN API failed |
