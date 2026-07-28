-- Remediation for docs/DB_AUDIT_2026-07-28.md
--
-- Safety contract for this migration:
--   * No user row is inserted, updated or deleted. Nothing touches the contents of
--     user_media_library, user_watch_history, user_episode_progress, user_profiles or
--     user_settings — only the objects around them.
--   * No column is dropped, renamed or retyped.
--   * Every index dropped here is either an exact duplicate of another index, fully
--     subsumed by another index, or orphaned by a function dropped in the same
--     transaction. Uniqueness guarantees relied on by any live code path are preserved.
--   * Backward compatible with the 1.0.2 and 1.1.0 fleets: the pre-internal_id RPC
--     overloads are deliberately KEPT.
--   * Idempotent — safe to re-run.
--
-- Everything runs in one transaction, so a failure anywhere rolls the whole thing back.

begin;

-- ---------------------------------------------------------------------------
-- P0-1  Restore media-library / watch-history sync (currently HTTP 300 PGRST203)
-- ---------------------------------------------------------------------------
-- Each of these RPCs has three overloads. Two of them expose an identical SET of
-- parameter names (differing only in order), and PostgREST resolves by name set, so
-- every call from every fleet fails to route.
--
-- Kept:    the SECURITY DEFINER overload with p_internal_id LAST. It branches correctly
--          on tmdb_id vs internal_id, guards auth, and writes user_audit_logs.
-- Kept:    the pre-internal_id overload (8-arg / 21-arg). Different name set, so it does
--          not collide, and it stays as a compatibility shim.
-- Dropped: the hand-written INVOKER overload with p_internal_id in the middle. It is the
--          one that created the collision, and it silently dropped audit logging.
--
-- Dropping by exact signature — no other overload can match these argument lists.

drop function if exists public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, uuid, text, timestamptz, jsonb, jsonb
);

drop function if exists public.sync_streambox_watch_history_entry(
  public.media_type, bigint, uuid, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb
);

-- Those two functions were the only consumers of the coalesce() sync indexes. The
-- uniqueness they enforced is fully covered by the tmdb/internal unique indexes that
-- remain (a bigint tmdb_id and a uuid can never collide as text), so dropping them
-- removes write overhead without weakening any real invariant.
drop index if exists public.idx_user_media_library_sync;
drop index if exists public.idx_user_watch_history_sync;

-- ---------------------------------------------------------------------------
-- P0-2  user_daily_recommendations: remove the conflict-target contradiction
-- ---------------------------------------------------------------------------
-- The primary key is (user_id, recommendation_kind, recommendation_date) — one
-- recommendation per user/kind/day. The extra 4-column uniques are strictly weaker than
-- that PK, are unreachable via PostgREST (they are partial, so on_conflict= cannot infer
-- them), and have never been scanned. The app is being changed to send the 3-column PK
-- target; these only exist to make that ambiguous.
drop index if exists public.user_daily_recommendations_tmdb_unique;
drop index if exists public.user_daily_recommendations_internal_unique;
drop index if exists public.user_daily_recommendations_none_unique;

-- ---------------------------------------------------------------------------
-- P2-7  user_announcement_views: upserts have always failed silently
-- ---------------------------------------------------------------------------
-- announcementsService.ts upserts with onConflict=user_id,announcement_id,display_version.
-- PostgREST implements that as INSERT .. ON CONFLICT DO UPDATE, which requires the UPDATE
-- privilege AND an UPDATE policy at parse time — regardless of whether a conflict occurs.
-- The table had neither, so every write failed and was swallowed by a console.warn
-- (n_tup_ins = 0 for the life of the table). Add the missing half of the pair.
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.user_announcement_views'::regclass
      and polname = 'user_announcement_views_update_own'
  ) then
    create policy user_announcement_views_update_own
      on public.user_announcement_views
      for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

grant update on public.user_announcement_views to authenticated;

-- ---------------------------------------------------------------------------
-- P1-1  Views must not bypass RLS
-- ---------------------------------------------------------------------------
-- external_ratings_active_alerts ran as its owner (postgres) and was granted to anon, so
-- unauthenticated callers could read data the base table correctly denies them.
alter view public.external_ratings_active_alerts set (security_invoker = on);
revoke all on public.external_ratings_active_alerts from anon, authenticated;

-- admin_user_directory is already service_role-only; make its semantics explicit too.
alter view public.admin_user_directory set (security_invoker = on);
revoke all on public.admin_user_directory from anon, authenticated;

-- ---------------------------------------------------------------------------
-- P1-2  Cron-only maintenance functions must not be REST endpoints
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default, which anon inherits. These are all
-- SECURITY DEFINER; one of them deletes data and one manipulates cron.job.
-- pg_cron runs them as the job owner, which is unaffected by these revokes.
-- Signatures below were read back from pg_proc; ensure_external_ratings_jobs and
-- get_hot_external_ratings_candidates take arguments despite being callable with none
-- (they have defaults), so the no-arg forms would not resolve.
revoke execute on function public.capture_external_ratings_alerts()                        from public, anon, authenticated;
revoke execute on function public.cleanup_external_ratings_monitoring(integer)             from public, anon, authenticated;
revoke execute on function public.ensure_external_ratings_jobs(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_hot_external_ratings_candidates(integer)             from public, anon, authenticated;
revoke execute on function public.rls_auto_enable()                                        from public, anon, authenticated;

-- Trigger-only helpers; never called over REST.
revoke execute on function public.make_streambox_entity_key(public.media_type, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.provider_configs_set_updated_at()                          from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- P1-3  SECURITY DEFINER + mutable search_path, reachable by anon
-- ---------------------------------------------------------------------------
-- Pin search_path on the surviving DEFINER RPCs so they cannot be redirected via an
-- attacker-controlled search_path, and drop the anon EXECUTE grant (they already raise
-- 'not authenticated' when auth.uid() is null, so no working caller is affected).
alter function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb, uuid
) set search_path = public, pg_temp;

alter function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb, uuid
) set search_path = public, pg_temp;

alter function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb, uuid
) set search_path = public, pg_temp;

-- The pre-internal_id compatibility overloads get the same treatment.
alter function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb
) set search_path = public, pg_temp;

alter function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb
) set search_path = public, pg_temp;

alter function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb
) set search_path = public, pg_temp;

revoke execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb, uuid
) from anon;
revoke execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb, uuid
) from anon;
revoke execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb, uuid
) from anon;
revoke execute on function public.sync_streambox_episode_progress(
  bigint, integer, integer, boolean, timestamptz, jsonb, jsonb
) from anon;

-- ---------------------------------------------------------------------------
-- P1-4  Replace GRANT ALL (incl. TRUNCATE) with least privilege
-- ---------------------------------------------------------------------------
-- Grants below are derived from the actual call sites:
--   franchise_collections / franchise_entries  -> read-only catalogue (api/franchises.ts)
--   user_franchise_progress                    -> select + insert + delete (no UPDATE path)
--   watch_rooms                                -> select + update(status) + delete(host)
--   watch_room_members                         -> select only (join/leave go through RPCs)
--   watch_room_memories                        -> select + insert (delete via remove_watch_memory)
revoke all on public.franchise_collections   from anon, authenticated;
revoke all on public.franchise_entries       from anon, authenticated;
revoke all on public.user_franchise_progress from anon, authenticated;
revoke all on public.watch_rooms             from anon, authenticated;
revoke all on public.watch_room_members      from anon, authenticated;
revoke all on public.watch_room_memories     from anon, authenticated;

grant select on public.franchise_collections to anon, authenticated;
grant select on public.franchise_entries     to anon, authenticated;

grant select, insert, delete on public.user_franchise_progress to authenticated;
grant select, update, delete on public.watch_rooms             to authenticated;
grant select                 on public.watch_room_members      to authenticated;
grant select, insert         on public.watch_room_memories     to authenticated;

-- user_franchise_progress has select/insert/delete policies but no UPDATE policy, and the
-- app has no update path. The UPDATE privilege is therefore not granted above — an
-- update would otherwise silently affect zero rows, which is worse than an error.

-- ---------------------------------------------------------------------------
-- P1-5  RLS on the one table that lacks it
-- ---------------------------------------------------------------------------
-- private.rate_limit_windows is unreachable (the private schema grants nothing to
-- anon/authenticated) but it is the only table in the database without RLS. Defense in
-- depth. consume_streambox_rate_limit is SECURITY DEFINER and owned by a bypassrls role,
-- so it keeps working with no policy present.
alter table private.rate_limit_windows enable row level security;

-- ---------------------------------------------------------------------------
-- P1-6  Bound the watch-memories storage bucket
-- ---------------------------------------------------------------------------
-- profile-assets is capped at 8 MiB and image-only; watch-memories accepted unlimited
-- size and any MIME type. It only ever holds polaroid images.
-- Existing objects are not touched — these limits apply to new uploads.
update storage.buckets
   set file_size_limit    = 8388608,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'watch-memories';

-- ---------------------------------------------------------------------------
-- P2-1  Hoist auth.uid() out of per-row RLS evaluation
-- ---------------------------------------------------------------------------
-- Wrapping in a scalar subquery turns a per-row function call into a one-shot InitPlan.
-- ALTER POLICY swaps the expression atomically, so there is never a window in which a
-- table is unprotected. The predicates are otherwise byte-identical.

alter policy app_telemetry_events_insert_own on public.app_telemetry_events
  with check ((user_id is null) or (user_id = (select auth.uid())));

alter policy user_announcement_views_select_own on public.user_announcement_views
  using (user_id = (select auth.uid()));
alter policy user_announcement_views_insert_own on public.user_announcement_views
  with check (user_id = (select auth.uid()));

alter policy user_audit_logs_select_own on public.user_audit_logs
  using (user_id = (select auth.uid()));
alter policy user_audit_logs_insert_own on public.user_audit_logs
  with check (user_id = (select auth.uid()));

alter policy user_profiles_select_own on public.user_profiles
  using (id = (select auth.uid()));
alter policy user_profiles_insert_own on public.user_profiles
  with check (id = (select auth.uid()));
alter policy user_profiles_update_own on public.user_profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy user_settings_select_own on public.user_settings
  using (user_id = (select auth.uid()));
alter policy user_settings_insert_own on public.user_settings
  with check (user_id = (select auth.uid()));
alter policy user_settings_update_own on public.user_settings
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter policy user_media_library_select_own on public.user_media_library
  using (user_id = (select auth.uid()));
alter policy user_media_library_insert_own on public.user_media_library
  with check (user_id = (select auth.uid()));
alter policy user_media_library_update_own on public.user_media_library
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy user_media_library_delete_own on public.user_media_library
  using (user_id = (select auth.uid()));

alter policy user_watch_history_select_own on public.user_watch_history
  using (user_id = (select auth.uid()));
alter policy user_watch_history_insert_own on public.user_watch_history
  with check (user_id = (select auth.uid()));
alter policy user_watch_history_update_own on public.user_watch_history
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy user_watch_history_delete_own on public.user_watch_history
  using (user_id = (select auth.uid()));

alter policy user_daily_recommendations_select_own on public.user_daily_recommendations
  using (user_id = (select auth.uid()));
alter policy user_daily_recommendations_insert_own on public.user_daily_recommendations
  with check (user_id = (select auth.uid()));
alter policy user_daily_recommendations_update_own on public.user_daily_recommendations
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy user_daily_recommendations_delete_own on public.user_daily_recommendations
  using (user_id = (select auth.uid()));

alter policy user_episode_progress_select_own on public.user_episode_progress
  using (user_id = (select auth.uid()));
alter policy user_episode_progress_insert_own on public.user_episode_progress
  with check (user_id = (select auth.uid()));
alter policy user_episode_progress_update_own on public.user_episode_progress
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy user_episode_progress_delete_own on public.user_episode_progress
  using (user_id = (select auth.uid()));

alter policy user_franchise_progress_select on public.user_franchise_progress
  using ((select auth.uid()) = user_id);
alter policy user_franchise_progress_insert on public.user_franchise_progress
  with check ((select auth.uid()) = user_id);
alter policy user_franchise_progress_delete on public.user_franchise_progress
  using ((select auth.uid()) = user_id);

alter policy watch_rooms_update_host on public.watch_rooms
  using (host_user_id = (select auth.uid())) with check (host_user_id = (select auth.uid()));
alter policy watch_rooms_delete_host on public.watch_rooms
  using (host_user_id = (select auth.uid()));

alter policy watch_room_members_delete_own on public.watch_room_members
  using (user_id = (select auth.uid()));

alter policy watch_room_memories_select_participant on public.watch_room_memories
  using (((select auth.uid()) = any (participant_user_ids)) or is_watch_room_member((room_id)::text));
alter policy watch_room_memories_insert_participant on public.watch_room_memories
  with check ((created_by = (select auth.uid())) and is_watch_room_member((room_id)::text));

-- ---------------------------------------------------------------------------
-- P2-3 / P2-4  Duplicate and subsumed indexes
-- ---------------------------------------------------------------------------
-- Each drop below leaves an index with identical or broader coverage in place, so no
-- query plan loses an access path. All of these are pure write overhead today.

-- Byte-identical to user_audit_logs_user_action_occurred_idx.
drop index if exists public.user_audit_logs_action_type_idx;

-- Byte-identical to franchise_entries_franchise_order_idx.
drop index if exists public.idx_franchise_entries_watch_order;

-- Same four columns in the same order as user_episode_progress_pkey.
drop index if exists public.user_episode_progress_lookup_idx;

-- Non-unique copies of idx_user_media_library_internal / idx_user_watch_history_internal,
-- which are UNIQUE over the same columns with the same predicate.
drop index if exists public.user_media_library_user_internal_lookup_idx;
drop index if exists public.user_watch_history_user_internal_lookup_idx;

-- ---------------------------------------------------------------------------
-- P2-5  Index the foreign keys that lack one
-- ---------------------------------------------------------------------------
-- watch_room_memories.room_id is used by an RLS predicate and by the ON DELETE SET NULL
-- action; watch_rooms.host_user_id backs the host UPDATE/DELETE policies. Both were
-- doing sequential scans.
create index if not exists watch_room_memories_room_idx          on public.watch_room_memories (room_id);
create index if not exists watch_room_memories_created_by_idx    on public.watch_room_memories (created_by);
create index if not exists watch_rooms_host_idx                  on public.watch_rooms (host_user_id);
create index if not exists user_announcement_views_announcement_idx on public.user_announcement_views (announcement_id);
create index if not exists user_settings_theme_idx               on public.user_settings (theme_id);

-- ---------------------------------------------------------------------------
-- P2-6  Bound the unbounded log tables
-- ---------------------------------------------------------------------------
-- app_telemetry_events and user_audit_logs grow forever; only the external-ratings tables
-- had a retention job. 90 days is deliberately generous: the oldest telemetry row today
-- is ~75 days old, so scheduling this deletes NOTHING now. It only bounds future growth.
create or replace function public.cleanup_streambox_event_logs(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cutoff timestamptz := timezone('utc', now()) - make_interval(days => greatest(p_retention_days, 30));
  removed integer := 0;
  n integer := 0;
begin
  delete from public.app_telemetry_events where inserted_at < cutoff;
  get diagnostics n = row_count;
  removed := removed + n;

  delete from public.user_audit_logs where occurred_at < cutoff;
  get diagnostics n = row_count;
  removed := removed + n;

  return removed;
end;
$$;

-- Cron-only, exactly like the other maintenance functions.
revoke execute on function public.cleanup_streambox_event_logs(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refresh planner statistics
-- ---------------------------------------------------------------------------
-- No table in this database has ever had a manual ANALYZE, and several have stale
-- autoanalyze timestamps. This only rebuilds statistics — it does not touch rows.
analyze public.user_watch_history;
analyze public.user_media_library;
analyze public.user_episode_progress;
analyze public.user_daily_recommendations;
analyze public.app_telemetry_events;
analyze public.user_audit_logs;
analyze public.watch_rooms;
analyze public.watch_room_members;
analyze public.watch_room_memories;

commit;

-- ---------------------------------------------------------------------------
-- Schedule the retention job (cron.schedule manages its own transaction)
-- ---------------------------------------------------------------------------
select cron.schedule(
  'streambox-event-log-cleanup',
  '45 3 * * *',
  $$select public.cleanup_streambox_event_logs(90);$$
);
