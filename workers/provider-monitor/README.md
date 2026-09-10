# StreamBox Provider Monitor

Cloudflare Worker Cron monitor for streaming provider domains. It reads the current provider URLs from the Supabase `provider_configs` table, checks the endpoints consumed by the app every 12 hours, stores status in KV, and sends Telegram alerts only when a provider changes from healthy to down or from down to recovered.

## What It Checks

- Dizipal home: `base_url/`
- Dizipal search: `base_url/ajax-search?q=breaking%20bad`
- Dizipal playback config: `base_url/bolum/breaking-bad-1-sezon-1-bolum`
- Dizibal site-config API: `base_url/api/site-config/maintenance`
- Dizibal movie-search response shape: `base_url/api/movies?search=shawshank&limit=3`

Dizibal's browser homepage is intentionally not checked because it rejects Cloudflare Worker egress with HTTP 403 even while the JSON APIs used by StreamBox are healthy.

### Why HDFilm is NOT checked here — and what covers it instead

HDFilm is the app's **tier 1** provider, and this monitor cannot see it. It sits behind Cloudflare and challenges Cloudflare Worker egress: from a Worker, both `www.hdfilmcehennemi.nl` and `hdfilmcehennemi.mobi` return **403 "Just a moment…"** on every path (verified with `wrangler dev --remote`, 2026-09-08). GitHub Actions runners are datacenter IPs too and are blocked the same way. Any HDFilm check added here would fail permanently and train everyone to ignore the alerts — the same trap as Dizibal's homepage above.

This is not theoretical. In Sept 2026 HDFilm changed its stream obfuscation, every title on it stopped playing, and **this monitor stayed entirely green** because it has never probed HDFilm at all. The outage surfaced only when a user noticed a series had "disappeared".

Two things cover it instead, both from residential IPs:

- `npm run check:hdfilm` on the user's PC — resolves live titles through the shipped decoder and asserts each produces a real `#EXTM3U` manifest.
- The app's own `player_resolve` telemetry event, which records the provider that served each play. A sustained shift away from `hdfilm`/`direct`, or a jump in `not_found`, is the tier-1 outage signal.

Do not add an HDFilm check here unless it stops challenging Worker egress — and verify that with `wrangler dev --remote` first. Re-verified 2026-09-10: still 403. There is no CI workflow for `check:hdfilm` and there must not be; one existed briefly and was deleted after it produced nothing but false alarms.

### Why `dizipal_playback` exists

Search being healthy says nothing about whether a title can actually PLAY. In Sept 2026 Dizipal renamed `/ajax-player-config` to `/ajax/player-config`: search kept answering 200, every title silently failed to produce a stream, and this monitor stayed green for the entire outage. The app now reads the player config straight out of the episode page's base64 `data-cfg` attribute, so the check decodes that one attribute and asserts it still carries `{v, t}` — one request covering the real playback path.

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

The bot supports two admin-only commands:

```text
/status
/set_dizipal https://dizipal2070.com
```

`/set_dizipal` only updates Supabase after both checks pass:

- `https://new-domain/`
- `https://new-domain/ajax-search?q=breaking%20bad`

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

Status endpoint:

```powershell
Invoke-WebRequest "https://streambox-provider-monitor.<your-subdomain>.workers.dev/"
```
