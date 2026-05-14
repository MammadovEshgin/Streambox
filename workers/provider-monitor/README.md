# StreamBox Provider Monitor

Cloudflare Worker Cron monitor for streaming provider domains. It reads the current Dizipal URL from the Supabase `provider_configs` table, checks its home/search endpoints every 12 hours, stores status in KV, and sends Telegram alerts only when a provider changes from healthy to down or from down to recovered.

## What It Checks

- Dizipal home: `base_url/`
- Dizipal search: `base_url/ajax-search?q=breaking%20bad`

An endpoint is marked down after `FAILURE_THRESHOLD` consecutive failures, default `3`.

## One-Time Setup

The KV namespace has already been created for this repo:

```text
PROVIDER_MONITOR_KV = cc234c82b7094a8e93e444b6df6dbf32
```

If you ever recreate the Worker in another Cloudflare account, run this from this folder and replace the namespace id in `wrangler.jsonc`:

```powershell
cd C:\Users\e.a.mammadov\Desktop\app\workers\provider-monitor
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
