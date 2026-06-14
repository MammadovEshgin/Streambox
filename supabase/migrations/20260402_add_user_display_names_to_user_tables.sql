begin;

alter table if exists public.user_settings add column if not exists user_display_name text;
alter table if exists public.user_media_library add column if not exists user_display_name text;
alter table if exists public.user_watch_history add column if not exists user_display_name text;
alter table if exists public.user_daily_recommendations add column if not exists user_display_name text;
alter table if exists public.user_episode_progress add column if not exists user_display_name text;
alter table if exists public.user_audit_logs add column if not exists user_display_name text;
alter table if exists public.user_announcement_views add column if not exists user_display_name text;
alter table if exists private.rate_limit_windows add column if not exists user_display_name text;
alter table if exists public.user_franchise_progress add column if not exists user_display_name text;

create or replace function public.resolve_streambox_user_display_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(btrim(profile.display_name), '')
      from public.user_profiles as profile
      where profile.id = target_user_id
    ),
    'My Profile'
  );
$$;

revoke all on function public.resolve_streambox_user_display_name(uuid) from public;
revoke all on function public.resolve_streambox_user_display_name(uuid) from anon;
revoke all on function public.resolve_streambox_user_display_name(uuid) from authenticated;
grant execute on function public.resolve_streambox_user_display_name(uuid) to authenticated;
grant execute on function public.resolve_streambox_user_display_name(uuid) to service_role;

create or replace function public.assign_streambox_user_display_name()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  new.user_display_name := coalesce(
    nullif(btrim(new.user_display_name), ''),
    public.resolve_streambox_user_display_name(new.user_id)
  );

  return new;
end;
$$;

revoke all on function public.assign_streambox_user_display_name() from public;
revoke all on function public.assign_streambox_user_display_name() from anon;
revoke all on function public.assign_streambox_user_display_name() from authenticated;

create or replace function public.propagate_streambox_user_display_name()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE' and old.display_name is not distinct from new.display_name then
    return new;
  end if;

  update public.user_settings
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_media_library
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_watch_history
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_daily_recommendations
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_episode_progress
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_audit_logs
  set user_display_name = new.display_name
  where user_id = new.id;

  update public.user_announcement_views
  set user_display_name = new.display_name
  where user_id = new.id;

  update private.rate_limit_windows
  set user_display_name = new.display_name
  where user_id = new.id;

  if to_regclass('public.user_franchise_progress') is not null then
    execute
      'update public.user_franchise_progress
       set user_display_name = $1
       where user_id = $2'
    using new.display_name, new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.propagate_streambox_user_display_name() from public;
revoke all on function public.propagate_streambox_user_display_name() from anon;
revoke all on function public.propagate_streambox_user_display_name() from authenticated;

drop trigger if exists set_user_settings_display_name on public.user_settings;
create trigger set_user_settings_display_name
  before insert or update of user_id on public.user_settings
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_media_library_display_name on public.user_media_library;
create trigger set_user_media_library_display_name
  before insert or update of user_id on public.user_media_library
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_watch_history_display_name on public.user_watch_history;
create trigger set_user_watch_history_display_name
  before insert or update of user_id on public.user_watch_history
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_daily_recommendations_display_name on public.user_daily_recommendations;
create trigger set_user_daily_recommendations_display_name
  before insert or update of user_id on public.user_daily_recommendations
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_episode_progress_display_name on public.user_episode_progress;
create trigger set_user_episode_progress_display_name
  before insert or update of user_id on public.user_episode_progress
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_audit_logs_display_name on public.user_audit_logs;
create trigger set_user_audit_logs_display_name
  before insert or update of user_id on public.user_audit_logs
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_user_announcement_views_display_name on public.user_announcement_views;
create trigger set_user_announcement_views_display_name
  before insert or update of user_id on public.user_announcement_views
  for each row execute function public.assign_streambox_user_display_name();

drop trigger if exists set_private_rate_limit_windows_display_name on private.rate_limit_windows;
create trigger set_private_rate_limit_windows_display_name
  before insert or update of user_id on private.rate_limit_windows
  for each row execute function public.assign_streambox_user_display_name();

do $$
begin
  if to_regclass('public.user_franchise_progress') is not null then
    execute 'drop trigger if exists set_user_franchise_progress_display_name on public.user_franchise_progress';
    execute '
      create trigger set_user_franchise_progress_display_name
        before insert or update of user_id on public.user_franchise_progress
        for each row execute function public.assign_streambox_user_display_name()
    ';
  end if;
end
$$;

drop trigger if exists propagate_streambox_user_display_name_after_profile_write on public.user_profiles;
create trigger propagate_streambox_user_display_name_after_profile_write
  after insert or update of display_name on public.user_profiles
  for each row execute function public.propagate_streambox_user_display_name();

update public.user_settings
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_media_library
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_watch_history
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_daily_recommendations
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_episode_progress
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_audit_logs
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update public.user_announcement_views
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

update private.rate_limit_windows
set user_display_name = public.resolve_streambox_user_display_name(user_id)
where user_display_name is null
   or btrim(user_display_name) = ''
   or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id);

do $$
begin
  if to_regclass('public.user_franchise_progress') is not null then
    execute '
      update public.user_franchise_progress
      set user_display_name = public.resolve_streambox_user_display_name(user_id)
      where user_display_name is null
         or btrim(user_display_name) = ''''
         or user_display_name is distinct from public.resolve_streambox_user_display_name(user_id)
    ';
  end if;
end
$$;

alter table if exists public.user_settings alter column user_display_name set default 'My Profile';
alter table if exists public.user_media_library alter column user_display_name set default 'My Profile';
alter table if exists public.user_watch_history alter column user_display_name set default 'My Profile';
alter table if exists public.user_daily_recommendations alter column user_display_name set default 'My Profile';
alter table if exists public.user_episode_progress alter column user_display_name set default 'My Profile';
alter table if exists public.user_audit_logs alter column user_display_name set default 'My Profile';
alter table if exists public.user_announcement_views alter column user_display_name set default 'My Profile';
alter table if exists private.rate_limit_windows alter column user_display_name set default 'My Profile';
alter table if exists public.user_franchise_progress alter column user_display_name set default 'My Profile';

alter table if exists public.user_settings alter column user_display_name set not null;
alter table if exists public.user_media_library alter column user_display_name set not null;
alter table if exists public.user_watch_history alter column user_display_name set not null;
alter table if exists public.user_daily_recommendations alter column user_display_name set not null;
alter table if exists public.user_episode_progress alter column user_display_name set not null;
alter table if exists public.user_audit_logs alter column user_display_name set not null;
alter table if exists public.user_announcement_views alter column user_display_name set not null;
alter table if exists private.rate_limit_windows alter column user_display_name set not null;
alter table if exists public.user_franchise_progress alter column user_display_name set not null;

commit;
