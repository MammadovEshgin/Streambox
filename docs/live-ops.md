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

On device, `src/services/appUpdateService.ts` checks on every cold start and then at most every
5 minutes on foreground. A downloaded update shows a "Restart now / Later" card from
`src/components/common/LiveOpsHost.tsx` (never during playback or over an announcement); if the
user picks Later, the update loads on the next cold start.

To see what a device runs, Settings shows `StreamBox <runtime> · update <first 8 of the update
id> · <published>` at the bottom ("built-in version" for the APK's own bundle). The same id is
`metadata->>'updateId'` on that device's `app_session_started` telemetry events.

A list a screen saved under an older update is shown on the next cold start until its
background refresh lands. When a change alters what a list may contain, bump that screen's
cache key (`home-discovery-v*`, `movies-hub-v*`, `series-hub-v*`) so old lists are discarded.

## Announcements

Announcements are checked after the app is already visible, so they do not slow startup.

Behavior:

- only active announcements are eligible
- higher `priority` wins
- `display_version` lets you intentionally show an updated announcement again
- shown once per signed-in user across devices
- shown once per device for guests
- app version and platform targeting are supported
- an install never sees an announcement that started before it first checked for announcements,
  unless it is a still-running time-boxed campaign (`ends_at` in the future); see
  `src/utils/announcementEligibility.ts`

**Operating rule:** publish every announcement with an `ends_at`. An open-ended one stays
eligible forever for every existing install that has not dismissed it. To retire one:

```sql
update public.app_announcements
   set is_active = false, updated_at = timezone('utc', now())
 where slug = '<slug>';
```

The two open-ended June 2026 announcements (Letterboxd import, June polish) were retired by
migration `20260920120100_retire_june_2026_announcements`.

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

Found streams that would not start and were re-resolved silently (`reason`: `native_stall`,
`dizipal_fallback_empty`, `hdfilm_no_alternative`, or the player error; `source` is what the
retry got — `not_found` means the viewer saw the stream error):

```sql
select date_trunc('day', occurred_at) as day, metadata->>'reason' as reason,
       metadata->>'source' as retry_source, count(*)
from public.app_telemetry_events
where event_name = 'player_silent_retry'
group by 1, 2, 3
order by 1 desc, 4 desc;
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

Remote images (posters, backdrops) that failed to load, with the host and the platform's
error. `CachedRemoteImage` retries a failed load three times, alternating between the
`tmdb.streamboxapp.stream` image proxy and `image.tmdb.org` (the first switch is immediate,
then 5s and 12s); `final` marks the last attempt. At most 12 reports per app session:

```sql
select occurred_at::date as day, metadata->>'host' as host, metadata->>'final' as final,
       metadata->>'error' as error, count(*)
from public.app_telemetry_events
where event_name = 'image_load_failed' and occurred_at > now() - interval '7 days'
group by 1, 2, 3, 4
order by 1 desc, 5 desc;
```

Kült Filmler sessions: whether devices' hidden WebView gets past the site's Cloudflare
challenge (`ready`, with how long it took) or not (`challenge_timeout` after 20s, after which the
provider is set aside for 10 minutes). A timeout carries what the page last reported: `loads: 0`
means the WebView never loaded anything, `visibility: hidden` that it isn't being drawn, and a
`challengeFrame` that stayed means the challenge wants interaction. Plays it served show as
`provider = 'kultfilmler'` in `player_resolve`:

```sql
select occurred_at::date as day, metadata->>'outcome' as outcome, count(*),
       round(avg((metadata->>'ms')::numeric)) as avg_ms,
       max(metadata->>'loads') as loads, max(metadata->>'title') as last_title,
       max(metadata->>'visibility') as visibility, bool_or((metadata->>'challengeFrame')::boolean) as frame
from public.app_telemetry_events
where event_name = 'kultfilmler_session' and occurred_at > now() - interval '7 days'
group by 1, 2
order by 1 desc, 2;
```

Telemetry and audit logs are pruned after 90 days by the `streambox-event-log-cleanup` cron.
