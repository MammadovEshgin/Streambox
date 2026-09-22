# StreamBox Provider Monitor

Cloudflare Worker Cron monitor for streaming provider domains. It reads the current provider URLs from the Supabase `provider_configs` table, checks the endpoints consumed by the app every hour, stores status in KV, and sends Telegram alerts only on transitions (down, rotated, blocked, recovered, scraper-shape change).

## What It Checks

- Dizipal home: `base_url/`
- Dizipal search: `base_url/ajax-search?q=breaking%20bad`
- Dizipal playback config: `base_url/bolum/breaking-bad-1-sezon-1-bolum`
- Dizipal domain (DNS): does a newer `dizipalN` resolve? (DNS-over-HTTPS, 12 suffixes ahead)
- Dizibal search: `base_url/ara/oneri?q=breaking%20bad` (JSON, lists `/series/breaking-bad`)
- Dizibal player: `https://pilavyerplay.top/assets/js/s.php?s=yEILM0ysEtqZE5fmdNHeeg` with the
  Dizibal origin as Referer — Breaking Bad 1×1's player page must carry `window.__PLAYER__`
  with a `stream` URL

### DDoS-Guard and the DNS rotation watch

Since 2026-09-18 (`dizipal2133.com`) Dizipal sits behind DDoS-Guard, which answers every
request from Cloudflare's network `403` ("Error 403", `server: ddos-guard`) while residential
users get `200`. The Worker can then see neither Dizipal's pages nor the old domain's `301` to
the next one — so the bot reported a permanent outage and could not detect a rotation.

- A check refused by DDoS-Guard (or by a Cloudflare challenge that survives the retries) is
  `blocked`: reported once, never counted towards "down".
- Rotations are detected through DNS, which the wall does not cover. Dizipal registers its
  future domains in bulk ahead of time (2134–2150+ were all registered on 2026-07-22) on
  placeholder nameservers that do not serve the zone — they answer SERVFAIL until the day they
  go live. `dizipal_domain` asks Cloudflare DoH (Google DoH as fallback) about the configured
  suffix and the 12 after it; the newest one that resolves is the rotation alert, with the
  `/set_dizipal` to send. If the configured domain stops resolving and nothing newer does, that
  counts towards "down". DoH being unreachable is "unknown", never "down".

### Dizibal's rebuild and IP ban (2026-09-22)

Dizibal rebuilt its site in Sept 2026 (Laravel). The JSON API the app and this monitor used
(`/api/movies`, `/api/series`, `/api/anime`, `/api/site-config/…`, `/api/stream/embed`) is gone —
every route answers `404` — and the app now reads the header search box (`/ara/oneri`), the
watch page, and the "pilavyer" player the page embeds (`s.php?s={data-pv}` → `__PLAYER__`
JSON with an AES-128 HLS `stream` and WebVTT `subs`; some anime use a direct MP4 instead).

The new origin also IP-bans Cloudflare's network: every page answers `403 — Erişim Engellendi`
("Bu IP adresi güvenlik nedeniyle yasaklanmıştır"), while residential users get `200`.
`blockingWall` recognises that page, so `dizibal_search` is `blocked`, never "down". The player
host is not walled, so `dizibal_player` is a real check of the playback half of the chain; it
does not watch redirects (`watchRotation: false`) — the player host moving is not Dizibal
rotating. If Breaking Bad 1×1's `data-pv` slug ever 404s ("Video bulunamadı"), pick a new one
from any episode page.

### Why HDFilm is NOT checked here — and what covers it instead

HDFilm is the app's **tier 1** provider, and this monitor cannot see it. It sits behind Cloudflare and challenges Cloudflare Worker egress: from a Worker, both `www.hdfilmcehennemi.nl` and `hdfilmcehennemi.mobi` return **403 "Just a moment…"** on every path (verified with `wrangler dev --remote`, 2026-09-08). GitHub Actions runners are datacenter IPs too and are blocked the same way. Any HDFilm check added here would fail permanently and train everyone to ignore the alerts — the same trap as Dizibal's IP-banned pages above.

This is not theoretical. In Sept 2026 HDFilm changed its stream obfuscation, every title on it stopped playing, and **this monitor stayed entirely green** because it has never probed HDFilm at all. The outage surfaced only when a user noticed a series had "disappeared".

Two things cover it instead, both from residential IPs:

- `npm run check:hdfilm` on the user's PC — resolves live titles through the shipped decoder and asserts each produces a real `#EXTM3U` manifest.
- The app's own `player_resolve` telemetry event, which records the provider that served each play. A sustained shift away from `hdfilm`/`direct`, or a jump in `not_found`, is the tier-1 outage signal.

Do not add an HDFilm check here unless it stops challenging Worker egress — and verify that with `wrangler dev --remote` first. Re-verified 2026-09-10: still 403. There is no CI workflow for `check:hdfilm` and there must not be; one existed briefly and was deleted after it produced nothing but false alarms.

### Why `dizipal_playback` exists

Search being healthy says nothing about whether a title can actually PLAY. In Sept 2026 Dizipal renamed `/ajax-player-config` to `/ajax/player-config`: search kept answering 200, every title silently failed to produce a stream, and this monitor stayed green for the entire outage. The app reads the player config out of the episode page's `data-cfg` attribute, so the check asserts that attribute still has a known shape — base64 JSON `{v, t}` (until 2026-09-18) or the encrypted `{ciphertext, iv, salt}` JSON written with `&quot;` entities (since) — one request covering the real playback path. While DDoS-Guard walls the Worker off, this check is `blocked` and the app's `player_resolve` telemetry is the playback signal.

The canary is a long-running catalog title at a stable slug. `data-cfg` sits ~44 KiB into a ~95 KiB page, which is why `readLimitedText` reads up to 128 KiB. Verified reachable from Worker egress (`wrangler dev --remote`, 2026-09-02) — all five checks return 200 and the attribute decodes.

An endpoint is marked down after `FAILURE_THRESHOLD` consecutive failures, default `3`.

### Why a challenged request is retried

A challenged request is retried up to `CHALLENGE_RETRIES` (2) times before the endpoint is called down.

On 2026-09-09 Dizipal started serving Cloudflare challenge pages to a *fraction* of requests. This monitor runs every 12 hours and took the first 403 as final, so three consecutive runs each happened to catch one and it paged **"Dizipal is down" for 36 hours** — while the same Worker egress answered 36/36 clean when re-probed by hand minutes later. The app has retried past this interstitial since 2026-09-02 (`PROVIDER_CHALLENGE_RETRIES` in `WebPlayerService.ts`); a monitor that does not model the client it is monitoring reports outages users never see.

Only a genuine interstitial is retried — `isChallengeResponse` inspects the **body**, not just the status — so a real 403 still fails fast instead of tripling the run's latency.

The second cost was worse than the noise. A challenge is served **at** the requested host, so nothing redirects, so `compareOrigins` sees no rotation. Dizipal had in fact rotated **2127 → 2130** underneath, and the 403 hid the one fact that needed acting on. Rotation is now appended to a failure reason rather than replaced by it.

**If you get a provider alert, re-probe from Worker egress before touching provider code:**

```bash
# from a scratch dir with a one-file Worker that fetches the alerting URL
npx wrangler dev --remote
```

An alert naming a symptom the live site does not have is a monitor bug until proven otherwise.

## One-Time Setup

The KV namespace has already been created for this repo:

```text
PROVIDER_MONITOR_KV = cc234c82b7094a8e93e444b6df6dbf32
```

If you ever recreate the Worker in another Cloudflare account, run this from this folder and replace the namespace id in `wrangler.jsonc`:

```powershell
cd \"C:\Users\e.a.mammadov\Desktop\Personal projects\Streambox\workers\provider-monitor\"
npx wrangler kv namespace create PROVIDER_MONITOR_KV
```

Copy the returned namespace `id` into `wrangler.jsonc` under `kv_namespaces[0].id`.

Then set secrets:

```powershell
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put MANUAL_RUN_TOKEN
```

`SUPABASE_URL` is already set in `wrangler.jsonc`.

## Telegram Setup

1. Open Telegram and message `@BotFather`.
2. Create a bot and copy the bot token.
3. Send any message to your new bot.
4. Open this URL in a browser, replacing the token:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

5. Use the numeric `chat.id` as the value for `npx wrangler secret put TELEGRAM_CHAT_ID`.

## Deploy

```powershell
npx wrangler deploy
```

## Telegram Commands

The bot supports three admin-only commands:

```text
/status
/set_dizipal https://dizipal2134.com
/set_dizibal https://dizibal.org
/set_dizipal https://dizipal2134.com force
```

`/status` re-runs every check and reports rotations and scraper-shape changes. A `/set_` command
runs that provider's checks against the new domain (for Dizipal: home, search and the
`data-cfg` playback probe) and updates the Supabase `provider_configs` row when all of them
pass. Installed apps pick the new URL up on their next provider-config refresh.

If the checks fail, the command still saves when the **currently configured** URL redirects to
the new domain, and replies "updated — but it is failing right now" with the failing checks.
The upstream's own 301 is the proof of which domain is live; keeping the old URL would only
put a redirect in front of the same failure. On 2026-09-18 Dizipal's new 2133 host (behind
DDoS-Guard, which blocks the Worker's IPs) answered the Worker 403, and the bot rejected the exact
`/set_dizipal https://dizipal2133.com` its own rotation alert had just suggested. A domain
nothing redirects to, or one that itself redirects further on, is still rejected.

Behind DDoS-Guard even that redirect is invisible, so a candidate whose **only** failures are
`blocked` checks is saved when it resolves in DNS and is not older than the configured domain
(Dizipal only moves forward). Anything else is rejected with the reason and the override:
`/set_dizipal <url> force` saves without the checks passing.

Failure reasons for non-2xx responses carry the page title (`HTTP 403 (page: "…")`) so a
refusal can be told apart as challenge, WAF block or origin error after the fact — the Worker
samples only 10% of its logs, so the reply and the KV state are the only record.

Only the configured `TELEGRAM_CHAT_ID` can use these commands.

## Telegram Webhook

After deploying, connect Telegram to the Worker:

```powershell
Invoke-WebRequest "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" `
  -Method POST `
  -Body @{
    url = "https://streambox-provider-monitor.polyana-eam.workers.dev/telegram"
    secret_token = "<TELEGRAM_WEBHOOK_SECRET>"
  }
```

Check webhook status:

```powershell
Invoke-WebRequest "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

## Manual Test

After deployment:

```powershell
Invoke-WebRequest "https://streambox-provider-monitor.<your-subdomain>.workers.dev/run" `
  -Method POST `
  -Headers @{ "x-monitor-token" = "<MANUAL_RUN_TOKEN>" }
```

Status endpoint (also requires the token; it returns 401 without it):

```powershell
Invoke-WebRequest "https://streambox-provider-monitor.<your-subdomain>.workers.dev/" `
  -Headers @{ "x-monitor-token" = "<MANUAL_RUN_TOKEN>" }
```

`TELEGRAM_WEBHOOK_SECRET` and `MANUAL_RUN_TOKEN` are required. The Worker fails
closed without them: Telegram webhooks are rejected (401) and `/run` and `/`
return 503 until they are set.
