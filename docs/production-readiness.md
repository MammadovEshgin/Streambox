# Production Readiness Checklist

## Required Before 1,000 DAU

- Run the Supabase migrations, including `20260512090000_create_app_telemetry_events.sql`.
- Use `EXPO_PUBLIC_TMDB_PROXY_BASE_URL` in production and keep TMDB keys only as Cloudflare Worker secrets.
- Remove `EXPO_PUBLIC_TMDB_API_KEY` and `EXPO_PUBLIC_TMDB_ACCESS_TOKEN` from EAS production env.
- In Google Cloud Console, set Google Auth Platform audience to `External` and publishing status to `In production` so login is not limited to test users.
- Confirm the Android OAuth client uses the production package name and the release/Play App Signing SHA-1 certificate.
- Enable Cloudflare Worker observability and review logs for `tmdb_proxy_response`, `tmdb_proxy_rate_limited`, and `tmdb_proxy_error`.
- Watch Supabase `app_telemetry_events` for `crash`, `tmdb`, `supabase`, and `performance` categories after release.

## Recommended Plan Settings

- Cloudflare Workers Paid is recommended if traffic approaches the free 100,000 requests/day limit.
- Supabase Pro is recommended for production because it avoids free-project pausing and gives more egress, compute, logs, and backups.
- Keep the Worker rate limit conservative at launch, then tune `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_SECONDS` from real telemetry.

## Useful Queries

Recent crashes:

```sql
select occurred_at, event_name, severity, metadata
from public.app_telemetry_events
where event_category = 'crash'
order by occurred_at desc
limit 50;
```

TMDB/proxy failures:

```sql
select date_trunc('hour', occurred_at) as hour, event_name, metadata->>'status' as status, count(*)
from public.app_telemetry_events
where event_category = 'tmdb'
group by 1, 2, 3
order by 1 desc;
```

Slow startup samples:

```sql
select occurred_at, metadata
from public.app_telemetry_events
where event_name = 'app_ready'
order by (metadata->>'durationMs')::int desc
limit 50;
```
