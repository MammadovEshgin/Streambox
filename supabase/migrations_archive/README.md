# Archived migrations (pre-baseline)

These 39 files are the migration history from `20260309` through `20260728140000`. They are
**preserved for reference only** and are no longer part of the replay path — they were moved
here on 2026-07-28 when the schema was rebaselined as
`supabase/migrations/20260101000000_baseline_schema.sql`.

## Why they were retired

They could not rebuild the database. Specifically:

- `franchise_collections`, `franchise_entries` and `user_franchise_progress` have **no
  `CREATE TABLE`** in any of these files, yet `20260605130000_complete_james_bond_collection.sql`
  inserts into `franchise_entries`. A clean replay failed there.
- Six indexes (`idx_user_media_library_*`, `idx_user_watch_history_*`) and the
  `user_daily_recommendations_*_unique` set existed only in production.
- `20260319_add_internal_id_sync_support.sql` declares `user_media_library_tmdb_unique` and
  `user_watch_history_tmdb_unique` as **partial** (`where tmdb_id is not null`); production had
  them as **total** indexes.
- The `p_internal_id` RPC overloads were added by hand in the SQL editor without dropping the
  older ones, which is what produced the PGRST203 outage fixed on 2026-07-28.

Full analysis: `docs/DB_AUDIT_2026-07-28.md`.

## Do not run these

Two are actively dangerous to replay:

- `20260619_seed_stremio_addon_upstreams.sql` — was `migration repair --status applied` rather
  than executed, because its `provider_configs` upsert resets Dizibal's `base_url` and would
  revert a live Telegram-bot domain rotation.
- The Bond seed migrations assume tables that no file creates.

The current reference data lives in `supabase/seed.sql`.

## Reading them

They remain useful as a record of *why* the schema looks the way it does — the watch-together
platform build-out, the user-email denormalisation, the social platform and its teardown. Git
history for each file is intact (they were moved with `git mv`).
