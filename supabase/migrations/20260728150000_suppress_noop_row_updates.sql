-- Stop rewriting rows whose contents did not change.
--
-- Measured on production 2026-07-28:
--
--   table                    inserts   updates   live rows   updates/row   HOT
--   user_watch_history         3,689   221,447       2,325         95.2x   1.2%
--   user_media_library         1,926    20,328       1,203         16.9x   9.6%
--   user_episode_progress      1,817    10,378       1,652          6.3x  60.1%
--
-- Cause: backfillSnapshotToRemote() re-upserts the user's ENTIRE watch history through
-- PostgREST on bootstrap. Those land as ON CONFLICT DO UPDATE with no WHERE clause, so
-- every row is rewritten even when every column is identical. It is NOT the per-entry
-- RPC -- that writes an audit row per call, and user_audit_logs holds 137 rows, not 221k.
--
-- The cost of a no-op rewrite is not just the tuple: user_watch_history carries 9
-- indexes and only 1.2% of its updates were HOT. Non-HOT means every one of those
-- indexes is maintained. The HOT rate is that low because set_updated_at bumps
-- updated_at on every update and user_watch_history_user_updated_idx indexes it, so no
-- update can ever qualify for the HOT optimisation.
--
-- Fix: a BEFORE UPDATE trigger that returns NULL when the row is unchanged. Returning
-- NULL cancels the update outright -- no new tuple version, no index maintenance, no
-- later triggers, and no dead row for autovacuum to collect.
--
-- Why a trigger rather than adding WHERE to the RPCs' DO UPDATE:
--   1. The dominant writer is PostgREST, which cannot emit DO UPDATE ... WHERE.
--   2. It covers every path uniformly -- RPC, bulk upsert, anything added later.
--   3. It avoids recreating two 6 KB SECURITY DEFINER functions. Recreating a function
--      whose signature shifts is exactly what caused the PGRST203 outage; leaving them
--      untouched is the lower-risk option.
--
-- Safety review of suppressing the updated_at bump (each point verified against prod):
--   * The app never reads or orders by updated_at -- no client dependency exists.
--   * get_my_streambox_bootstrap emits updatedAt as a payload field only; it orders by
--     collected_at / watched_at / recommendation_date.
--   * prune_recently_viewed_library_entries uses it as a tiebreaker in
--     (collected_at desc, updated_at desc, tmdb_id desc) -- tmdb_id keeps that ordering
--     deterministic regardless.
--   * Nothing uses updated_at as an incremental-sync watermark.
--   After this change updated_at means "last actual change" rather than "last sync",
--   which is the more useful of the two definitions.
--
-- No user data is modified. Reversible by dropping the three triggers.

begin;

create or replace function public.skip_noop_row_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- updated_at and created_at are bookkeeping, not content. Comparing via jsonb handles
  -- arrays and jsonb columns correctly: array order is preserved (which matters -- the
  -- cast_*/director_* arrays are positionally aligned and constrained to equal length)
  -- while jsonb key order is normalised, so a re-serialised snapshot does not read as a
  -- change.
  if (to_jsonb(new) - 'updated_at' - 'created_at')
   = (to_jsonb(old) - 'updated_at' - 'created_at') then
    return null;
  end if;
  return new;
end;
$$;

comment on function public.skip_noop_row_update() is
  'BEFORE UPDATE guard: cancels updates that would not change any content column. See migration 20260728150000.';

-- Trigger-only; never called over REST.
revoke all on function public.skip_noop_row_update() from public, anon, authenticated;

-- The "aa_" prefix is deliberate. Postgres fires triggers in alphabetical order, and
-- this must run before set_<table>_updated_at -- otherwise that trigger would already
-- have stamped a fresh updated_at and every row would compare as changed.
drop trigger if exists aa_skip_noop_update on public.user_watch_history;
create trigger aa_skip_noop_update
  before update on public.user_watch_history
  for each row execute function public.skip_noop_row_update();

drop trigger if exists aa_skip_noop_update on public.user_media_library;
create trigger aa_skip_noop_update
  before update on public.user_media_library
  for each row execute function public.skip_noop_row_update();

drop trigger if exists aa_skip_noop_update on public.user_episode_progress;
create trigger aa_skip_noop_update
  before update on public.user_episode_progress
  for each row execute function public.skip_noop_row_update();

commit;
