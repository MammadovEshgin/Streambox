# StreamBox Backend Hybrid Architecture

## Goal

Keep Supabase for authenticated user data and small control-plane tables, and move public/static media delivery to Cloudflare. This prevents poster traffic from consuming Supabase cached egress while keeping the app fast and easy to operate.

## Ownership Boundary

Supabase stays responsible for:

- Auth, profiles, user library, watch history, settings, feedback, and announcement metadata.
- Small JSON rows that need RLS, per-user writes, or relational querying.
- Detail-only Edge Function calls where a per-title external rating lookup is worth the cost.

Cloudflare should own:

- Public static assets such as announcement images, future editorial artwork, and non-TMDB marketing assets.
- CDN caching and custom asset domain routing.
- Optional future Workers for read-through public API aggregation if TMDB/proxy load becomes a bottleneck.

TMDB stays responsible for:

- Movie and series posters, backdrops, collection artwork, and logos whenever available.
- Franchise poster imagery. Custom Supabase poster URLs should not be used for franchise browsing.

## Runtime Rules

- List, rail, and grid browsing must not call Supabase Edge rating functions.
- `external-ratings` is reserved for detail pages unless `EXPO_PUBLIC_ENABLE_LIST_EXTERNAL_RATINGS=1` is explicitly set.
- Public asset URLs may be absolute URLs or relative Cloudflare paths. Relative paths are resolved through `EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL`.
- Supabase Storage should not host public poster catalogs. If an image is public and static, it belongs on Cloudflare.

## Cloudflare Setup

R2 must be enabled in the Cloudflare dashboard before buckets can be created through the API. After R2 is enabled:

1. Create a bucket for public StreamBox assets.
2. Attach a custom domain such as `assets.streamboxapp.stream`.
3. Set `EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL=https://assets.streamboxapp.stream`.
4. Store announcement images with stable paths such as `announcements/2026-05-feature.webp`.
5. In Supabase `app_announcements.image_url`, store either the full URL or the relative path.

## Supabase Cleanup

The migration `20260501_remove_azerbaijani_classics.sql` drops the storage-backed Azerbaijani Classics catalog and removes internal-ID user rows. It is destructive and should only be applied after confirming the section is permanently removed from the product.

The migration `20260501160000_remove_franchise_custom_poster_columns.sql` removes `logo_url` and `poster_url` from franchise tables so the app cannot accidentally fall back to Supabase-hosted custom posters. After applying it, delete the old `franchise-posters` Storage bucket from the Supabase dashboard if it still exists.
