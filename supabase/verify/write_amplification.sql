-- Write-amplification check for the sync tables.
--
--   npx supabase db query --linked -f supabase/verify/write_amplification.sql -o csv
--
-- Baseline captured 2026-07-28, immediately BEFORE migration 20260728150000 installed the
-- aa_skip_noop_update triggers:
--
--   user_watch_history      3,689 ins   221,447 upd   2,325 rows   95.2 upd/row    1.2% HOT
--   user_media_library      1,926 ins    20,328 upd   1,203 rows   16.9 upd/row    9.6% HOT
--   user_episode_progress   1,817 ins    10,378 upd   1,652 rows    6.3 upd/row   60.1% HOT
--
-- pg_stat counters are CUMULATIVE and were not reset, so the totals below still include
-- all pre-fix churn. Read the "since_baseline" columns instead -- those isolate behaviour
-- after the fix.
--
-- What good looks like: updates_since_baseline should stay close to
-- inserts_since_baseline. A bootstrap backfill re-sends every row a user owns, so before
-- the fix each one produced an update; now an unchanged row produces nothing at all.
-- If updates_since_baseline climbs into the thousands while inserts barely move, the
-- suppression is not working -- check that aa_skip_noop_update still sorts ahead of
-- set_<table>_updated_at in pg_trigger (alphabetical order decides which runs first).

with baseline(relname, ins0, upd0) as (values
  ('user_watch_history',    3689, 221447),
  ('user_media_library',    1926,  20328),
  ('user_episode_progress', 1817,  10378)
)
select
  s.relname,
  s.n_tup_ins - b.ins0                        as inserts_since_baseline,
  s.n_tup_upd - b.upd0                        as updates_since_baseline,
  case when s.n_tup_upd - b.upd0 = 0 then 'no churn yet'
       when s.n_tup_ins - b.ins0 = 0 then (s.n_tup_upd - b.upd0)::text || ' upd, 0 ins'
       else round((s.n_tup_upd - b.upd0)::numeric
                / nullif(s.n_tup_ins - b.ins0, 0), 1)::text || ' upd per insert'
  end                                         as ratio_since_baseline,
  s.n_live_tup                                as live_rows,
  round(100.0 * s.n_tup_hot_upd / nullif(s.n_tup_upd, 0), 1) as hot_pct_cumulative,
  s.n_tup_upd                                 as updates_cumulative,
  (select count(*) from pg_trigger t
    where t.tgrelid = s.relid and t.tgname = 'aa_skip_noop_update'
      and t.tgenabled = 'O')                  as guard_installed
from pg_stat_user_tables s
join baseline b on b.relname = s.relname
where s.schemaname = 'public'
order by s.n_tup_upd - b.upd0 desc;
