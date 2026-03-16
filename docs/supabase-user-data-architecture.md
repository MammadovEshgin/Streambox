# StreamBox Supabase User Data Architecture

## Goals

This schema is designed to make StreamBox account state portable across devices without relying on local-only storage as the source of truth.

Core goals:

- Keep Supabase Auth as the source of truth for identity, sessions, email verification, password resets, and future MFA.
- Store all user-owned product state in Postgres and Supabase Storage.
- Make every user row tenant-safe through Row Level Security (RLS).
- Keep the data model simple enough for direct app reads, but scalable enough for future Edge Functions, exports, analytics, and admin tooling.
- Avoid fragile one-off JSON blobs for the whole account while still allowing targeted JSON snapshots where schema flexibility is valuable.

## Source-of-truth model

- `auth.users`: login identity, credential lifecycle, verification state, provider metadata.
- `public.user_profiles`: visible profile state and asset pointers.
- `public.user_settings`: theme choice, onboarding completion, future preferences.
- `public.user_media_library`: watchlist, likes, and recently viewed items.
- `public.user_watch_history`: stable watched-state snapshots used for profile and stats.
- `public.user_daily_recommendations`: movie-of-the-day and future recommendation feeds.
- `storage.objects` in bucket `profile-assets`: avatar and banner files.
- `private.rate_limit_windows`: server-only abuse-control state for Edge Functions and future RPC write gates.

## Table overview

### `public.app_themes`

Reference catalog for valid theme IDs. `user_settings.theme_id` references this table so the database never stores unknown theme values.

### `public.user_profiles`

One row per authenticated user.

Primary fields:

- `display_name`
- `bio`
- `location_text`
- `birthday`
- `joined_at`
- `avatar_path`
- `banner_path`
- `avatar_version`
- `banner_version`

Notes:

- Avatar and banner columns store storage object paths, not signed URLs.
- Version counters exist for cache-busting on the client after image replacement.

### `public.user_settings`

One row per authenticated user for cross-device preferences.

Primary fields:

- `theme_id`
- `onboarding_completed_at`
- `preferences` JSONB for forward-compatible app settings

### `public.user_media_library`

Normalized collection table for media saved by a user.

Primary dimensions:

- `list_kind`: `watchlist`, `liked`, `recently_viewed`
- `media_type`: `movie`, `tv`
- `tmdb_id`
- `imdb_id`
- `collected_at`
- `snapshot` JSONB

Why this shape:

- It maps directly to the current app behavior.
- It avoids maintaining separate watchlist and liked tables forever.
- It leaves room for future list kinds without redesigning user state.
- A trigger prunes `recently_viewed` down to the newest 30 items to match the app's current UX.

### `public.user_watch_history`

One row per watched media item and user.

This table stores the current app's stats-driving metadata, including:

- title and poster snapshot
- genres
- runtime / episode count
- vote average
- release year
- top cast and directors
- watched timestamp
- metadata version
- flexible `snapshot` JSONB for future enrichment

Why this is separate from `user_media_library`:

- watched history is not just a list membership
- it drives stats and profile experiences
- it needs a richer snapshot than watchlist and likes

### `public.user_daily_recommendations`

Stores date-keyed recommendation state such as Movie of the Day.

This replaces the local `current` + `history` split with a single append-friendly table keyed by:

- `recommendation_kind`
- `recommendation_date`

## Local app storage mapping

Current local key to database target:

- `@streambox/app-settings-v1` -> `public.user_profiles` + `public.user_settings`
- `streambox/watchlist` -> `public.user_media_library` rows with `list_kind = 'watchlist'` and `media_type = 'movie'`
- `streambox/series-watchlist` -> `public.user_media_library` rows with `list_kind = 'watchlist'` and `media_type = 'tv'`
- `streambox/liked-movies` -> `public.user_media_library` rows with `list_kind = 'liked'` and `media_type = 'movie'`
- `streambox/liked-series` -> `public.user_media_library` rows with `list_kind = 'liked'` and `media_type = 'tv'`
- `streambox/recently-watched` -> `public.user_media_library` rows with `list_kind = 'recently_viewed'`
- `streambox/watch-history` -> `public.user_watch_history`
- `streambox/movie-of-day/current` + `streambox/movie-of-day/history` -> `public.user_daily_recommendations`
- local profile/banner files -> `storage.objects` bucket `profile-assets` plus paths in `public.user_profiles`
- Supabase session in AsyncStorage -> still owned by `auth.users` / Supabase Auth, not duplicated in app tables

## Bootstrap and sync strategy

The migration creates `public.get_my_streambox_bootstrap()` so the mobile app can fetch the account state in one call after sign-in.

Recommended sync flow:

1. Authenticate with Supabase Auth.
2. Call `get_my_streambox_bootstrap()` to hydrate profile, settings, lists, watch history, and daily recommendations.
3. For small changes, write directly to the corresponding tables using the authenticated client.
4. For bulk import, restore, or conflict-heavy writes, prefer an Edge Function that validates payloads and writes in a single transaction.
5. Use `updated_at` as the first conflict-resolution signal and let the database become the source of truth once sync is enabled.

## Security model

### Identity and access

- Every user-owned table has RLS enabled.
- Authenticated users can only read and mutate rows where `auth.uid()` matches the owning `user_id` or `id`.
- Anonymous clients get no access to user data tables.
- Reference data (`app_themes`) is read-only to authenticated users.

### Storage security

- The `profile-assets` bucket is private.
- Policies require the object path to begin with the authenticated user's UUID folder.
- Bucket MIME types are restricted to image formats the app already uses.
- Bucket size is capped to reduce abuse and accidental oversized uploads.

Recommended path convention:

- `{auth.uid()}/avatars/avatar-v{n}.jpg`
- `{auth.uid()}/banners/banner-v{n}.jpg`

### Function hardening

- Security-definer functions pin `search_path` explicitly.
- No function in this migration builds dynamic SQL from user input.
- Server-only helper functions in `private` are not granted to `anon` or `authenticated`.

### SQL injection posture

- The database layer avoids raw dynamic SQL entirely in the exposed path.
- Mobile code should keep using `supabase-js` query builders and RPC calls, never string-concatenated SQL.
- Bulk import or admin workflows should go through validated Edge Functions instead of exposing wide open RPC payload executors.

## Rate limiting and abuse controls

The migration includes `private.rate_limit_windows` plus `public.consume_streambox_rate_limit(...)` as server-side primitives for future Edge Functions.

Important: database schema alone is not enough to fully enforce abuse controls for client-originated traffic. The recommended layered model is:

1. Use Supabase Auth rate limits for signup, OTP, password reset, and token-related abuse.
2. Put bulk restore, profile asset upload orchestration, and any high-write sync endpoints behind Edge Functions.
3. Call `public.consume_streambox_rate_limit(...)` from those server-side functions before processing expensive or burst-prone operations.
4. Clean old rate-limit windows periodically with `public.cleanup_streambox_rate_limit_windows(...)`.

Good candidates for server-side throttling:

- backup restore/import
- initial device-to-cloud migration
- profile image replacement
- bulk watch-history sync
- any future recommendation regeneration endpoint

## Rollout plan

### Phase 1

- Apply the migration.
- Confirm the `profile-assets` bucket and policies exist.
- Verify signup trigger creates `user_profiles` and `user_settings` rows.

### Phase 2

- Build a client sync repository that maps existing AsyncStorage payloads to the new schema.
- Migrate one domain at a time: settings/profile, lists, watch history, daily recommendations, then profile assets.
- Keep local storage as a short-term cache until sync is proven stable.

### Phase 3

- Add server-side restore/import via Edge Function.
- Use the private rate-limit helper for that endpoint.
- Add monitoring around sync failures and storage upload failures.

## Operational recommendations

- Enable email confirmation and strong password policies in Supabase Auth.
- Turn on leaked-password protection and MFA when product requirements allow it.
- Configure Auth rate limits in the Supabase dashboard before public launch.
- Keep the service role key out of the mobile client.
- Use signed URLs for profile/banner reads if the app ever needs to show another user's private assets.
- If social profiles become public later, move public avatars to a separate bucket with different policies instead of weakening the private bucket.

## Reference docs

- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage Access Control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Auth Rate Limits: https://supabase.com/docs/guides/auth/rate-limits