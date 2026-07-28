-- Baseline fidelity check.
--
-- Run this against any database built from supabase/migrations/ and it reports PASS/FAIL
-- per object class against the counts production had when the baseline was generated
-- (2026-07-28). Every row must be PASS for the baseline to be considered faithful.
--
--   npx supabase db query --db-url "<scratch-connection-string>" -f supabase/verify/object_counts.sql -o csv
--
-- Expected note on triggers: the two auth.users triggers are created inside a guarded
-- DO block. If the build role lacked privilege on auth.users they are skipped, and the
-- trigger row reports 31 instead of 33. That is a known-acceptable outcome on a scratch
-- project -- it is NOT acceptable on a real rebuild of production.

with expected(obj, want) as (values
  ('tables',                      22),
  ('enum types',                   2),
  ('functions',                   37),
  ('views',                        2),
  ('indexes (non-constraint)',    50),
  ('constraints pk/unique/check',115),
  ('constraints foreign key',     20),
  ('triggers (all schemas)',      33),
  ('policies public+private',     43),
  ('policies storage.objects',     8)
),
actual(obj, got) as (
  select 'tables', count(*)::int from pg_class
    where relkind='r' and relnamespace::regnamespace::text in ('public','private')
  union all
  select 'enum types', count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where t.typtype='e' and n.nspname in ('public','private')
  union all
  select 'functions', count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'
  union all
  select 'views', count(*)::int from pg_class
    where relkind='v' and relnamespace::regnamespace::text in ('public','private')
  union all
  select 'indexes (non-constraint)', count(*)::int from pg_index i join pg_class ic on ic.oid=i.indexrelid
    where ic.relnamespace::regnamespace::text in ('public','private')
      and not exists (select 1 from pg_constraint co where co.conindid=i.indexrelid)
  union all
  select 'constraints pk/unique/check', count(*)::int from pg_constraint
    where connamespace::regnamespace::text in ('public','private') and contype in ('p','u','c')
  union all
  select 'constraints foreign key', count(*)::int from pg_constraint
    where connamespace::regnamespace::text in ('public','private') and contype='f'
  union all
  select 'triggers (all schemas)', count(*)::int from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    where not tg.tgisinternal and c.relnamespace::regnamespace::text in ('public','private','auth')
  union all
  select 'policies public+private', count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid
    where c.relnamespace::regnamespace::text in ('public','private')
  union all
  select 'policies storage.objects', count(*)::int
    from pg_policy where polrelid = to_regclass('storage.objects')
)
select
  case when a.got = e.want then 'PASS' else 'FAIL' end as result,
  e.obj                                                as object_class,
  e.want                                               as expected,
  a.got                                                as actual,
  case when a.got = e.want then '' else (a.got - e.want)::text end as diff
from expected e join actual a using (obj)
order by (a.got = e.want), e.obj;
