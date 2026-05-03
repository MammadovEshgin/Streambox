# StreamBox Live Ops

This project now supports two post-release live-ops layers:

1. EAS Update for JavaScript, UI, translation, and bundled-asset changes.
2. Supabase-managed one-time announcements for feature popups.

## OTA updates

Configured pieces:

- `expo-updates`
- `runtimeVersion.policy = appVersion`
- EAS update URL in `app.config.js`
- channels in `eas.json`
  - `development`
  - `preview`
  - `production`

### Use OTA when

- changing React Native / Expo JavaScript
- improving UI or UX
- updating translations
- shipping non-native logic changes
- publishing bundled assets

### Use a new store build when

- adding or removing a native library
- changing Android/iOS permissions
- changing icons, splash, or native config
- changing anything that affects the native runtime

### Release commands

First production build:

```bash
npx eas-cli build --platform android --profile production
```

Future production OTA updates:

```bash
npx eas-cli update --branch production --message "Describe the release"
```

Future preview OTA updates:

```bash
npx eas-cli update --branch preview --message "Preview update"
```

By default, EAS channels map to branches with the same name.

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
