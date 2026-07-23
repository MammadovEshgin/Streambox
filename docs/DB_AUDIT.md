# Streambox Supabase schema audit

_Date: 2026-07-02 — companion to migration `20260702090000_add_user_emails_to_user_tables.sql` (written, **not applied**; the user runs it)._

Scope: every user-keyed table, its purpose, keys/conflict targets (cross-checked against the app's
upsert code in `src/services/userDataSync.ts`), indexes, RLS posture, and the smells found while
tracing the watch-history data-loss bug. Only additive, low-risk items were implemented; the rest
are recommendations.

## 1. Table inventory

| Table | Purpose | Primary key / uniqueness | RLS |
|---|---|---|---|
| `public.user_profiles` | Display name, bio, avatar/banner paths & versions | PK `id` (= `auth.users.id`) | select/insert/update own |
| `public.user_settings` | Theme + preferences JSON | PK `user_id` | select/insert/update own |
| `public.user_media_library` | Watchlist / liked / recently-viewed rows | **PK dropped** in `20260319`; two partial unique indexes: `(user_id, list_kind, media_type, tmdb_id) where tmdb_id is not null` and `(user_id, list_kind, media_type, internal_id) where internal_id is not null`; CHECK: one of `tmdb_id`/`internal_id` present | select/insert/update/delete own |
| `public.user_watch_history` | Watched titles & seasons (denormalized cast/director arrays) | **PK dropped** in `20260319`; partial uniques `(user_id, media_type, tmdb_id)` / `(user_id, media_type, internal_id)`; same CHECK | select/insert/update/delete own |
| `public.user_daily_recommendations` | Movie-of-the-day current + history | PK `(user_id, recommendation_kind, recommendation_date)` | select/insert/update/delete own |
| `public.user_episode_progress` | Per-episode watched flags | PK `(user_id, series_tmdb_id, season_number, episode_number)` | select/insert/update/delete own |
| `public.user_audit_logs` | App event audit trail | PK `id` identity | select/insert own |
| `public.user_announcement_views` | Live-ops announcement seen-markers | see `20260331` | select/insert own |
| `private.rate_limit_windows` | RPC rate limiting | PK `(user_id, action_key, window_started_at)` | private schema (no client access) |
| `public.user_franchise_progress` | Franchise timeline progress (conditionally present) | `(user_id, entry_id)` via index | n/a here |

Both `user_display_name` (migration `20260402`) and now `user_email` (`20260702090000`) are
denormalized onto all of these via `security definer` BEFORE-triggers + a propagation trigger, so
manual inspection doesn't require joining `auth.users`. The email resolver is EXECUTE-granted to
`service_role` **only**; clients can never resolve an arbitrary uuid to an email, and RLS
select-own policies mean a user can only ever see the email on their own rows. The new
`public.admin_user_directory` view (uuid → email + display name) is likewise `service_role`-only.

## 2. App upsert conflict targets vs. schema (cross-check)

From `userDataSync.ts` (`batchUpsertRows` / `upsertRowsInChunks` / direct upserts):

| App call | Conflict target sent | Schema match? |
|---|---|---|
| `user_profiles` upsert | `id` | ✅ PK |
| `user_settings` upsert | `user_id` | ✅ PK |
| `user_media_library` batch | `user_id,list_kind,media_type` + `tmdb_id` or `internal_id` | ⚠️ only **partial** unique indexes exist (see finding F1) |
| `user_watch_history` batch | `user_id,media_type` + `tmdb_id` or `internal_id` | ⚠️ same (F1) |
| `user_episode_progress` upsert | `user_id,series_tmdb_id,season_number,episode_number` | ✅ PK |
| `user_daily_recommendations` | `user_id,recommendation_kind,recommendation_date` (+`tmdb_id`/`internal_id` in the queued-op path) | ⚠️ PK is the 3-column form; the 4-column variant has **no** matching unique index (F2) |

## 3. Findings

### F1 — PostgREST upserts against partial unique indexes (verify on prod)
`20260319` dropped the composite PKs on `user_media_library` / `user_watch_history` and replaced
them with **partial** unique indexes (`where tmdb_id is not null` / `where internal_id is not
null`). Postgres only infers a partial unique index for `ON CONFLICT` when the conflict clause
includes the index predicate — which PostgREST's `on_conflict=` parameter does not emit. If prod
matches these migrations exactly, the bulk-backfill paths (`backfillSnapshotToRemote`) would fail
with `42P10` while the per-entry RPC paths (`sync_streambox_*`) keep working. The day-to-day sync
queue only uses RPCs, so users wouldn't notice — but initial-device backfill silently degrades.

**Verify** (read-only, run in the SQL editor):
```sql
select indexname, indexdef from pg_indexes
where tablename in ('user_media_library','user_watch_history');
```
**Recommended fix if the indexes are still partial:** add total unique indexes on coalesced keys or
reinstate non-partial uniques for the tmdb branch, e.g.
`create unique index ... on user_watch_history (user_id, media_type, tmdb_id) where tmdb_id is not null;` →
replace with a non-partial expression index such as
`(user_id, media_type, coalesce(tmdb_id, -1), coalesce(internal_id, '00000000-0000-0000-0000-000000000000'))`.
Not implemented here: it changes uniqueness semantics and needs prod verification first.

### F2 — `user_daily_recommendations` queued-op conflict target
`executePendingOperation` upserts with
`onConflict: "user_id,recommendation_kind,recommendation_date,tmdb_id|internal_id"` but the PK is
the 3-column `(user_id, recommendation_kind, recommendation_date)`. A 4-column conflict clause has
no matching unique index and would 42P10. Low impact (recommendations are re-derivable), but the
app code should send the 3-column target. Not changed in this pass to keep the diff scoped; safe
one-line follow-up in `userDataSync.ts`.

### F3 — The watch-history full-replace prune (FIXED in app code, this branch)
`syncCurrentWatchHistoryToSupabase` upserted the entire in-memory list and **deleted every remote
`user_watch_history` row not present in it**, and ran on *every single* save/remove. Any call with
a stale/partial list (freshly mounted hook, mid-batch abort) pruned real data — this is what
deleted watched movies when logging a series. The function is now removed; deletions flow only
through the explicit per-entry RPC (`delete_streambox_watch_history_entry`) via the durable queue.
No schema change needed. Guard test: `tests/watchHistorySyncArchitecture.test.ts`.

### F4 — Orphan-row risk: none found
All user tables reference `auth.users(id) on delete cascade` (directly or via `user_profiles`), so
account deletion cleans up. `external_ratings_cache`, `provider_configs`, `app_announcements` are
global (not user-keyed) by design.

### F5 — Indexing
`user_id` access paths are covered everywhere (PKs lead with `user_id`; `20260511120000` added
`updated_at`-ordered and `internal_id` partial lookups). The new `user_email` columns are
deliberately **not** indexed: they exist for human inspection, not query paths, and indexing PII
adds surface for no app benefit. `admin_user_directory` gives an indexed entry point (via
`auth.users` PK) when an admin needs email → uuid.

### F6 — Inconsistent `updated_at` handling (minor)
Some tables maintain `updated_at` via trigger, others rely on the app sending it. Cosmetic;
recommend a single `moddatetime` trigger pattern in a future pass. Not implemented (touches
existing rows' semantics).

## 4. What the new migration does (and does not do)

Does: adds nullable `user_email text` to the nine user tables; `resolve_streambox_user_email`
(security definer, `service_role`-exec only) reading `auth.users.email`; BEFORE insert/update-of-
`user_id` triggers that always overwrite from the resolver; a defensive AFTER-update-of-email
trigger on `auth.users` (errors swallowed, and trigger creation itself degrades to a NOTICE if the
migration role lacks privilege); full backfill; `admin_user_directory` view gated to
`service_role`.

Does not: touch any RLS policy, drop/rename anything, add NOT NULL/defaults to email, index PII,
or change any conflict target the app relies on. Idempotent throughout — safe to re-run.

## 5. How to apply

The migration is a file only. Apply it yourself (e.g. Supabase SQL editor, or your usual migration
flow). Per repo guardrails, no `supabase db push` was run and nothing has touched prod.
