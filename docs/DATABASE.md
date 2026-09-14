# Streambox database

Canonical reference for the Supabase schema: how it is defined, how to change it, and the
rules that keep it reproducible.

Project ref `zbeexmqmcwtlsbbuuqor` · Postgres 17 · linked via `supabase/.temp/project-ref`.

---

## Layout

| Path | Role |
|---|---|
| `supabase/config.toml` | Project settings, versioned. Local Postgres major version must match prod. |
| `supabase/migrations/20260101000000_baseline_schema.sql` | **The schema.** Complete definition of every object. |
| `supabase/migrations/` (later files) | Incremental changes since the baseline. |
| `supabase/seed.sql` | Reference data only — themes, provider configs, announcements, franchise catalogue, storage buckets. **Never user data.** |
| `supabase/migrations_archive/` | The 39 pre-baseline migrations. Reference only, never replayed. See its README. |
| `supabase/functions/` | Edge functions. |
| `docs/DB_AUDIT_2026-07-28.md` | The audit that produced this structure. |

## The baseline

`20260101000000_baseline_schema.sql` was generated from the production catalog on 2026-07-28
using Postgres' own DDL emitters (`pg_get_functiondef`, `pg_get_indexdef`, `pg_get_viewdef`,
`pg_get_constraintdef`, `pg_get_triggerdef`), so every statement is exactly what production
contains. Verified object-for-object against prod at generation time:

| | Count |
|---|---|
| Tables | 22 (21 `public` + 1 `private`) |
| Enum types | 2 |
| Functions | 37 |
| Views | 2 |
| Indexes (non-constraint) | 50 |
| Constraints (PK/unique/check + FK) | 115 + 20 |
| Triggers | 33 |
| Policies | 43 (`public`/`private`) + 8 (`storage.objects`) |

Section order, which matters:

> types → tables → **functions** → constraints → views → indexes → foreign keys → triggers
> → RLS/policies → privileges

`check_function_bodies = false` lets functions be created before the tables their bodies
reference. **Functions must come before constraints**: `user_watch_history` has a CHECK
constraint calling `cast_gender_array_is_valid()`, and a CHECK expression is resolved when the
constraint is added — `check_function_bodies` does not cover that. Emitting constraints first
fails with `42883`, which is exactly how the first scratch-project replay died.

Verified against prod: no table `DEFAULT` and no expression index references a user-defined
function, so tables can still be created before functions.

**On production the baseline is registered, never executed.** It runs only when building a
fresh database.

### Two deliberate omissions

- **Triggers on `auth.users`** are wrapped in a guarded `DO` block. That table is owned by
  `supabase_auth_admin`; a missing privilege degrades to a notice instead of failing the build.
- **The `external-ratings-hot-refresh` cron job** is not in the baseline — it embeds a project
  URL and invokes an edge function with a per-environment secret. Recreate it per environment.

---

## Changing the schema

1. Iterate against the live database with `supabase db query --linked` until the change is right.
2. `supabase migration new <descriptive_name>` — **never hand-name a migration file.**
3. Confirm the generated timestamp sorts **after** the current remote head. The CLI uses local
   time, which on this machine has produced timestamps in the past; rename if needed or
   `db push` will refuse without `--include-all`.
4. `supabase db advisors --linked --type security` and `--type performance`. Fix what it finds.
5. `supabase db push`.
6. Re-run the advisors and confirm the counts moved the way you expected.

### Rules

- **Never apply DDL through the dashboard SQL editor.** That is precisely what caused the
  2026-07-28 outage: a hand-added RPC overload that no file recorded. If you must hotfix in the
  editor, write the identical migration in the same sitting and `migration repair --status
  applied` it.
- **Never `CREATE OR REPLACE` a function whose signature changed.** Postgres creates a *new
  overload* and leaves the old one. PostgREST resolves RPCs by parameter-*name* set, so two
  overloads sharing a name set make the endpoint permanently unroutable (`PGRST203`, HTTP 300).
  Always `drop function ... (exact, arg, types);` first.
- **Match `on_conflict` targets to a real, non-partial unique index.** PostgREST does not emit
  an index predicate, so Postgres cannot infer a partial index — the write fails with `42P10`.
  This silently emptied `user_daily_recommendations` for months.
- **Upsert needs `UPDATE` privilege and an UPDATE policy**, even when no conflict occurs.
  PostgREST parses it as `INSERT .. ON CONFLICT DO UPDATE` up front. Missing either means every
  write fails.
- **Revoke from `PUBLIC`, not from `anon`.** Postgres grants `EXECUTE` to `PUBLIC` on every new
  function and `anon` inherits it; revoking from `anon` alone is a no-op. Revoke from `PUBLIC`,
  then grant explicitly to `authenticated`.
- **Wrap `auth.uid()` as `(select auth.uid())`** in every policy, so it evaluates once per query
  instead of once per row.
- **`private` is not exposed.** It stays out of `[api].schemas` in `config.toml`.

---

## Verifying a clean rebuild

> **Status: VERIFIED 2026-07-28.** The baseline was replayed onto an empty Supabase project
> (Option B below) and rebuilt the schema exactly — all ten object classes `PASS`, including
> the `auth.users` triggers. The seed loaded 6 themes, 3 provider configs, 3 announcements,
> 22 franchise collections, 258 franchise entries and 2 storage buckets, with **zero** user
> rows. Every audit fix reproduced: 2 RPC overloads (not 3), stale unique indexes absent,
> `security_invoker` on, `PUBLIC` execute revoked, no anon `TRUNCATE`, RLS on
> `rate_limit_windows`, bucket capped, 36 policies hoisted.
>
> The first attempt **failed** with `42883` — constraints were emitted before functions, and
> `user_watch_history`'s CHECK constraint calls `cast_gender_array_is_valid()`. That is the
> bug this exercise existed to catch. Re-verify after any change to the baseline.

This machine has **no Docker and no native `pg_dump`/`psql`**, so `supabase db reset` and
`supabase migration squash` do not run locally. Use Option B.

To re-verify after changing the baseline:

### Option A — local, after installing Docker Desktop

```bash
supabase db reset                                     # fresh local DB from baseline + seed
supabase db query --local -f supabase/verify/object_counts.sql -o csv
```

### Option B — no Docker: a throwaway Supabase project

**Use `--db-url`, not `supabase link`.** Linking rewrites `supabase/.temp/project-ref` *and*
`project_id` in `config.toml`, repointing every subsequent CLI command at the scratch project.
`--db-url` targets one command and leaves the production link untouched.

1. Create a free project at <https://supabase.com/dashboard> — Postgres **17**, to match prod.
   Give it a **plain alphanumeric database password**; anything with `@ : / ? # %` has to be
   percent-encoded inside the connection string.

2. Copy the URI from *Project Settings → Database → Connection string*. If the direct
   `db.<ref>.supabase.co` host fails to resolve, use the **Session pooler** string instead —
   transaction-mode pooling does not support the statements a migration runs.

3. Build it:

   ```bash
   npx supabase db push \
     --db-url "postgresql://postgres:PASSWORD@db.<scratch-ref>.supabase.co:5432/postgres" \
     --include-seed
   ```

4. Check it:

   ```bash
   npx supabase db query \
     --db-url "postgresql://postgres:PASSWORD@db.<scratch-ref>.supabase.co:5432/postgres" \
     -f supabase/verify/object_counts.sql -o csv
   ```

5. Delete the scratch project, and confirm production is still linked:
   `cat supabase/.temp/project-ref` → `zbeexmqmcwtlsbbuuqor`.

### Reading the result

All ten rows must report `PASS`. The one acceptable deviation is
`triggers (all schemas)` returning **31 instead of 33** — the two `auth.users` triggers are
created in a guarded block and are skipped when the build role lacks privilege on that table.
Acceptable on a scratch project; **not** acceptable when rebuilding production for real.

Any other `FAIL` means the baseline is not faithful. The `diff` column shows the direction.

Until this passes, treat the baseline as *very likely* correct rather than *proven* correct.

---

## No-op write suppression

`user_watch_history`, `user_media_library` and `user_episode_progress` each carry an
`aa_skip_noop_update` BEFORE UPDATE trigger that cancels updates which would not change any
content column (`updated_at`/`created_at` excluded from the comparison).

It exists because `backfillSnapshotToRemote()` re-upserts a user's entire watch history on
bootstrap, and PostgREST emits `ON CONFLICT DO UPDATE` with no `WHERE` — so every row was
rewritten even when identical. Measured before the fix: **221,447 updates against 2,325 live
rows (95×), only 1.2% of them HOT**, meaning all 9 of that table's indexes were maintained on
nearly every one.

Two things to keep in mind:

- **The `aa_` prefix is load-bearing.** Postgres fires triggers in alphabetical order, and
  this must run before `set_<table>_updated_at` — otherwise `updated_at` is already stamped
  and every row compares as changed. Do not rename it.
- **`updated_at` now means "last actual change", not "last sync."** Verified safe: nothing in
  the app reads or orders by it, `get_my_streambox_bootstrap` emits it as a payload field
  while ordering by `collected_at`/`watched_at`, and `prune_recently_viewed_library_entries`
  uses it only as a tiebreaker behind a deterministic `tmdb_id`.

Re-measure with `supabase/verify/write_amplification.sql`. pg_stat counters are cumulative
and were not reset, so read the `since_baseline` columns.

## Backups vs. reproducibility

These are different problems and the repo solves only the second.

- **Schema** → the baseline. Rebuildable from git.
- **Reference data** → `supabase/seed.sql`. Rebuildable from git.
- **User data** (auth.users, profiles, settings, watch history, library, episode progress,
  watch rooms, audit logs) → **Supabase backups only.** Nothing in this repo can restore it.

---

## Operational notes

- CLI auth comes from Windows Credential Manager. No token file, no `SUPABASE_ACCESS_TOKEN`,
  no service-role key in `.env`.
- Four scheduled jobs: `external-ratings-alert-capture` (15 min),
  `external-ratings-monitoring-cleanup` (daily), `watch-together-cleanup` (daily),
  `streambox-event-log-cleanup` (daily, 90-day retention on telemetry + audit logs).
  A fifth, `external-ratings-hot-refresh`, exists in prod but not in the baseline (see above).
- `anon` has no grants on user-keyed tables. It retains `SELECT` on the franchise catalogue,
  announcements and provider configs.
- Accepted advisor warnings: 11 × `authenticated_security_definer_function_executable` (the
  intended authenticated RPC surface; `is_watch_room_member` is required by RLS evaluation),
  `pg_net` in `public`, and leaked-password protection. See the audit for reasoning.
