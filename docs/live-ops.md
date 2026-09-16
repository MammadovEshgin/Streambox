# StreamBox Live Ops

Three post-release levers, none of which need a new APK:

1. **EAS Update** for JavaScript, UI, translation and bundled-asset changes.
2. **Supabase announcements** for one-time feature popups.
3. **Telemetry** in `public.app_telemetry_events` to see what happened on devices.

## OTA updates

The app runs a single runtime, `1.2.0`, and listens on EAS branch `preview`. The publish
command, deploy order and deployed-state record are in `ENGINEERING.md` §3.

Use OTA for JavaScript, UI/UX, translations, non-native logic and bundled assets. Use a new
EAS build (and a `runtimeVersion` bump) for native libraries, Android permissions, icons,
splash or any other native config.

On device, `src/services/appUpdateService.ts` checks every 5 minutes and
`src/components/common/LiveOpsHost.tsx` reloads silently on the next background → foreground
transition, never during playback.

## Announcements

Announcements are checked after the app is already visible, so they do not slow startup.

Behavior:

- only active announcements are eligible
- higher `priority` wins
- `display_version` lets you intentionally show an updated announcement again
- shown once per signed-in user across devices
- shown once per device for guests
- app version and platform targeting are supported

### Tables

- `public.app_announcements`
- `public.user_announcement_views`

`image_url` can be either a full URL or a Cloudflare-relative path. Relative paths are resolved with `EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL`, for example `announcements/search-refresh.webp` becomes `https://assets.streamboxapp.stream/announcements/search-refresh.webp`.

### Example insert

```sql
insert into public.app_announcements (
  slug,
  priority,
  is_active,
  display_version,
  title_en,
  title_tr,
  body_en,
  body_tr,
  eyebrow_en,
  eyebrow_tr,
  cta_label_en,
  cta_label_tr,
  cta_url,
  image_url,
  accent_hex,
  starts_at,
  ends_at,
  min_app_version,
  max_app_version,
  platforms,
  requires_auth
) values (
  'search-refresh-week-1',
  100,
  true,
  1,
  'Search just got smarter',
  'Arama artık daha akıllı',
  'We improved filtering and result ranking. Open Search to try the new flow.',
  'Filtreleme ve sonuç sıralamasını geliştirdik. Yeni akışı denemek için Arama bölümünü aç.',
  'New this week',
  'Bu hafta yeni',
  'See what changed',
  'Neler değişti',
  'https://streamboxapp.stream/updates/search',
  null,
  '#22C55E',
  timezone('utc', now()),
  null,
  '1.0.0',
  null,
  array['android'],
  false
);
```

### Re-showing an announcement

If you want users to see a revised version of an older popup, keep the same slug and increment `display_version`.

## Telemetry queries

Run with `npx supabase db query --linked "<sql>"` or in the dashboard SQL editor (read-only).

Recent crashes:

```sql
select occurred_at, event_name, severity, metadata
from public.app_telemetry_events
where event_category = 'crash'
order by occurred_at desc
limit 50;
```

Which source served each play (a shift away from `hdfilm`/`direct`, or a jump in `not_found`, is the tier-1 outage signal):

```sql
select date_trunc('day', occurred_at) as day, metadata->>'source' as source, count(*)
from public.app_telemetry_events
where event_name = 'player_resolve'
group by 1, 2
order by 1 desc, 3 desc;
```

TMDB / proxy failures:

```sql
select date_trunc('hour', occurred_at) as hour, event_name, metadata->>'status' as status, count(*)
from public.app_telemetry_events
where event_category = 'tmdb'
group by 1, 2, 3
order by 1 desc;
```

Sync writes the server kept rejecting and dropped after 8 attempts:

```sql
select occurred_at, metadata
from public.app_telemetry_events
where event_name = 'sync_operation_dead_lettered'
order by occurred_at desc
limit 50;
```

Telemetry and audit logs are pruned after 90 days by the `streambox-event-log-cleanup` cron.
