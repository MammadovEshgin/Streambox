# streambox-push-notifications

Cloudflare Worker that forwards StreamBox social notifications to Android push
(Expo Push API). It is the delivery arm of the runtime-1.3.0 social platform:
in-app notifications work without it; this Worker only adds lock-screen /
background pushes.

> **Not deployed by the implementation session.** The user builds the 1.3.0 APK
> and deploys this when ready. Nothing here runs until it is deployed AND the
> Supabase Database Webhook below is created.

## Flow

```
INSERT into public.user_notifications
   │  (Supabase Database Webhook, x-streambox-webhook-secret header)
   ▼
streambox-push-notifications Worker
   │  reads user_push_tokens for the recipient (service role, server-side)
   ▼
Expo Push API  →  FCM  →  device
```

## Deploy

```bash
cd workers/push-notifications
# one-time: set SUPABASE_URL in wrangler.jsonc vars, then the secrets:
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # Supabase → Settings → API
npx wrangler secret put WEBHOOK_SECRET              # any random string
npx wrangler deploy
```

## Create the Supabase Database Webhook

Supabase dashboard → **Database → Webhooks → Create a new hook**:

- Table: `public.user_notifications`
- Events: **Insert**
- Type: **HTTP Request**, method **POST**
- URL: the deployed Worker URL (`https://streambox-push-notifications.<subdomain>.workers.dev`)
- HTTP Header: `x-streambox-webhook-secret` = the same value you set as the
  `WEBHOOK_SECRET` Worker secret.

The webhook posts `{ type: "INSERT", record: <new row>, ... }`; the Worker skips
anything that is not an INSERT with a `user_id`.

## Notes

- The service-role key lives **only** in Worker secrets — the app bundle carries
  only the anon key.
- Expo push receipts are not yet reconciled here (invalid/expired tokens are not
  pruned). A follow-up can read the Expo receipts endpoint and delete dead tokens
  from `user_push_tokens`.
