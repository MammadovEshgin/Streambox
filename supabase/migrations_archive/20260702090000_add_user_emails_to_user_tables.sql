-- Denormalize the account email onto every user-keyed table, mirroring the
-- user_display_name pattern from 20260402_add_user_display_names_to_user_tables.sql,
-- so rows are human-readable during manual inspection without joining auth.users.
--
-- Deliberate differences from the display-name migration:
--   * user_email is NULLABLE with NO default — there is no honest fallback for
--     an email, and a fake value would be worse than null.
--   * resolve_streambox_user_email is EXECUTE-granted to service_role ONLY.
--     Clients (anon/authenticated) must never be able to resolve an arbitrary
--     uuid to an email. The BEFORE triggers still work for client writes
--     because the trigger function is SECURITY DEFINER and the inner call is
--     privilege-checked against the function owner, not the caller.
--   * The BEFORE trigger always overwrites user_email from auth.users — the
--     client-supplied value is ignored, so the column is always authoritative.
--   * Propagation listens on auth.users email changes (defensively: any error
--     in the propagation is swallowed so an auth email change can never fail
--     because of this denormalization).
--
-- RLS: no policy is created, dropped, or altered. Existing select-own policies
-- mean a user can read the email on their OWN rows only; other users' rows
-- (and therefore emails) stay invisible. service_role bypasses RLS as before.
--
-- Idempotent: safe to re-run (if exists / if not exists / or replace / drop
-- trigger if exists throughout).

begin;

alter table if exists public.user_settings add column if not exists user_email text;
alter table if exists public.user_media_library add column if not exists user_email text;
alter table if exists public.user_watch_history add column if not exists user_email text;
alter table if exists public.user_daily_recommendations add column if not exists user_email text;
alter table if exists public.user_episode_progress add column if not exists user_email text;
alter table if exists public.user_audit_logs add column if not exists user_email text;
alter table if exists public.user_announcement_views add column if not exists user_email text;
alter table if exists private.rate_limit_windows add column if not exists user_email text;
alter table if exists public.user_franchise_progress add column if not exists user_email text;

create or replace function public.resolve_streambox_user_email(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(u.email), '')
  from auth.users as u
  where u.id = target_user_id;
$$;

revoke all on function public.resolve_streambox_user_email(uuid) from public;
revoke all on function public.resolve_streambox_user_email(uuid) from anon;
revoke all on function public.resolve_streambox_user_email(uuid) from authenticated;
grant execute on function public.resolve_streambox_user_email(uuid) to service_role;

create or replace function public.assign_streambox_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- Always authoritative: ignore any client-supplied value.
  new.user_email := public.resolve_streambox_user_email(new.user_id);

  return new;
end;
$$;

revoke all on function public.assign_streambox_user_email() from public;
revoke all on function public.assign_streambox_user_email() from anon;
revoke all on function public.assign_streambox_user_email() from authenticated;

create or replace function public.propagate_streambox_user_email()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  next_email text := nullif(btrim(new.email), '');
begin
  if tg_op = 'UPDATE' and old.email is not distinct from new.email then
    return new;
  end if;

  update public.user_settings
  set user_email = next_email
  where user_id = new.id;

  update public.user_media_library
  set user_email = next_email
  where user_id = new.id;

  update public.user_watch_history
  set user_email = next_email
  where user_id = new.id;

  update public.user_daily_recommendations
  set user_email = next_email
  where user_id = new.id;

  update public.user_episode_progress
  set user_email = next_email
  where user_id = new.id;

  update public.user_audit_logs
  set user_email = next_email
  where user_id = new.id;

  update public.user_announcement_views
  set user_email = next_email
  where user_id = new.id;

  update private.rate_limit_windows
  set user_email = next_email
  where user_id = new.id;

  if to_regclass('public.user_franchise_progress') is not null then
    execute
      'update public.user_franchise_progress
       set user_email = $1
       where user_id = $2'
    using next_email, new.id;
  end if;

  return new;
exception when others then
  -- Never let denormalization upkeep block a write to auth.users.
  return new;
end;
$$;

revoke all on function public.propagate_streambox_user_email() from public;
revoke all on function public.propagate_streambox_user_email() from anon;
revoke all on function public.propagate_streambox_user_email() from authenticated;

drop trigger if exists set_user_settings_email on public.user_settings;
create trigger set_user_settings_email
  before insert or update of user_id on public.user_settings
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_media_library_email on public.user_media_library;
create trigger set_user_media_library_email
  before insert or update of user_id on public.user_media_library
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_watch_history_email on public.user_watch_history;
create trigger set_user_watch_history_email
  before insert or update of user_id on public.user_watch_history
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_daily_recommendations_email on public.user_daily_recommendations;
create trigger set_user_daily_recommendations_email
  before insert or update of user_id on public.user_daily_recommendations
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_episode_progress_email on public.user_episode_progress;
create trigger set_user_episode_progress_email
  before insert or update of user_id on public.user_episode_progress
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_audit_logs_email on public.user_audit_logs;
create trigger set_user_audit_logs_email
  before insert or update of user_id on public.user_audit_logs
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_user_announcement_views_email on public.user_announcement_views;
create trigger set_user_announcement_views_email
  before insert or update of user_id on public.user_announcement_views
  for each row execute function public.assign_streambox_user_email();

drop trigger if exists set_private_rate_limit_windows_email on private.rate_limit_windows;
create trigger set_private_rate_limit_windows_email
  before insert or update of user_id on private.rate_limit_windows
  for each row execute function public.assign_streambox_user_email();

do $$
begin
  if to_regclass('public.user_franchise_progress') is not null then
    execute 'drop trigger if exists set_user_franchise_progress_email on public.user_franchise_progress';
    execute '
      create trigger set_user_franchise_progress_email
        before insert or update of user_id on public.user_franchise_progress
        for each row execute function public.assign_streambox_user_email()
    ';
  end if;
end
$$;

-- Keep denormalized emails fresh when the account email changes. Wrapped so
-- the migration still succeeds on projects where the migration role cannot
-- create triggers on auth.users — the BEFORE triggers + backfill then keep
-- rows correct on their next write instead.
do $$
begin
  execute 'drop trigger if exists propagate_streambox_user_email_after_auth_email_change on auth.users';
  execute '
    create trigger propagate_streambox_user_email_after_auth_email_change
      after update of email on auth.users
      for each row execute function public.propagate_streambox_user_email()
  ';
exception when insufficient_privilege then
  raise notice 'Skipped auth.users email trigger (insufficient privilege); user_email refreshes on next row write.';
end
$$;

update public.user_settings
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_media_library
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_watch_history
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_daily_recommendations
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_episode_progress
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_audit_logs
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update public.user_announcement_views
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

update private.rate_limit_windows
set user_email = public.resolve_streambox_user_email(user_id)
where user_email is distinct from public.resolve_streambox_user_email(user_id);

do $$
begin
  if to_regclass('public.user_franchise_progress') is not null then
    execute '
      update public.user_franchise_progress
      set user_email = public.resolve_streambox_user_email(user_id)
      where user_email is distinct from public.resolve_streambox_user_email(user_id)
    ';
  end if;
end
$$;

-- Admin-only convenience: one place to translate a uuid into a human. The view
-- is definer-rights (reads auth.users), so access is locked to service_role.
create or replace view public.admin_user_directory as
select
  u.id as user_id,
  u.email as user_email,
  p.display_name as user_display_name,
  u.created_at as auth_created_at,
  u.last_sign_in_at as last_sign_in_at,
  p.joined_at as profile_joined_at
from auth.users as u
left join public.user_profiles as p on p.id = u.id;

revoke all on public.admin_user_directory from public;
revoke all on public.admin_user_directory from anon;
revoke all on public.admin_user_directory from authenticated;
grant select on public.admin_user_directory to service_role;

commit;
