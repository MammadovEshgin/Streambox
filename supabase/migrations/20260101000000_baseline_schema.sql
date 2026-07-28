-- Streambox database baseline
--
-- This file is the single source of truth for the Streambox schema. It was generated
-- directly from the production catalog on 2026-07-28 using Postgres' own DDL emitters
-- (pg_get_functiondef, pg_get_indexdef, pg_get_viewdef, pg_get_constraintdef,
-- pg_get_triggerdef), so it reflects what production actually contains -- not what the
-- historical migration files claimed it contained.
--
-- Why this exists: the pre-2026-07-28 migration history could not rebuild the database.
-- Three tables had no CREATE TABLE anywhere, several indexes existed only in production,
-- and hand-added RPC overloads had drifted from their declared definitions -- which is
-- what caused the PGRST203 sync outage. See docs/DB_AUDIT_2026-07-28.md.
--
-- The superseded migrations are preserved verbatim under supabase/migrations_archive/
-- for historical reference. They are NOT part of the replay path any more.
--
-- Reference data (themes, provider configs, franchise catalogue, storage buckets) lives
-- in supabase/seed.sql so a fresh environment comes up usable. No user data is included
-- in either file.
--
-- On production this migration is registered via `supabase migration repair --status
-- applied`; it is never executed there. It executes only when building a fresh database.
--
-- Verify a rebuild with supabase/verify/object_counts.sql -- see docs/DATABASE.md.

-- check_function_bodies=off lets functions be created before the tables their bodies
-- reference, which keeps the ordering below simple and deterministic.
set check_function_bodies = false;

-- Trigger definitions and CHECK constraints below name their functions unqualified (as
-- Postgres emits them), so public must be on the search_path while this file runs.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Schemas and extensions
-- ---------------------------------------------------------------------------
create schema if not exists private;

create extension if not exists "uuid-ossp"        with schema extensions;
create extension if not exists pgcrypto           with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
-- pg_net lives in public on this project (see P1-7 in the audit); kept as-is so the
-- baseline reproduces production exactly rather than silently relocating it.
create extension if not exists pg_net             with schema public;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
create type public.media_type as enum ('movie', 'tv');
create type public.user_media_list_kind as enum ('watchlist', 'liked', 'recently_viewed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists private.rate_limit_windows (
  user_id uuid not null,
  action_key text not null,
  window_started_at timestamp with time zone not null,
  hit_count integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.app_announcements (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  priority integer default 100 not null,
  is_active boolean default true not null,
  requires_auth boolean default false not null,
  display_version integer default 1 not null,
  title_en text not null,
  title_tr text,
  body_en text not null,
  body_tr text,
  eyebrow_en text,
  eyebrow_tr text,
  cta_label_en text,
  cta_label_tr text,
  cta_url text,
  image_url text,
  accent_hex text,
  starts_at timestamp with time zone default timezone('utc'::text, now()) not null,
  ends_at timestamp with time zone,
  min_app_version text,
  max_app_version text,
  platforms text[] default ARRAY['android'::text, 'ios'::text] not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.app_telemetry_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid default auth.uid(),
  session_id text not null,
  event_name text not null,
  event_category text not null,
  severity text default 'info'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  platform text,
  app_version text,
  build_channel text,
  occurred_at timestamp with time zone default now() not null,
  inserted_at timestamp with time zone default now() not null
);
create table if not exists public.app_themes (
  id text not null,
  display_name text not null,
  description text not null,
  primary_color text not null,
  sort_order smallint not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.external_ratings_alert_events (
  id bigint generated by default as identity not null,
  alert_code text not null,
  severity text not null,
  message text not null,
  metric_value numeric,
  snapshot jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.external_ratings_cache (
  imdb_id text not null,
  imdb_rating text,
  rotten_tomatoes text,
  metacritic text,
  raw_payload jsonb,
  fetched_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone not null,
  last_accessed_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_error text,
  access_count bigint default 0 not null,
  refresh_count bigint default 0 not null,
  last_status text default 'cold'::text not null,
  last_refreshed_by text,
  release_year integer
);
create table if not exists public.external_ratings_function_logs (
  id bigint generated by default as identity not null,
  function_name text not null,
  event_type text not null,
  status_code integer not null,
  imdb_id text,
  cache_source text,
  latency_ms integer,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.franchise_collections (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  title text not null,
  description text,
  backdrop_url text,
  accent_color text,
  total_entries integer default 0 not null,
  sort_order smallint default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.franchise_entries (
  id uuid default gen_random_uuid() not null,
  franchise_id uuid not null,
  tmdb_id bigint,
  media_type text not null,
  title text not null,
  year integer,
  watch_order integer not null,
  phase text,
  tagline text,
  note text,
  runtime_minutes integer,
  episode_count integer,
  is_released boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.provider_configs (
  id text not null,
  label text not null,
  base_url text not null,
  referer text default ''::text not null,
  enabled boolean default true not null,
  priority smallint default 0 not null,
  updated_at timestamp with time zone default now() not null,
  notes text
);
create table if not exists public.user_announcement_views (
  user_id uuid not null,
  announcement_id uuid not null,
  display_version integer default 1 not null,
  seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_audit_logs (
  id bigint generated always as identity not null,
  user_id uuid not null,
  action_category text not null,
  action_type text not null,
  entity_type text,
  entity_key text,
  metadata jsonb default '{}'::jsonb not null,
  occurred_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_daily_recommendations (
  user_id uuid not null,
  recommendation_kind text default 'movie_of_the_day'::text not null,
  recommendation_date date not null,
  media_type media_type default 'movie'::media_type not null,
  tmdb_id bigint,
  imdb_id text,
  strategy text,
  snapshot jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  internal_id uuid,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_episode_progress (
  user_id uuid not null,
  series_tmdb_id bigint not null,
  season_number integer not null,
  episode_number integer not null,
  watched_at timestamp with time zone default timezone('utc'::text, now()) not null,
  snapshot jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_franchise_progress (
  user_id uuid not null,
  entry_id uuid not null,
  watched_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_media_library (
  user_id uuid not null,
  list_kind user_media_list_kind not null,
  media_type media_type not null,
  tmdb_id bigint,
  imdb_id text,
  collected_at timestamp with time zone default timezone('utc'::text, now()) not null,
  snapshot jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  internal_id uuid,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_profiles (
  id uuid not null,
  display_name text default 'My Profile'::text not null,
  bio text default ''::text not null,
  location_text text default ''::text not null,
  birthday date,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  avatar_path text,
  banner_path text,
  avatar_version integer default 0 not null,
  banner_version integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.user_settings (
  user_id uuid not null,
  theme_id text not null,
  onboarding_completed_at timestamp with time zone,
  preferences jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.user_watch_history (
  user_id uuid not null,
  media_type media_type not null,
  tmdb_id bigint,
  imdb_id text,
  title text not null,
  poster_path text,
  genres text[] default '{}'::text[] not null,
  runtime_minutes integer,
  episode_count integer,
  vote_average numeric(4,2) default 0 not null,
  release_year integer,
  cast_ids bigint[] default '{}'::bigint[] not null,
  cast_names text[] default '{}'::text[] not null,
  cast_profile_paths text[] default '{}'::text[] not null,
  cast_genders text[] default '{}'::text[] not null,
  director_ids bigint[] default '{}'::bigint[] not null,
  director_names text[] default '{}'::text[] not null,
  director_profile_paths text[] default '{}'::text[] not null,
  watched_at timestamp with time zone not null,
  metadata_version integer default 1 not null,
  snapshot jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  internal_id uuid,
  user_display_name text default 'My Profile'::text not null,
  user_email text
);
create table if not exists public.watch_room_members (
  id uuid default gen_random_uuid() not null,
  room_id uuid not null,
  user_id uuid not null,
  nickname text not null,
  role text not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.watch_room_memories (
  id uuid default gen_random_uuid() not null,
  room_id uuid,
  created_by uuid not null,
  media_type media_type not null,
  tmdb_id integer not null,
  title text not null,
  position_seconds integer default 0 not null,
  image_path text not null,
  caption text,
  participant_nicknames text[] default '{}'::text[] not null,
  participant_user_ids uuid[] default '{}'::uuid[] not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create table if not exists public.watch_rooms (
  id uuid default gen_random_uuid() not null,
  code text not null,
  host_user_id uuid not null,
  media_type media_type not null,
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  backdrop_path text,
  season_number smallint,
  episode_number smallint,
  status text default 'lobby'::text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone default (timezone('utc'::text, now()) + '12:00:00'::interval) not null,
  imdb_id text,
  year text,
  original_title text
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_streambox_user_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  new.user_display_name := coalesce(
    nullif(btrim(new.user_display_name), ''),
    public.resolve_streambox_user_display_name(new.user_id)
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_streambox_user_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  -- Always authoritative: ignore any client-supplied value.
  new.user_email := public.resolve_streambox_user_email(new.user_id);

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.capture_external_ratings_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inserted_count integer := 0;
begin
  insert into public.external_ratings_alert_events (alert_code, severity, message, metric_value, snapshot)
  select
    alert_code,
    severity,
    message,
    metric_value,
    jsonb_build_object(
      'window_start', window_start,
      'evaluated_at', evaluated_at
    )
  from public.external_ratings_active_alerts as alerts
  where not exists (
    select 1
    from public.external_ratings_alert_events as existing
    where existing.alert_code = alerts.alert_code
      and existing.created_at >= timezone('utc', now()) - interval '15 minutes'
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cast_gender_array_is_valid(genders text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select not exists (
    select 1
    from unnest(coalesce(genders, '{}'::text[])) as gender
    where gender is not null
      and gender not in ('male', 'female')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_expired_watch_rooms()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    delete from storage.objects o
    using public.watch_rooms r
    where o.bucket_id = 'watch-memories'
      and (storage.foldername(o.name))[1] = r.id::text
      and r.expires_at < timezone('utc', now()) - interval '7 days'
      and not exists (
        select 1 from public.watch_room_memories m where m.image_path = o.name
      );
  exception
    when others then
      null; -- storage cleanup is best-effort; never block the row cleanup
  end;

  delete from public.watch_rooms
  where expires_at < timezone('utc', now()) - interval '7 days';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_external_ratings_monitoring(retention_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  deleted_logs integer := 0;
  deleted_alerts integer := 0;
begin
  delete from public.external_ratings_function_logs
  where created_at < timezone('utc', now()) - make_interval(days => greatest(retention_days, 1));
  get diagnostics deleted_logs = row_count;

  delete from public.external_ratings_alert_events
  where created_at < timezone('utc', now()) - make_interval(days => greatest(retention_days, 1));
  get diagnostics deleted_alerts = row_count;

  return jsonb_build_object(
    'deleted_log_rows', deleted_logs,
    'deleted_alert_rows', deleted_alerts,
    'retention_days', greatest(retention_days, 1)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_streambox_event_logs(p_retention_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_streambox_rate_limit_windows(retention_days integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
declare
  deleted_rows integer := 0;
begin
  delete from private.rate_limit_windows
  where updated_at < timezone('utc', now()) - make_interval(days => greatest(coalesce(retention_days, 7), 1));

  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.consume_streambox_rate_limit(target_user_id uuid, action_key text, max_hits integer DEFAULT 30, window_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
declare
  normalized_action_key text := nullif(trim(action_key), '');
  normalized_max_hits integer := greatest(coalesce(max_hits, 30), 1);
  normalized_window_seconds integer := greatest(coalesce(window_seconds, 60), 1);
  window_bucket_epoch bigint;
  bucket_start timestamptz;
  current_hits integer;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if normalized_action_key is null then
    raise exception 'action_key is required';
  end if;

  window_bucket_epoch := floor(extract(epoch from timezone('utc', now())) / normalized_window_seconds)::bigint * normalized_window_seconds;
  bucket_start := to_timestamp(window_bucket_epoch);

  insert into private.rate_limit_windows (user_id, action_key, window_started_at, hit_count)
  values (target_user_id, normalized_action_key, bucket_start, 1)
  on conflict (user_id, action_key, window_started_at)
  do update
    set hit_count = private.rate_limit_windows.hit_count + 1,
        updated_at = timezone('utc', now())
  returning hit_count into current_hits;

  return jsonb_build_object(
    'allowed', current_hits <= normalized_max_hits,
    'remaining', greatest(normalized_max_hits - current_hits, 0),
    'hit_count', current_hits,
    'max_hits', normalized_max_hits,
    'window_seconds', normalized_window_seconds,
    'window_started_at', bucket_start
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_watch_room(p_code text, p_media_type media_type, p_tmdb_id integer, p_title text, p_nickname text, p_poster_path text DEFAULT NULL::text, p_backdrop_path text DEFAULT NULL::text, p_season_number smallint DEFAULT NULL::smallint, p_episode_number smallint DEFAULT NULL::smallint, p_imdb_id text DEFAULT NULL::text, p_year text DEFAULT NULL::text, p_original_title text DEFAULT NULL::text)
 RETURNS watch_rooms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_room public.watch_rooms;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.watch_rooms (
    code, host_user_id, media_type, tmdb_id, title,
    poster_path, backdrop_path, season_number, episode_number,
    imdb_id, year, original_title, status
  )
  values (
    upper(btrim(p_code)), auth.uid(), p_media_type, p_tmdb_id, btrim(p_title),
    p_poster_path, p_backdrop_path, p_season_number, p_episode_number,
    p_imdb_id, p_year, p_original_title, 'lobby'
  )
  returning * into v_room;

  insert into public.watch_room_members (room_id, user_id, nickname, role)
  values (v_room.id, auth.uid(), btrim(p_nickname), 'host');

  return v_room;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_streambox_watch_history_entry(p_media_type media_type, p_tmdb_id bigint DEFAULT NULL::bigint, p_audit_metadata jsonb DEFAULT NULL::jsonb, p_internal_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
  affected_rows integer := 0;
begin
  if current_user_id is null then raise exception 'not authenticated'; end if;

  if p_tmdb_id is not null then
    delete from public.user_watch_history
    where user_id = current_user_id and media_type = p_media_type and tmdb_id = p_tmdb_id;
  else
    delete from public.user_watch_history
    where user_id = current_user_id and media_type = p_media_type and internal_id = p_internal_id;
  end if;

  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    perform public.log_streambox_user_event(
      'watch_history', 'watch_history_removed', p_media_type::text,
      public.make_streambox_entity_key(p_media_type, p_tmdb_id, p_internal_id),
      normalized_audit_metadata || jsonb_build_object('mediaType', p_media_type::text, 'tmdbId', p_tmdb_id, 'internalId', p_internal_id)
    );
  end if;

  return affected_rows > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_streambox_watch_history_entry(p_media_type media_type, p_tmdb_id bigint, p_audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
  affected_rows integer := 0;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(normalized_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  delete from public.user_watch_history
  where user_id = current_user_id
    and public.user_watch_history.media_type = p_media_type
    and public.user_watch_history.tmdb_id = p_tmdb_id;

  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    perform public.log_streambox_user_event(
      'watch_history',
      'watch_history_removed',
      p_media_type::text,
      public.make_streambox_entity_key(p_media_type, p_tmdb_id),
      normalized_audit_metadata || jsonb_build_object('mediaType', p_media_type::text, 'tmdbId', p_tmdb_id)
    );
  end if;

  return affected_rows > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.end_watch_room(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.watch_rooms
  set status = 'ended',
      updated_at = timezone('utc', now())
  where id = p_room_id
    and host_user_id = auth.uid();
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_external_ratings_jobs(project_url text, anon_key text, refresh_function_name text DEFAULT 'refresh-hot-ratings'::text, refresh_cron text DEFAULT '17 */6 * * *'::text, alert_cron text DEFAULT '*/15 * * * *'::text, cleanup_cron text DEFAULT '33 3 * * *'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(trim(project_url), '') = '' then
    raise notice 'project_url is required.';
    return;
  end if;

  if coalesce(trim(anon_key), '') = '' then
    raise notice 'anon_key is required.';
    return;
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'external-ratings-hot-refresh'
  ) then
    perform cron.schedule(
      'external-ratings-hot-refresh',
      refresh_cron,
      format(
        $job$
          select net.http_post(
            url := %L || '/functions/v1/' || %L,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'apikey', %L,
              'Authorization', 'Bearer ' || %L
            ),
            body := %L::jsonb
          );
        $job$,
        project_url,
        refresh_function_name,
        anon_key,
        anon_key,
        '{"batchSize":25}'
      )
    );
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'external-ratings-alert-capture'
  ) then
    perform cron.schedule(
      'external-ratings-alert-capture',
      alert_cron,
      $cron$select public.capture_external_ratings_alerts();$cron$
    );
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'external-ratings-monitoring-cleanup'
  ) then
    perform cron.schedule(
      'external-ratings-monitoring-cleanup',
      cleanup_cron,
      $cron$select public.cleanup_external_ratings_monitoring(30);$cron$
    );
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_hot_external_ratings_candidates(batch_size integer DEFAULT 25)
 RETURNS TABLE(imdb_id text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cache.imdb_id
  from public.external_ratings_cache as cache
  where cache.last_accessed_at >= timezone('utc', now()) - interval '30 days'
    and cache.last_status in ('warm', 'hot')
    and cache.expires_at <= timezone('utc', now()) + interval '2 days'
  order by
    case cache.last_status when 'hot' then 0 when 'warm' then 1 else 2 end,
    case when cache.expires_at <= timezone('utc', now()) then 0 else 1 end,
    cache.access_count desc,
    cache.last_accessed_at desc
  limit greatest(batch_size, 1);
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_streambox_bootstrap()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'profile',
      coalesce(
        (
          select jsonb_build_object(
            'displayName', profile.display_name,
            'bio', profile.bio,
            'location', profile.location_text,
            'birthday', profile.birthday,
            'joinedAt', profile.joined_at,
            'avatarPath', profile.avatar_path,
            'bannerPath', profile.banner_path,
            'avatarVersion', profile.avatar_version,
            'bannerVersion', profile.banner_version,
            'updatedAt', profile.updated_at
          )
          from public.user_profiles as profile
          where profile.id = auth.uid()
        ),
        '{}'::jsonb
      ),
    'settings',
      coalesce(
        (
          select jsonb_build_object(
            'themeId', settings.theme_id,
            'onboardingCompletedAt', settings.onboarding_completed_at,
            'preferences', settings.preferences,
            'updatedAt', settings.updated_at
          )
          from public.user_settings as settings
          where settings.user_id = auth.uid()
        ),
        '{}'::jsonb
      ),
    'watchlist',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaType', library.media_type,
              'tmdbId', library.tmdb_id,
              'imdbId', library.imdb_id,
              'collectedAt', library.collected_at,
              'snapshot', library.snapshot,
              'updatedAt', library.updated_at
            )
            order by library.collected_at desc
          )
          from public.user_media_library as library
          where library.user_id = auth.uid()
            and library.list_kind = 'watchlist'
        ),
        '[]'::jsonb
      ),
    'liked',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaType', library.media_type,
              'tmdbId', library.tmdb_id,
              'imdbId', library.imdb_id,
              'collectedAt', library.collected_at,
              'snapshot', library.snapshot,
              'updatedAt', library.updated_at
            )
            order by library.collected_at desc
          )
          from public.user_media_library as library
          where library.user_id = auth.uid()
            and library.list_kind = 'liked'
        ),
        '[]'::jsonb
      ),
    'recentlyViewed',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaType', recent.media_type,
              'tmdbId', recent.tmdb_id,
              'imdbId', recent.imdb_id,
              'collectedAt', recent.collected_at,
              'snapshot', recent.snapshot,
              'updatedAt', recent.updated_at
            )
            order by recent.collected_at desc
          )
          from (
            select *
            from public.user_media_library as library
            where library.user_id = auth.uid()
              and library.list_kind = 'recently_viewed'
            order by library.collected_at desc
            limit 30
          ) as recent
        ),
        '[]'::jsonb
      ),
    'watchHistory',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaType', history.media_type,
              'tmdbId', history.tmdb_id,
              'imdbId', history.imdb_id,
              'title', history.title,
              'posterPath', history.poster_path,
              'genres', history.genres,
              'runtimeMinutes', history.runtime_minutes,
              'episodeCount', history.episode_count,
              'voteAverage', history.vote_average,
              'releaseYear', history.release_year,
              'castIds', history.cast_ids,
              'castNames', history.cast_names,
              'castProfilePaths', history.cast_profile_paths,
              'castGenders', history.cast_genders,
              'directorIds', history.director_ids,
              'directorNames', history.director_names,
              'directorProfilePaths', history.director_profile_paths,
              'watchedAt', history.watched_at,
              'metadataVersion', history.metadata_version,
              'snapshot', history.snapshot,
              'updatedAt', history.updated_at
            )
            order by history.watched_at desc
          )
          from public.user_watch_history as history
          where history.user_id = auth.uid()
        ),
        '[]'::jsonb
      ),
    'episodeProgress',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'seriesTmdbId', progress.series_tmdb_id,
              'seasonNumber', progress.season_number,
              'episodeNumber', progress.episode_number,
              'watchedAt', progress.watched_at,
              'snapshot', progress.snapshot,
              'updatedAt', progress.updated_at
            )
            order by progress.watched_at desc
          )
          from public.user_episode_progress as progress
          where progress.user_id = auth.uid()
        ),
        '[]'::jsonb
      ),
    'dailyRecommendations',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'recommendationKind', recommendation.recommendation_kind,
              'recommendationDate', recommendation.recommendation_date,
              'mediaType', recommendation.media_type,
              'tmdbId', recommendation.tmdb_id,
              'imdbId', recommendation.imdb_id,
              'strategy', recommendation.strategy,
              'snapshot', recommendation.snapshot,
              'updatedAt', recommendation.updated_at
            )
            order by recommendation.recommendation_date desc
          )
          from public.user_daily_recommendations as recommendation
          where recommendation.user_id = auth.uid()
        ),
        '[]'::jsonb
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.handle_streambox_user_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_display_name text;
begin
  next_display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'My Profile');

  insert into public.user_profiles (id, display_name, joined_at)
  values (new.id, next_display_name, coalesce(new.created_at, timezone('utc', now())))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, theme_id)
  values (new.id, 'cinema-ember')
  on conflict (user_id) do nothing;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_watch_room_member(p_room_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_room_id uuid;
begin
  begin
    v_room_id := p_room_id::uuid;
  exception
    when others then
      return false;
  end;

  return exists (
    select 1
    from public.watch_room_members
    where room_id = v_room_id
      and user_id = auth.uid()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_watch_room_member_by_code(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.watch_rooms r
    join public.watch_room_members m on m.room_id = r.id
    where r.code = upper(p_code)
      and m.user_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.join_watch_room(p_code text, p_nickname text)
 RETURNS watch_rooms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_room public.watch_rooms;
  v_member_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_room
  from public.watch_rooms
  where code = upper(btrim(p_code))
    and status <> 'ended'
    and expires_at > timezone('utc', now())
  for update;

  if not found then
    -- Sleep BEFORE raising: the exception rolls the transaction back, but the
    -- wall-clock cost stands — wrong guesses pay it, real users never do.
    perform pg_sleep(0.5);
    raise exception 'room not found or expired' using errcode = 'P0002';
  end if;

  -- Already a member (host re-entering, or a reconnect): just refresh the
  -- nickname and return. No uniqueness check — any nickname is allowed.
  if exists (
    select 1 from public.watch_room_members
    where room_id = v_room.id and user_id = auth.uid()
  ) then
    update public.watch_room_members
    set nickname = btrim(p_nickname)
    where room_id = v_room.id and user_id = auth.uid();
    return v_room;
  end if;

  select count(*) into v_member_count
  from public.watch_room_members
  where room_id = v_room.id;

  if v_member_count >= 2 then
    raise exception 'room is full' using errcode = 'P0001';
  end if;

  insert into public.watch_room_members (room_id, user_id, nickname, role)
  values (v_room.id, auth.uid(), btrim(p_nickname), 'guest')
  on conflict (room_id, user_id) do update set nickname = excluded.nickname;

  return v_room;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.log_streambox_user_event(action_category text, action_type text, entity_type text DEFAULT NULL::text, entity_key text DEFAULT NULL::text, metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_action_category text := nullif(btrim(action_category), '');
  normalized_action_type text := nullif(btrim(action_type), '');
  normalized_entity_type text := nullif(btrim(entity_type), '');
  normalized_entity_key text := nullif(btrim(entity_key), '');
  normalized_metadata jsonb := coalesce(metadata, '{}'::jsonb);
  inserted_log_id bigint;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if normalized_action_category is null then
    raise exception 'action_category is required';
  end if;

  if normalized_action_type is null then
    raise exception 'action_type is required';
  end if;

  if jsonb_typeof(normalized_metadata) <> 'object' then
    raise exception 'metadata must be a json object';
  end if;

  insert into public.user_audit_logs (
    user_id,
    action_category,
    action_type,
    entity_type,
    entity_key,
    metadata
  )
  values (
    current_user_id,
    normalized_action_category,
    normalized_action_type,
    normalized_entity_type,
    normalized_entity_key,
    normalized_metadata
  )
  returning id into inserted_log_id;

  return inserted_log_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.make_streambox_entity_key(input_media_type media_type, input_tmdb_id bigint DEFAULT NULL::bigint, input_internal_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select concat(input_media_type::text, ':', coalesce(input_tmdb_id::text, input_internal_id::text));
$function$
;
CREATE OR REPLACE FUNCTION public.propagate_streambox_user_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.propagate_streambox_user_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.provider_configs_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prune_recently_viewed_library_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.list_kind <> 'recently_viewed' then
    return null;
  end if;

  delete from public.user_media_library as library
  where library.user_id = new.user_id
    and library.list_kind = 'recently_viewed'
    and (library.media_type, library.tmdb_id) in (
      select stale.media_type, stale.tmdb_id
      from (
        select
          media_type,
          tmdb_id,
          row_number() over (
            order by collected_at desc, updated_at desc, tmdb_id desc
          ) as row_num
        from public.user_media_library
        where user_id = new.user_id
          and list_kind = 'recently_viewed'
      ) as stale
      where stale.row_num > 30
    );

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.remove_watch_memory(p_memory_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_remaining uuid[];
  v_image text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.watch_room_memories
  set participant_user_ids = array_remove(participant_user_ids, auth.uid())
  where id = p_memory_id
    and auth.uid() = any (participant_user_ids)
  returning participant_user_ids, image_path into v_remaining, v_image;

  -- Caller was not a participant (or the row is already gone): nothing to do.
  if not found then
    return;
  end if;

  -- Last participant out: hard-delete the row; clean up its polaroid object as a
  -- best-effort step that must never abort the row deletion.
  if coalesce(array_length(v_remaining, 1), 0) = 0 then
    delete from public.watch_room_memories where id = p_memory_id;
    begin
      delete from storage.objects
        where bucket_id = 'watch-memories' and name = v_image;
    exception
      when others then
        null; -- ignore storage cleanup failures; the memory is already gone
    end;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_streambox_user_display_name(target_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select nullif(btrim(profile.display_name), '')
      from public.user_profiles as profile
      where profile.id = target_user_id
    ),
    'My Profile'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_streambox_user_email(target_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(u.email), '')
  from auth.users as u
  where u.id = target_user_id;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_episode_progress(p_series_tmdb_id bigint, p_season_number integer, p_episode_number integer, p_is_watched boolean, p_watched_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_snapshot jsonb DEFAULT '{}'::jsonb, p_audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  next_watched_at timestamptz := coalesce(p_watched_at, timezone('utc', now()));
  affected_rows integer := 0;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_series_tmdb_id <= 0 or p_season_number <= 0 or p_episode_number <= 0 then
    raise exception 'series_tmdb_id, season_number, and episode_number must all be greater than 0';
  end if;

  if jsonb_typeof(normalized_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if p_is_watched then
    insert into public.user_episode_progress (
      user_id,
      series_tmdb_id,
      season_number,
      episode_number,
      watched_at,
      snapshot
    )
    values (
      current_user_id,
      p_series_tmdb_id,
      p_season_number,
      p_episode_number,
      next_watched_at,
      normalized_snapshot
    )
    on conflict (user_id, series_tmdb_id, season_number, episode_number)
    do update
      set watched_at = excluded.watched_at,
          snapshot = excluded.snapshot;

    return true;
  end if;

  delete from public.user_episode_progress
  where user_id = current_user_id
    and public.user_episode_progress.series_tmdb_id = p_series_tmdb_id
    and public.user_episode_progress.season_number = p_season_number
    and public.user_episode_progress.episode_number = p_episode_number;

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_media_library_item(p_operation text, p_list_kind user_media_list_kind, p_media_type media_type, p_tmdb_id bigint DEFAULT NULL::bigint, p_imdb_id text DEFAULT NULL::text, p_collected_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_snapshot jsonb DEFAULT NULL::jsonb, p_audit_metadata jsonb DEFAULT NULL::jsonb, p_internal_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_operation text := lower(coalesce(btrim(p_operation), ''));
  normalized_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
  next_collected_at timestamptz := coalesce(p_collected_at, timezone('utc', now()));
  affected_rows integer := 0;
  resolved_action_type text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_tmdb_id is null and p_internal_id is null then
    raise exception 'either tmdb_id or internal_id must be provided';
  end if;

  if normalized_operation = 'upsert' then
    if p_tmdb_id is not null then
      insert into public.user_media_library (user_id, list_kind, media_type, tmdb_id, internal_id, imdb_id, collected_at, snapshot)
      values (current_user_id, p_list_kind, p_media_type, p_tmdb_id, null, nullif(p_imdb_id, ''), next_collected_at, normalized_snapshot)
      on conflict (user_id, list_kind, media_type, tmdb_id) WHERE tmdb_id IS NOT NULL
      do update set imdb_id = excluded.imdb_id, collected_at = excluded.collected_at, snapshot = excluded.snapshot;
    else
      insert into public.user_media_library (user_id, list_kind, media_type, tmdb_id, internal_id, imdb_id, collected_at, snapshot)
      values (current_user_id, p_list_kind, p_media_type, null, p_internal_id, nullif(p_imdb_id, ''), next_collected_at, normalized_snapshot)
      on conflict (user_id, list_kind, media_type, internal_id) WHERE internal_id IS NOT NULL
      do update set imdb_id = excluded.imdb_id, collected_at = excluded.collected_at, snapshot = excluded.snapshot;
    end if;

    resolved_action_type := case
      when p_list_kind = 'watchlist' then 'watchlist_added'
      when p_list_kind = 'liked' then 'liked_added'
      else null
    end;

    if resolved_action_type is not null then
      perform public.log_streambox_user_event(
        'library', resolved_action_type, p_list_kind::text,
        public.make_streambox_entity_key(p_media_type, p_tmdb_id, p_internal_id),
        normalized_audit_metadata || jsonb_build_object('listKind', p_list_kind::text, 'mediaType', p_media_type::text, 'tmdbId', p_tmdb_id, 'internalId', p_internal_id)
      );
    end if;

    return true;
  end if;

  if normalized_operation = 'delete' then
    if p_tmdb_id is not null then
      delete from public.user_media_library where user_id = current_user_id and list_kind = p_list_kind and media_type = p_media_type and tmdb_id = p_tmdb_id;
    else
      delete from public.user_media_library where user_id = current_user_id and list_kind = p_list_kind and media_type = p_media_type and internal_id = p_internal_id;
    end if;

    get diagnostics affected_rows = row_count;

    if affected_rows > 0 then
      resolved_action_type := case
        when p_list_kind = 'watchlist' then 'watchlist_removed'
        when p_list_kind = 'liked' then 'liked_removed'
        else null
      end;

      if resolved_action_type is not null then
        perform public.log_streambox_user_event(
          'library', resolved_action_type, p_list_kind::text,
          public.make_streambox_entity_key(p_media_type, p_tmdb_id, p_internal_id),
          normalized_audit_metadata || jsonb_build_object('listKind', p_list_kind::text, 'mediaType', p_media_type::text, 'tmdbId', p_tmdb_id, 'internalId', p_internal_id)
        );
      end if;
    end if;

    return affected_rows > 0;
  end if;

  raise exception 'operation must be either upsert or delete';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_media_library_item(p_operation text, p_list_kind user_media_list_kind, p_media_type media_type, p_tmdb_id bigint, p_imdb_id text DEFAULT NULL::text, p_collected_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_snapshot jsonb DEFAULT '{}'::jsonb, p_audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_operation text := lower(coalesce(btrim(p_operation), ''));
  normalized_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
  next_collected_at timestamptz := coalesce(p_collected_at, timezone('utc', now()));
  affected_rows integer := 0;
  resolved_action_type text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_tmdb_id <= 0 then
    raise exception 'tmdb_id must be greater than 0';
  end if;

  if jsonb_typeof(normalized_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if jsonb_typeof(normalized_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  if normalized_operation = 'upsert' then
    insert into public.user_media_library (
      user_id,
      list_kind,
      media_type,
      tmdb_id,
      imdb_id,
      collected_at,
      snapshot
    )
    values (
      current_user_id,
      p_list_kind,
      p_media_type,
      p_tmdb_id,
      nullif(p_imdb_id, ''),
      next_collected_at,
      normalized_snapshot
    )
    on conflict (user_id, list_kind, media_type, tmdb_id)
    do update
      set imdb_id = excluded.imdb_id,
          collected_at = excluded.collected_at,
          snapshot = excluded.snapshot;

    resolved_action_type := case
      when p_list_kind = 'watchlist' then 'watchlist_added'
      when p_list_kind = 'liked' then 'liked_added'
      else null
    end;

    if resolved_action_type is not null then
      perform public.log_streambox_user_event(
        'library',
        resolved_action_type,
        p_list_kind::text,
        public.make_streambox_entity_key(p_media_type, p_tmdb_id),
        normalized_audit_metadata
          || jsonb_build_object('listKind', p_list_kind::text, 'mediaType', p_media_type::text, 'tmdbId', p_tmdb_id)
      );
    end if;

    return true;
  end if;

  if normalized_operation = 'delete' then
    delete from public.user_media_library
    where user_id = current_user_id
      and public.user_media_library.list_kind = p_list_kind
      and public.user_media_library.media_type = p_media_type
      and public.user_media_library.tmdb_id = p_tmdb_id;

    get diagnostics affected_rows = row_count;

    if affected_rows > 0 then
      resolved_action_type := case
        when p_list_kind = 'watchlist' then 'watchlist_removed'
        when p_list_kind = 'liked' then 'liked_removed'
        else null
      end;

      if resolved_action_type is not null then
        perform public.log_streambox_user_event(
          'library',
          resolved_action_type,
          p_list_kind::text,
          public.make_streambox_entity_key(p_media_type, p_tmdb_id),
          normalized_audit_metadata
            || jsonb_build_object('listKind', p_list_kind::text, 'mediaType', p_media_type::text, 'tmdbId', p_tmdb_id)
        );
      end if;
    end if;

    return affected_rows > 0;
  end if;

  raise exception 'operation must be either upsert or delete';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_profile_and_settings(profile_payload jsonb DEFAULT '{}'::jsonb, settings_payload jsonb DEFAULT '{}'::jsonb, audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  current_settings public.user_settings%rowtype;
  normalized_profile jsonb := coalesce(profile_payload, '{}'::jsonb);
  normalized_settings jsonb := coalesce(settings_payload, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(audit_metadata, '{}'::jsonb);
  next_display_name text;
  next_bio text;
  next_location text;
  next_birthday date;
  next_joined_at timestamptz;
  next_avatar_path text;
  next_banner_path text;
  next_avatar_version integer;
  next_banner_version integer;
  next_theme_id text;
  next_onboarding_completed_at timestamptz;
  next_preferences jsonb;
  changed_profile_fields text[] := '{}'::text[];
  changed_asset_fields text[] := '{}'::text[];
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(normalized_profile) <> 'object' then
    raise exception 'profile_payload must be a json object';
  end if;

  if jsonb_typeof(normalized_settings) <> 'object' then
    raise exception 'settings_payload must be a json object';
  end if;

  if jsonb_typeof(normalized_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  insert into public.user_profiles (id, display_name, joined_at)
  values (current_user_id, 'My Profile', timezone('utc', now()))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, theme_id)
  values (current_user_id, 'cinema-ember')
  on conflict (user_id) do nothing;

  select *
  into current_profile
  from public.user_profiles
  where id = current_user_id;

  select *
  into current_settings
  from public.user_settings
  where user_id = current_user_id;

  next_display_name := coalesce(
    case when normalized_profile ? 'displayName' then nullif(btrim(normalized_profile ->> 'displayName'), '') end,
    current_profile.display_name,
    'My Profile'
  );
  next_bio := coalesce(case when normalized_profile ? 'bio' then normalized_profile ->> 'bio' end, current_profile.bio, '');
  next_location := coalesce(
    case when normalized_profile ? 'location' then normalized_profile ->> 'location' end,
    current_profile.location_text,
    ''
  );
  next_birthday := case
    when normalized_profile ? 'birthday' then nullif(normalized_profile ->> 'birthday', '')::date
    else current_profile.birthday
  end;
  next_joined_at := case
    when normalized_profile ? 'joinedAt' then coalesce((normalized_profile ->> 'joinedAt')::timestamptz, current_profile.joined_at)
    else current_profile.joined_at
  end;
  next_avatar_path := case
    when normalized_profile ? 'avatarPath' then nullif(normalized_profile ->> 'avatarPath', '')
    else current_profile.avatar_path
  end;
  next_banner_path := case
    when normalized_profile ? 'bannerPath' then nullif(normalized_profile ->> 'bannerPath', '')
    else current_profile.banner_path
  end;
  next_avatar_version := case
    when normalized_profile ? 'avatarVersion' then greatest(coalesce((normalized_profile ->> 'avatarVersion')::integer, 0), 0)
    else current_profile.avatar_version
  end;
  next_banner_version := case
    when normalized_profile ? 'bannerVersion' then greatest(coalesce((normalized_profile ->> 'bannerVersion')::integer, 0), 0)
    else current_profile.banner_version
  end;
  next_theme_id := coalesce(
    case when normalized_settings ? 'themeId' then nullif(btrim(normalized_settings ->> 'themeId'), '') end,
    current_settings.theme_id,
    'cinema-ember'
  );
  next_onboarding_completed_at := case
    when normalized_settings ? 'onboardingCompletedAt' then nullif(normalized_settings ->> 'onboardingCompletedAt', '')::timestamptz
    else current_settings.onboarding_completed_at
  end;
  next_preferences := case
    when normalized_settings ? 'preferences' then normalized_settings -> 'preferences'
    else current_settings.preferences
  end;

  if next_preferences is null then
    next_preferences := '{}'::jsonb;
  end if;

  if jsonb_typeof(next_preferences) <> 'object' then
    raise exception 'settings preferences must be a json object';
  end if;

  if current_profile.display_name is distinct from next_display_name then
    changed_profile_fields := array_append(changed_profile_fields, 'displayName');
  end if;

  if current_profile.bio is distinct from next_bio then
    changed_profile_fields := array_append(changed_profile_fields, 'bio');
  end if;

  if current_profile.location_text is distinct from next_location then
    changed_profile_fields := array_append(changed_profile_fields, 'location');
  end if;

  if current_profile.birthday is distinct from next_birthday then
    changed_profile_fields := array_append(changed_profile_fields, 'birthday');
  end if;

  if current_profile.joined_at is distinct from next_joined_at then
    changed_profile_fields := array_append(changed_profile_fields, 'joinedAt');
  end if;

  if current_profile.avatar_path is distinct from next_avatar_path then
    changed_asset_fields := array_append(changed_asset_fields, 'avatarPath');
  end if;

  if current_profile.banner_path is distinct from next_banner_path then
    changed_asset_fields := array_append(changed_asset_fields, 'bannerPath');
  end if;

  if current_profile.avatar_version is distinct from next_avatar_version then
    changed_asset_fields := array_append(changed_asset_fields, 'avatarVersion');
  end if;

  if current_profile.banner_version is distinct from next_banner_version then
    changed_asset_fields := array_append(changed_asset_fields, 'bannerVersion');
  end if;

  update public.user_profiles
  set
    display_name = next_display_name,
    bio = next_bio,
    location_text = next_location,
    birthday = next_birthday,
    joined_at = coalesce(next_joined_at, current_profile.joined_at),
    avatar_path = next_avatar_path,
    banner_path = next_banner_path,
    avatar_version = next_avatar_version,
    banner_version = next_banner_version
  where id = current_user_id;

  update public.user_settings
  set
    theme_id = next_theme_id,
    onboarding_completed_at = next_onboarding_completed_at,
    preferences = next_preferences
  where user_id = current_user_id;

  if coalesce(array_length(changed_profile_fields, 1), 0) > 0 then
    perform public.log_streambox_user_event(
      'profile',
      'profile_updated',
      'profile',
      current_user_id::text,
      normalized_audit_metadata || jsonb_build_object('changedFields', to_jsonb(changed_profile_fields))
    );
  end if;

  if current_settings.theme_id is distinct from next_theme_id then
    perform public.log_streambox_user_event(
      'settings',
      'theme_changed',
      'settings',
      'theme',
      normalized_audit_metadata || jsonb_build_object('themeId', next_theme_id)
    );
  end if;

  if coalesce(array_length(changed_asset_fields, 1), 0) > 0 then
    perform public.log_streambox_user_event(
      'asset',
      'profile_assets_updated',
      'profile_assets',
      current_user_id::text,
      normalized_audit_metadata || jsonb_build_object('changedFields', to_jsonb(changed_asset_fields))
    );
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_watch_history_entry(p_media_type media_type, p_tmdb_id bigint DEFAULT NULL::bigint, p_imdb_id text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_poster_path text DEFAULT NULL::text, p_genres text[] DEFAULT NULL::text[], p_runtime_minutes integer DEFAULT NULL::integer, p_episode_count integer DEFAULT NULL::integer, p_vote_average numeric DEFAULT NULL::numeric, p_release_year integer DEFAULT NULL::integer, p_cast_ids bigint[] DEFAULT NULL::bigint[], p_cast_names text[] DEFAULT NULL::text[], p_cast_profile_paths text[] DEFAULT NULL::text[], p_cast_genders text[] DEFAULT NULL::text[], p_director_ids bigint[] DEFAULT NULL::bigint[], p_director_names text[] DEFAULT NULL::text[], p_director_profile_paths text[] DEFAULT NULL::text[], p_watched_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metadata_version integer DEFAULT NULL::integer, p_snapshot jsonb DEFAULT NULL::jsonb, p_audit_metadata jsonb DEFAULT NULL::jsonb, p_internal_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
begin
  if current_user_id is null then raise exception 'not authenticated'; end if;
  if p_tmdb_id is null and p_internal_id is null then raise exception 'either tmdb_id or internal_id must be provided'; end if;
  if nullif(btrim(p_title), '') is null then raise exception 'title is required'; end if;

  if p_tmdb_id is not null then
    insert into public.user_watch_history (
      user_id, media_type, tmdb_id, internal_id, imdb_id, title, poster_path, genres, runtime_minutes, 
      episode_count, vote_average, release_year, cast_ids, cast_names, cast_profile_paths, cast_genders, 
      director_ids, director_names, director_profile_paths, watched_at, metadata_version, snapshot
    )
    values (
      current_user_id, p_media_type, p_tmdb_id, null, nullif(p_imdb_id, ''), btrim(p_title), p_poster_path, 
      coalesce(p_genres, '{}'::text[]), p_runtime_minutes, p_episode_count, coalesce(p_vote_average, 0), 
      p_release_year, coalesce(p_cast_ids, '{}'::bigint[]), coalesce(p_cast_names, '{}'::text[]), 
      coalesce(p_cast_profile_paths, '{}'::text[]), coalesce(p_cast_genders, '{}'::text[]), 
      coalesce(p_director_ids, '{}'::bigint[]), coalesce(p_director_names, '{}'::text[]), 
      coalesce(p_director_profile_paths, '{}'::text[]), p_watched_at, greatest(coalesce(p_metadata_version, 1), 1), 
      normalized_snapshot
    )
    on conflict (user_id, media_type, tmdb_id) WHERE tmdb_id IS NOT NULL
    do update set imdb_id = excluded.imdb_id, title = excluded.title, poster_path = excluded.poster_path, 
                  genres = excluded.genres, runtime_minutes = excluded.runtime_minutes, 
                  episode_count = excluded.episode_count, vote_average = excluded.vote_average, 
                  release_year = excluded.release_year, cast_ids = excluded.cast_ids, 
                  cast_names = excluded.cast_names, cast_profile_paths = excluded.cast_profile_paths, 
                  cast_genders = excluded.cast_genders, director_ids = excluded.director_ids, 
                  director_names = excluded.director_names, director_profile_paths = excluded.director_profile_paths, 
                  watched_at = excluded.watched_at, metadata_version = excluded.metadata_version, snapshot = excluded.snapshot;
  else
    insert into public.user_watch_history (
      user_id, media_type, tmdb_id, internal_id, imdb_id, title, poster_path, genres, runtime_minutes, 
      episode_count, vote_average, release_year, cast_ids, cast_names, cast_profile_paths, cast_genders, 
      director_ids, director_names, director_profile_paths, watched_at, metadata_version, snapshot
    )
    values (
      current_user_id, p_media_type, null, p_internal_id, nullif(p_imdb_id, ''), btrim(p_title), p_poster_path, 
      coalesce(p_genres, '{}'::text[]), p_runtime_minutes, p_episode_count, coalesce(p_vote_average, 0), 
      p_release_year, coalesce(p_cast_ids, '{}'::bigint[]), coalesce(p_cast_names, '{}'::text[]), 
      coalesce(p_cast_profile_paths, '{}'::text[]), coalesce(p_cast_genders, '{}'::text[]), 
      coalesce(p_director_ids, '{}'::bigint[]), coalesce(p_director_names, '{}'::text[]), 
      coalesce(p_director_profile_paths, '{}'::text[]), p_watched_at, greatest(coalesce(p_metadata_version, 1), 1), 
      normalized_snapshot
    )
    on conflict (user_id, media_type, internal_id) WHERE internal_id IS NOT NULL
    do update set imdb_id = excluded.imdb_id, title = excluded.title, poster_path = excluded.poster_path, 
                  genres = excluded.genres, runtime_minutes = excluded.runtime_minutes, 
                  episode_count = excluded.episode_count, vote_average = excluded.vote_average, 
                  release_year = excluded.release_year, cast_ids = excluded.cast_ids, 
                  cast_names = excluded.cast_names, cast_profile_paths = excluded.cast_profile_paths, 
                  cast_genders = excluded.cast_genders, director_ids = excluded.director_ids, 
                  director_names = excluded.director_names, director_profile_paths = excluded.director_profile_paths, 
                  watched_at = excluded.watched_at, metadata_version = excluded.metadata_version, snapshot = excluded.snapshot;
  end if;

  perform public.log_streambox_user_event(
    'watch_history', 'watch_history_saved', p_media_type::text,
    public.make_streambox_entity_key(p_media_type, p_tmdb_id, p_internal_id),
    normalized_audit_metadata || jsonb_build_object('mediaType', p_media_type::text, 'tmdbId', p_tmdb_id, 'internalId', p_internal_id, 'watchedAt', p_watched_at)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_streambox_watch_history_entry(p_media_type media_type, p_tmdb_id bigint, p_imdb_id text, p_title text, p_poster_path text, p_genres text[], p_runtime_minutes integer, p_episode_count integer, p_vote_average numeric, p_release_year integer, p_cast_ids bigint[], p_cast_names text[], p_cast_profile_paths text[], p_cast_genders text[], p_director_ids bigint[], p_director_names text[], p_director_profile_paths text[], p_watched_at timestamp with time zone, p_metadata_version integer, p_snapshot jsonb DEFAULT '{}'::jsonb, p_audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  current_user_id uuid := auth.uid();
  normalized_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(p_audit_metadata, '{}'::jsonb);
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_tmdb_id <= 0 then
    raise exception 'tmdb_id must be greater than 0';
  end if;

  if nullif(btrim(p_title), '') is null then
    raise exception 'title is required';
  end if;

  if jsonb_typeof(normalized_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if jsonb_typeof(normalized_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  insert into public.user_watch_history (
    user_id,
    media_type,
    tmdb_id,
    imdb_id,
    title,
    poster_path,
    genres,
    runtime_minutes,
    episode_count,
    vote_average,
    release_year,
    cast_ids,
    cast_names,
    cast_profile_paths,
    cast_genders,
    director_ids,
    director_names,
    director_profile_paths,
    watched_at,
    metadata_version,
    snapshot
  )
  values (
    current_user_id,
    p_media_type,
    p_tmdb_id,
    nullif(p_imdb_id, ''),
    btrim(p_title),
    p_poster_path,
    coalesce(p_genres, '{}'::text[]),
    p_runtime_minutes,
    p_episode_count,
    coalesce(p_vote_average, 0),
    p_release_year,
    coalesce(p_cast_ids, '{}'::bigint[]),
    coalesce(p_cast_names, '{}'::text[]),
    coalesce(p_cast_profile_paths, '{}'::text[]),
    coalesce(p_cast_genders, '{}'::text[]),
    coalesce(p_director_ids, '{}'::bigint[]),
    coalesce(p_director_names, '{}'::text[]),
    coalesce(p_director_profile_paths, '{}'::text[]),
    p_watched_at,
    greatest(coalesce(p_metadata_version, 1), 1),
    normalized_snapshot
  )
  on conflict (user_id, media_type, tmdb_id)
  do update
    set imdb_id = excluded.imdb_id,
        title = excluded.title,
        poster_path = excluded.poster_path,
        genres = excluded.genres,
        runtime_minutes = excluded.runtime_minutes,
        episode_count = excluded.episode_count,
        vote_average = excluded.vote_average,
        release_year = excluded.release_year,
        cast_ids = excluded.cast_ids,
        cast_names = excluded.cast_names,
        cast_profile_paths = excluded.cast_profile_paths,
        cast_genders = excluded.cast_genders,
        director_ids = excluded.director_ids,
        director_names = excluded.director_names,
        director_profile_paths = excluded.director_profile_paths,
        watched_at = excluded.watched_at,
        metadata_version = excluded.metadata_version,
        snapshot = excluded.snapshot;

  perform public.log_streambox_user_event(
    'watch_history',
    'watch_history_saved',
    p_media_type::text,
    public.make_streambox_entity_key(p_media_type, p_tmdb_id),
    normalized_audit_metadata
      || jsonb_build_object('mediaType', p_media_type::text, 'tmdbId', p_tmdb_id, 'watchedAt', p_watched_at)
  );
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Primary keys, unique and check constraints
-- ---------------------------------------------------------------------------
alter table public.app_announcements add constraint app_announcements_pkey PRIMARY KEY (id);
alter table public.app_telemetry_events add constraint app_telemetry_events_pkey PRIMARY KEY (id);
alter table public.app_themes add constraint app_themes_pkey PRIMARY KEY (id);
alter table public.external_ratings_alert_events add constraint external_ratings_alert_events_pkey PRIMARY KEY (id);
alter table public.external_ratings_cache add constraint external_ratings_cache_pkey PRIMARY KEY (imdb_id);
alter table public.external_ratings_function_logs add constraint external_ratings_function_logs_pkey PRIMARY KEY (id);
alter table public.franchise_collections add constraint franchise_collections_pkey PRIMARY KEY (id);
alter table public.franchise_entries add constraint franchise_entries_pkey PRIMARY KEY (id);
alter table public.provider_configs add constraint provider_configs_pkey PRIMARY KEY (id);
alter table private.rate_limit_windows add constraint rate_limit_windows_pkey PRIMARY KEY (user_id, action_key, window_started_at);
alter table public.user_announcement_views add constraint user_announcement_views_pkey PRIMARY KEY (user_id, announcement_id, display_version);
alter table public.user_audit_logs add constraint user_audit_logs_pkey PRIMARY KEY (id);
alter table public.user_daily_recommendations add constraint user_daily_recommendations_pkey PRIMARY KEY (user_id, recommendation_kind, recommendation_date);
alter table public.user_episode_progress add constraint user_episode_progress_pkey PRIMARY KEY (user_id, series_tmdb_id, season_number, episode_number);
alter table public.user_franchise_progress add constraint user_franchise_progress_pkey PRIMARY KEY (user_id, entry_id);
alter table public.user_profiles add constraint user_profiles_pkey PRIMARY KEY (id);
alter table public.user_settings add constraint user_settings_pkey PRIMARY KEY (user_id);
alter table public.watch_room_members add constraint watch_room_members_pkey PRIMARY KEY (id);
alter table public.watch_room_memories add constraint watch_room_memories_pkey PRIMARY KEY (id);
alter table public.watch_rooms add constraint watch_rooms_pkey PRIMARY KEY (id);
alter table public.app_announcements add constraint app_announcements_slug_key UNIQUE (slug);
alter table public.app_themes add constraint app_themes_sort_order_key UNIQUE (sort_order);
alter table public.franchise_collections add constraint franchise_collections_slug_key UNIQUE (slug);
alter table public.franchise_entries add constraint franchise_entries_franchise_id_watch_order_key UNIQUE (franchise_id, watch_order);
alter table public.watch_room_members add constraint watch_room_members_room_id_user_id_key UNIQUE (room_id, user_id);
alter table public.watch_rooms add constraint watch_rooms_code_key UNIQUE (code);
alter table public.app_announcements add constraint app_announcements_accent_hex_check CHECK (((accent_hex IS NULL) OR (accent_hex ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.app_announcements add constraint app_announcements_body_en_check CHECK (((char_length(body_en) >= 1) AND (char_length(body_en) <= 1200)));
alter table public.app_announcements add constraint app_announcements_body_tr_check CHECK (((body_tr IS NULL) OR ((char_length(body_tr) >= 1) AND (char_length(body_tr) <= 1200))));
alter table public.app_announcements add constraint app_announcements_check CHECK (((ends_at IS NULL) OR (ends_at > starts_at)));
alter table public.app_announcements add constraint app_announcements_cta_label_en_check CHECK (((cta_label_en IS NULL) OR ((char_length(btrim(cta_label_en)) >= 1) AND (char_length(btrim(cta_label_en)) <= 40))));
alter table public.app_announcements add constraint app_announcements_cta_label_tr_check CHECK (((cta_label_tr IS NULL) OR ((char_length(btrim(cta_label_tr)) >= 1) AND (char_length(btrim(cta_label_tr)) <= 40))));
alter table public.app_announcements add constraint app_announcements_display_version_check CHECK ((display_version >= 1));
alter table public.app_announcements add constraint app_announcements_eyebrow_en_check CHECK (((eyebrow_en IS NULL) OR ((char_length(btrim(eyebrow_en)) >= 1) AND (char_length(btrim(eyebrow_en)) <= 80))));
alter table public.app_announcements add constraint app_announcements_eyebrow_tr_check CHECK (((eyebrow_tr IS NULL) OR ((char_length(btrim(eyebrow_tr)) >= 1) AND (char_length(btrim(eyebrow_tr)) <= 80))));
alter table public.app_announcements add constraint app_announcements_priority_check CHECK (((priority >= 0) AND (priority <= 10000)));
alter table public.app_announcements add constraint app_announcements_slug_check CHECK (((char_length(btrim(slug)) >= 1) AND (char_length(btrim(slug)) <= 120)));
alter table public.app_announcements add constraint app_announcements_title_en_check CHECK (((char_length(btrim(title_en)) >= 1) AND (char_length(btrim(title_en)) <= 120)));
alter table public.app_announcements add constraint app_announcements_title_tr_check CHECK (((title_tr IS NULL) OR ((char_length(btrim(title_tr)) >= 1) AND (char_length(btrim(title_tr)) <= 120))));
alter table public.app_telemetry_events add constraint app_telemetry_category_check CHECK ((event_category = ANY (ARRAY['app'::text, 'crash'::text, 'network'::text, 'performance'::text, 'supabase'::text, 'tmdb'::text])));
alter table public.app_telemetry_events add constraint app_telemetry_event_name_length CHECK (((char_length(event_name) >= 2) AND (char_length(event_name) <= 120)));
alter table public.app_telemetry_events add constraint app_telemetry_metadata_object CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table public.app_telemetry_events add constraint app_telemetry_session_id_length CHECK (((char_length(session_id) >= 8) AND (char_length(session_id) <= 80)));
alter table public.app_telemetry_events add constraint app_telemetry_severity_check CHECK ((severity = ANY (ARRAY['debug'::text, 'info'::text, 'warning'::text, 'error'::text, 'fatal'::text])));
alter table public.app_themes add constraint app_themes_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 240)));
alter table public.app_themes add constraint app_themes_display_name_check CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 80)));
alter table public.app_themes add constraint app_themes_id_check CHECK (((char_length(btrim(id)) >= 1) AND (char_length(btrim(id)) <= 50)));
alter table public.app_themes add constraint app_themes_primary_color_check CHECK ((primary_color ~ '^#[0-9A-Fa-f]{6}$'::text));
alter table public.app_themes add constraint app_themes_sort_order_check CHECK ((sort_order >= 1));
alter table public.franchise_collections add constraint franchise_collections_accent_color_check CHECK (((accent_color IS NULL) OR (accent_color ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.franchise_collections add constraint franchise_collections_description_check CHECK (((description IS NULL) OR (char_length(description) <= 500)));
alter table public.franchise_collections add constraint franchise_collections_slug_check CHECK (((char_length(btrim(slug)) >= 1) AND (char_length(btrim(slug)) <= 80)));
alter table public.franchise_collections add constraint franchise_collections_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 120)));
alter table public.franchise_collections add constraint franchise_collections_total_entries_check CHECK ((total_entries >= 0));
alter table public.franchise_entries add constraint franchise_entries_episode_count_check CHECK (((episode_count IS NULL) OR ((episode_count >= 1) AND (episode_count <= 500))));
alter table public.franchise_entries add constraint franchise_entries_media_type_check CHECK ((media_type = ANY (ARRAY['movie'::text, 'tv'::text])));
alter table public.franchise_entries add constraint franchise_entries_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));
alter table public.franchise_entries add constraint franchise_entries_phase_check CHECK (((phase IS NULL) OR (char_length(btrim(phase)) <= 80)));
alter table public.franchise_entries add constraint franchise_entries_runtime_minutes_check CHECK (((runtime_minutes IS NULL) OR ((runtime_minutes >= 1) AND (runtime_minutes <= 5000))));
alter table public.franchise_entries add constraint franchise_entries_tagline_check CHECK (((tagline IS NULL) OR (char_length(tagline) <= 300)));
alter table public.franchise_entries add constraint franchise_entries_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)));
alter table public.franchise_entries add constraint franchise_entries_watch_order_check CHECK ((watch_order >= 1));
alter table public.franchise_entries add constraint franchise_entries_year_check CHECK (((year IS NULL) OR ((year >= 1900) AND (year <= 2100))));
alter table private.rate_limit_windows add constraint rate_limit_windows_action_key_check CHECK (((char_length(btrim(action_key)) >= 1) AND (char_length(btrim(action_key)) <= 64)));
alter table private.rate_limit_windows add constraint rate_limit_windows_hit_count_check CHECK ((hit_count >= 0));
alter table public.user_announcement_views add constraint user_announcement_views_display_version_check CHECK ((display_version >= 1));
alter table public.user_audit_logs add constraint user_audit_logs_action_category_check CHECK (((char_length(btrim(action_category)) >= 1) AND (char_length(btrim(action_category)) <= 64)));
alter table public.user_audit_logs add constraint user_audit_logs_action_type_check CHECK (((char_length(btrim(action_type)) >= 1) AND (char_length(btrim(action_type)) <= 120)));
alter table public.user_audit_logs add constraint user_audit_logs_entity_key_check CHECK (((entity_key IS NULL) OR ((char_length(btrim(entity_key)) >= 1) AND (char_length(btrim(entity_key)) <= 160))));
alter table public.user_audit_logs add constraint user_audit_logs_entity_type_check CHECK (((entity_type IS NULL) OR ((char_length(btrim(entity_type)) >= 1) AND (char_length(btrim(entity_type)) <= 80))));
alter table public.user_audit_logs add constraint user_audit_logs_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table public.user_daily_recommendations add constraint user_daily_recommendations_imdb_id_check CHECK (((imdb_id IS NULL) OR (imdb_id ~ '^tt[0-9]{7,10}$'::text)));
alter table public.user_daily_recommendations add constraint user_daily_recommendations_recommendation_kind_check CHECK (((char_length(btrim(recommendation_kind)) >= 1) AND (char_length(btrim(recommendation_kind)) <= 64)));
alter table public.user_daily_recommendations add constraint user_daily_recommendations_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text));
alter table public.user_daily_recommendations add constraint user_daily_recommendations_strategy_check CHECK (((strategy IS NULL) OR ((char_length(btrim(strategy)) >= 1) AND (char_length(btrim(strategy)) <= 64))));
alter table public.user_daily_recommendations add constraint user_daily_recommendations_tmdb_id_check CHECK (((tmdb_id IS NULL) OR (tmdb_id > 0)));
alter table public.user_episode_progress add constraint user_episode_progress_episode_number_check CHECK ((episode_number > 0));
alter table public.user_episode_progress add constraint user_episode_progress_season_number_check CHECK ((season_number > 0));
alter table public.user_episode_progress add constraint user_episode_progress_series_tmdb_id_check CHECK ((series_tmdb_id > 0));
alter table public.user_episode_progress add constraint user_episode_progress_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text));
alter table public.user_media_library add constraint user_media_library_imdb_id_check CHECK (((imdb_id IS NULL) OR (imdb_id ~ '^tt[0-9]{7,10}$'::text)));
alter table public.user_media_library add constraint user_media_library_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text));
alter table public.user_profiles add constraint user_profiles_avatar_path_check CHECK (((avatar_path IS NULL) OR (avatar_path ~* '^[0-9a-f-]{36}/avatars/[A-Za-z0-9._/-]{1,255}$'::text)));
alter table public.user_profiles add constraint user_profiles_avatar_version_check CHECK ((avatar_version >= 0));
alter table public.user_profiles add constraint user_profiles_banner_path_check CHECK (((banner_path IS NULL) OR (banner_path ~* '^[0-9a-f-]{36}/banners/[A-Za-z0-9._/-]{1,255}$'::text)));
alter table public.user_profiles add constraint user_profiles_banner_version_check CHECK ((banner_version >= 0));
alter table public.user_profiles add constraint user_profiles_bio_check CHECK ((char_length(bio) <= 160));
alter table public.user_profiles add constraint user_profiles_display_name_check CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 50)));
alter table public.user_profiles add constraint user_profiles_location_text_check CHECK ((char_length(location_text) <= 60));
alter table public.user_settings add constraint user_settings_preferences_check CHECK ((jsonb_typeof(preferences) = 'object'::text));
alter table public.user_watch_history add constraint user_watch_history_cast_genders_check CHECK (cast_gender_array_is_valid(cast_genders));
alter table public.user_watch_history add constraint user_watch_history_cast_ids_check CHECK ((cardinality(cast_ids) <= 5));
alter table public.user_watch_history add constraint user_watch_history_check CHECK ((cardinality(cast_ids) = cardinality(cast_names)));
alter table public.user_watch_history add constraint user_watch_history_check1 CHECK ((cardinality(cast_ids) = cardinality(cast_profile_paths)));
alter table public.user_watch_history add constraint user_watch_history_check2 CHECK ((cardinality(cast_ids) = cardinality(cast_genders)));
alter table public.user_watch_history add constraint user_watch_history_check3 CHECK ((cardinality(director_ids) = cardinality(director_names)));
alter table public.user_watch_history add constraint user_watch_history_check4 CHECK ((cardinality(director_ids) = cardinality(director_profile_paths)));
alter table public.user_watch_history add constraint user_watch_history_director_ids_check CHECK ((cardinality(director_ids) <= 5));
alter table public.user_watch_history add constraint user_watch_history_episode_count_check CHECK (((episode_count IS NULL) OR ((episode_count >= 1) AND (episode_count <= 50000))));
alter table public.user_watch_history add constraint user_watch_history_genres_check CHECK ((cardinality(genres) <= 25));
alter table public.user_watch_history add constraint user_watch_history_imdb_id_check CHECK (((imdb_id IS NULL) OR (imdb_id ~ '^tt[0-9]{7,10}$'::text)));
alter table public.user_watch_history add constraint user_watch_history_metadata_version_check CHECK ((metadata_version >= 1));
alter table public.user_watch_history add constraint user_watch_history_release_year_check CHECK (((release_year IS NULL) OR ((release_year >= 1878) AND (release_year <= 2100))));
alter table public.user_watch_history add constraint user_watch_history_runtime_minutes_check CHECK (((runtime_minutes IS NULL) OR ((runtime_minutes >= 1) AND (runtime_minutes <= 5000))));
alter table public.user_watch_history add constraint user_watch_history_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text));
alter table public.user_watch_history add constraint user_watch_history_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)));
alter table public.user_watch_history add constraint user_watch_history_vote_average_check CHECK (((vote_average >= (0)::numeric) AND (vote_average <= (10)::numeric)));
alter table public.watch_room_members add constraint watch_room_members_nickname_check CHECK (((char_length(btrim(nickname)) >= 1) AND (char_length(btrim(nickname)) <= 20)));
alter table public.watch_room_members add constraint watch_room_members_role_check CHECK ((role = ANY (ARRAY['host'::text, 'guest'::text])));
alter table public.watch_room_memories add constraint watch_room_memories_position_seconds_check CHECK ((position_seconds >= 0));
alter table public.watch_room_memories add constraint watch_room_memories_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 300)));
alter table public.watch_rooms add constraint watch_rooms_code_check CHECK ((code ~ '^[A-HJ-NP-Z2-9]{6}$'::text));
alter table public.watch_rooms add constraint watch_rooms_status_check CHECK ((status = ANY (ARRAY['lobby'::text, 'watching'::text, 'ended'::text])));
alter table public.watch_rooms add constraint watch_rooms_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 300)));
alter table public.watch_rooms add constraint watch_rooms_tmdb_id_check CHECK ((tmdb_id > 0));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
create or replace view public.admin_user_directory with (security_invoker=on) as
 SELECT u.id AS user_id,
    u.email AS user_email,
    p.display_name AS user_display_name,
    u.created_at AS auth_created_at,
    u.last_sign_in_at,
    p.joined_at AS profile_joined_at
   FROM auth.users u
     LEFT JOIN user_profiles p ON p.id = u.id;
create or replace view public.external_ratings_active_alerts with (security_invoker=on) as
 WITH recent_15m AS (
         SELECT external_ratings_function_logs.id,
            external_ratings_function_logs.function_name,
            external_ratings_function_logs.event_type,
            external_ratings_function_logs.status_code,
            external_ratings_function_logs.imdb_id,
            external_ratings_function_logs.cache_source,
            external_ratings_function_logs.latency_ms,
            external_ratings_function_logs.error_message,
            external_ratings_function_logs.metadata,
            external_ratings_function_logs.created_at
           FROM external_ratings_function_logs
          WHERE external_ratings_function_logs.created_at >= (timezone('utc'::text, now()) - '00:15:00'::interval)
        ), recent_60m AS (
         SELECT external_ratings_function_logs.id,
            external_ratings_function_logs.function_name,
            external_ratings_function_logs.event_type,
            external_ratings_function_logs.status_code,
            external_ratings_function_logs.imdb_id,
            external_ratings_function_logs.cache_source,
            external_ratings_function_logs.latency_ms,
            external_ratings_function_logs.error_message,
            external_ratings_function_logs.metadata,
            external_ratings_function_logs.created_at
           FROM external_ratings_function_logs
          WHERE external_ratings_function_logs.created_at >= (timezone('utc'::text, now()) - '01:00:00'::interval)
        )
 SELECT 'high_error_rate'::text AS alert_code,
    'high'::text AS severity,
    format('%s server-side ratings errors in the last 15 minutes.'::text, count(*)) AS message,
    count(*)::numeric AS metric_value,
    timezone('utc'::text, now()) - '00:15:00'::interval AS window_start,
    timezone('utc'::text, now()) AS evaluated_at
   FROM recent_15m
  WHERE recent_15m.status_code >= 500
 HAVING count(*) >= 3
UNION ALL
 SELECT 'stale_cache_burst'::text AS alert_code,
    'medium'::text AS severity,
    format('%s stale-cache responses served in the last hour.'::text, count(*)) AS message,
    count(*)::numeric AS metric_value,
    timezone('utc'::text, now()) - '01:00:00'::interval AS window_start,
    timezone('utc'::text, now()) AS evaluated_at
   FROM recent_60m
  WHERE recent_60m.event_type = 'stale_cache_served'::text
 HAVING count(*) >= 5
UNION ALL
 SELECT 'slow_upstream'::text AS alert_code,
    'medium'::text AS severity,
    format('Average ratings latency is %s ms across %s requests in the last 15 minutes.'::text, round(avg(recent_15m.latency_ms))::integer, count(*)) AS message,
    round(avg(recent_15m.latency_ms), 2) AS metric_value,
    timezone('utc'::text, now()) - '00:15:00'::interval AS window_start,
    timezone('utc'::text, now()) AS evaluated_at
   FROM recent_15m
  WHERE recent_15m.latency_ms IS NOT NULL
 HAVING count(*) >= 10 AND avg(recent_15m.latency_ms) >= 2500::numeric;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS app_announcements_active_priority_idx ON public.app_announcements USING btree (is_active, priority DESC, starts_at DESC);
CREATE INDEX IF NOT EXISTS app_telemetry_events_category_inserted_idx ON public.app_telemetry_events USING btree (event_category, inserted_at DESC);
CREATE INDEX IF NOT EXISTS app_telemetry_events_inserted_idx ON public.app_telemetry_events USING btree (inserted_at DESC);
CREATE INDEX IF NOT EXISTS app_telemetry_events_name_inserted_idx ON public.app_telemetry_events USING btree (event_name, inserted_at DESC);
CREATE INDEX IF NOT EXISTS app_telemetry_events_user_inserted_idx ON public.app_telemetry_events USING btree (user_id, inserted_at DESC);
CREATE INDEX IF NOT EXISTS app_themes_active_sort_idx ON public.app_themes USING btree (is_active, sort_order);
CREATE INDEX IF NOT EXISTS external_ratings_alert_events_created_at_idx ON public.external_ratings_alert_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS external_ratings_cache_expires_at_idx ON public.external_ratings_cache USING btree (expires_at);
CREATE INDEX IF NOT EXISTS external_ratings_cache_hot_refresh_idx ON public.external_ratings_cache USING btree (last_status, expires_at, last_accessed_at DESC, access_count DESC);
CREATE INDEX IF NOT EXISTS external_ratings_cache_last_accessed_at_idx ON public.external_ratings_cache USING btree (last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS external_ratings_function_logs_created_at_idx ON public.external_ratings_function_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS external_ratings_function_logs_event_type_idx ON public.external_ratings_function_logs USING btree (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS external_ratings_function_logs_status_idx ON public.external_ratings_function_logs USING btree (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS franchise_entries_franchise_order_idx ON public.franchise_entries USING btree (franchise_id, watch_order);
CREATE INDEX IF NOT EXISTS idx_franchise_collections_sort_order ON public.franchise_collections USING btree (sort_order);
CREATE INDEX IF NOT EXISTS idx_franchise_entries_franchise_id ON public.franchise_entries USING btree (franchise_id);
CREATE INDEX IF NOT EXISTS idx_user_franchise_progress_user_id ON public.user_franchise_progress USING btree (user_id);
CREATE UNIQUE INDEX idx_user_media_library_internal ON public.user_media_library USING btree (user_id, list_kind, media_type, internal_id) WHERE (internal_id IS NOT NULL);
CREATE UNIQUE INDEX idx_user_media_library_tmdb ON public.user_media_library USING btree (user_id, list_kind, media_type, tmdb_id) WHERE (tmdb_id IS NOT NULL);
CREATE UNIQUE INDEX idx_user_watch_history_internal ON public.user_watch_history USING btree (user_id, media_type, internal_id) WHERE (internal_id IS NOT NULL);
CREATE UNIQUE INDEX idx_user_watch_history_tmdb ON public.user_watch_history USING btree (user_id, media_type, tmdb_id) WHERE (tmdb_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS private_rate_limit_windows_updated_at_idx ON private.rate_limit_windows USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS user_announcement_views_announcement_idx ON public.user_announcement_views USING btree (announcement_id);
CREATE INDEX IF NOT EXISTS user_announcement_views_lookup_idx ON public.user_announcement_views USING btree (user_id, seen_at DESC);
CREATE INDEX IF NOT EXISTS user_audit_logs_user_action_occurred_idx ON public.user_audit_logs USING btree (user_id, action_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_audit_logs_user_occurred_idx ON public.user_audit_logs USING btree (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_daily_recommendations_lookup_idx ON public.user_daily_recommendations USING btree (user_id, recommendation_kind, recommendation_date DESC);
CREATE INDEX IF NOT EXISTS user_daily_recommendations_user_updated_idx ON public.user_daily_recommendations USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_episode_progress_watched_at_idx ON public.user_episode_progress USING btree (user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS user_franchise_progress_entry_idx ON public.user_franchise_progress USING btree (entry_id);
CREATE INDEX IF NOT EXISTS user_franchise_progress_user_entry_idx ON public.user_franchise_progress USING btree (user_id, entry_id);
CREATE UNIQUE INDEX user_media_library_internal_unique ON public.user_media_library USING btree (user_id, list_kind, media_type, internal_id);
CREATE INDEX IF NOT EXISTS user_media_library_liked_idx ON public.user_media_library USING btree (user_id, collected_at DESC) WHERE (list_kind = 'liked'::user_media_list_kind);
CREATE INDEX IF NOT EXISTS user_media_library_lookup_idx ON public.user_media_library USING btree (user_id, media_type, tmdb_id);
CREATE INDEX IF NOT EXISTS user_media_library_recent_idx ON public.user_media_library USING btree (user_id, collected_at DESC) WHERE (list_kind = 'recently_viewed'::user_media_list_kind);
CREATE UNIQUE INDEX user_media_library_tmdb_unique ON public.user_media_library USING btree (user_id, list_kind, media_type, tmdb_id);
CREATE INDEX IF NOT EXISTS user_media_library_user_list_updated_idx ON public.user_media_library USING btree (user_id, list_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_media_library_watchlist_idx ON public.user_media_library USING btree (user_id, collected_at DESC) WHERE (list_kind = 'watchlist'::user_media_list_kind);
CREATE INDEX IF NOT EXISTS user_settings_theme_idx ON public.user_settings USING btree (theme_id);
CREATE INDEX IF NOT EXISTS user_watch_history_genres_gin_idx ON public.user_watch_history USING gin (genres);
CREATE UNIQUE INDEX user_watch_history_internal_unique ON public.user_watch_history USING btree (user_id, media_type, internal_id);
CREATE INDEX IF NOT EXISTS user_watch_history_media_idx ON public.user_watch_history USING btree (user_id, media_type, watched_at DESC);
CREATE UNIQUE INDEX user_watch_history_tmdb_unique ON public.user_watch_history USING btree (user_id, media_type, tmdb_id);
CREATE INDEX IF NOT EXISTS user_watch_history_user_updated_idx ON public.user_watch_history USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_watch_history_watched_at_idx ON public.user_watch_history USING btree (user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS watch_room_members_user_idx ON public.watch_room_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS watch_room_memories_created_by_idx ON public.watch_room_memories USING btree (created_by);
CREATE INDEX IF NOT EXISTS watch_room_memories_participants_idx ON public.watch_room_memories USING gin (participant_user_ids);
CREATE INDEX IF NOT EXISTS watch_room_memories_room_idx ON public.watch_room_memories USING btree (room_id);
CREATE INDEX IF NOT EXISTS watch_rooms_host_idx ON public.watch_rooms USING btree (host_user_id);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
alter table public.app_telemetry_events add constraint app_telemetry_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.franchise_entries add constraint franchise_entries_franchise_id_fkey FOREIGN KEY (franchise_id) REFERENCES franchise_collections(id) ON DELETE CASCADE;
alter table private.rate_limit_windows add constraint rate_limit_windows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_announcement_views add constraint user_announcement_views_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES app_announcements(id) ON DELETE CASCADE;
alter table public.user_announcement_views add constraint user_announcement_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_audit_logs add constraint user_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_daily_recommendations add constraint user_daily_recommendations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_episode_progress add constraint user_episode_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_franchise_progress add constraint user_franchise_progress_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES franchise_entries(id) ON DELETE CASCADE;
alter table public.user_franchise_progress add constraint user_franchise_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_media_library add constraint user_media_library_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_profiles add constraint user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_settings add constraint user_settings_theme_id_fkey FOREIGN KEY (theme_id) REFERENCES app_themes(id) ON UPDATE CASCADE;
alter table public.user_settings add constraint user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_watch_history add constraint user_watch_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.watch_room_members add constraint watch_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES watch_rooms(id) ON DELETE CASCADE;
alter table public.watch_room_members add constraint watch_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.watch_room_memories add constraint watch_room_memories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.watch_room_memories add constraint watch_room_memories_room_id_fkey FOREIGN KEY (room_id) REFERENCES watch_rooms(id) ON DELETE SET NULL;
alter table public.watch_rooms add constraint watch_rooms_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- Triggers on auth.users are guarded: that table is owned by supabase_auth_admin, so
-- creating them needs privileges the migration role does not always have, and on a bare
-- Postgres the auth schema does not exist at all. A missing privilege degrades to a
-- notice rather than failing the whole build -- the same defensive pattern the original
-- 20260702090000 migration used.
do $baseline$
begin
  if to_regclass('auth.users') is null then
    raise notice 'baseline: auth.users not present, skipping auth triggers';
    return;
  end if;

  begin
    drop trigger if exists on_streambox_user_created on auth.users;
    create trigger on_streambox_user_created
      after insert on auth.users
      for each row execute function public.handle_streambox_user_created();

    drop trigger if exists propagate_streambox_user_email_after_auth_email_change on auth.users;
    create trigger propagate_streambox_user_email_after_auth_email_change
      after update of email on auth.users
      for each row execute function public.propagate_streambox_user_email();
  exception
    when insufficient_privilege then
      raise notice 'baseline: insufficient privilege for auth.users triggers, skipping';
  end;
end
$baseline$;

CREATE TRIGGER set_private_rate_limit_windows_display_name BEFORE INSERT OR UPDATE OF user_id ON private.rate_limit_windows FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_private_rate_limit_windows_email BEFORE INSERT OR UPDATE OF user_id ON private.rate_limit_windows FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_private_rate_limit_windows_updated_at BEFORE UPDATE ON private.rate_limit_windows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_app_announcements_updated_at BEFORE UPDATE ON public.app_announcements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_app_themes_updated_at BEFORE UPDATE ON public.app_themes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_provider_configs_updated_at BEFORE UPDATE ON public.provider_configs FOR EACH ROW EXECUTE FUNCTION provider_configs_set_updated_at();
CREATE TRIGGER set_user_announcement_views_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_announcement_views FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_announcement_views_email BEFORE INSERT OR UPDATE OF user_id ON public.user_announcement_views FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_audit_logs_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_audit_logs FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_audit_logs_email BEFORE INSERT OR UPDATE OF user_id ON public.user_audit_logs FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_daily_recommendations_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_daily_recommendations FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_daily_recommendations_email BEFORE INSERT OR UPDATE OF user_id ON public.user_daily_recommendations FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_daily_recommendations_updated_at BEFORE UPDATE ON public.user_daily_recommendations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_episode_progress_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_episode_progress FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_episode_progress_email BEFORE INSERT OR UPDATE OF user_id ON public.user_episode_progress FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_episode_progress_updated_at BEFORE UPDATE ON public.user_episode_progress FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_franchise_progress_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_franchise_progress FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_franchise_progress_email BEFORE INSERT OR UPDATE OF user_id ON public.user_franchise_progress FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER prune_recently_viewed_library_entries AFTER INSERT OR UPDATE ON public.user_media_library FOR EACH ROW WHEN ((new.list_kind = 'recently_viewed'::user_media_list_kind)) EXECUTE FUNCTION prune_recently_viewed_library_entries();
CREATE TRIGGER set_user_media_library_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_media_library FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_media_library_email BEFORE INSERT OR UPDATE OF user_id ON public.user_media_library FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_media_library_updated_at BEFORE UPDATE ON public.user_media_library FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER propagate_streambox_user_display_name_after_profile_write AFTER INSERT OR UPDATE OF display_name ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION propagate_streambox_user_display_name();
CREATE TRIGGER set_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_settings_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_settings FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_settings_email BEFORE INSERT OR UPDATE OF user_id ON public.user_settings FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_watch_history_display_name BEFORE INSERT OR UPDATE OF user_id ON public.user_watch_history FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_display_name();
CREATE TRIGGER set_user_watch_history_email BEFORE INSERT OR UPDATE OF user_id ON public.user_watch_history FOR EACH ROW EXECUTE FUNCTION assign_streambox_user_email();
CREATE TRIGGER set_user_watch_history_updated_at BEFORE UPDATE ON public.user_watch_history FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER watch_rooms_set_updated_at BEFORE UPDATE ON public.watch_rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security and policies
-- ---------------------------------------------------------------------------
alter table public.user_announcement_views enable row level security;
alter table public.external_ratings_cache enable row level security;
alter table public.external_ratings_function_logs enable row level security;
alter table public.external_ratings_alert_events enable row level security;
alter table public.app_themes enable row level security;
alter table public.user_profiles enable row level security;
alter table private.rate_limit_windows enable row level security;
alter table public.app_announcements enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_media_library enable row level security;
alter table public.user_watch_history enable row level security;
alter table public.user_daily_recommendations enable row level security;
alter table public.user_episode_progress enable row level security;
alter table public.user_audit_logs enable row level security;
alter table public.provider_configs enable row level security;
alter table public.app_telemetry_events enable row level security;
alter table public.franchise_collections enable row level security;
alter table public.franchise_entries enable row level security;
alter table public.user_franchise_progress enable row level security;
alter table public.watch_rooms enable row level security;
alter table public.watch_room_members enable row level security;
alter table public.watch_room_memories enable row level security;
create policy user_announcement_views_select_own on public.user_announcement_views for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_announcement_views_update_own on public.user_announcement_views for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy user_announcement_views_insert_own on public.user_announcement_views for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_themes_authenticated_read on public.app_themes for select to authenticated
  using ((is_active = true));
create policy user_profiles_update_own on public.user_profiles for update to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));
create policy user_profiles_insert_own on public.user_profiles for insert to authenticated
  with check ((id = ( SELECT auth.uid() AS uid)));
create policy user_profiles_select_own on public.user_profiles for select to authenticated
  using ((id = ( SELECT auth.uid() AS uid)));
create policy app_announcements_public_read on public.app_announcements for select to anon, authenticated
  using (((is_active = true) AND (starts_at <= timezone('utc'::text, now())) AND ((ends_at IS NULL) OR (ends_at > timezone('utc'::text, now())))));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_settings_insert_own on public.user_settings for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_settings_select_own on public.user_settings for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_media_library_delete_own on public.user_media_library for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_media_library_update_own on public.user_media_library for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_media_library_insert_own on public.user_media_library for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_media_library_select_own on public.user_media_library for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_watch_history_delete_own on public.user_watch_history for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_watch_history_update_own on public.user_watch_history for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_watch_history_insert_own on public.user_watch_history for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_watch_history_select_own on public.user_watch_history for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_daily_recommendations_delete_own on public.user_daily_recommendations for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_daily_recommendations_update_own on public.user_daily_recommendations for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_daily_recommendations_insert_own on public.user_daily_recommendations for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_daily_recommendations_select_own on public.user_daily_recommendations for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_episode_progress_delete_own on public.user_episode_progress for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_episode_progress_update_own on public.user_episode_progress for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_episode_progress_insert_own on public.user_episode_progress for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_episode_progress_select_own on public.user_episode_progress for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_audit_logs_insert_own on public.user_audit_logs for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_audit_logs_select_own on public.user_audit_logs for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy provider_configs_read on public.provider_configs for select to public
  using (true);
create policy app_telemetry_events_insert_own on public.app_telemetry_events for insert to authenticated
  with check (((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))));
create policy franchise_collections_select on public.franchise_collections for select to public
  using (true);
create policy franchise_entries_select on public.franchise_entries for select to public
  using (true);
create policy user_franchise_progress_delete on public.user_franchise_progress for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy user_franchise_progress_insert on public.user_franchise_progress for insert to public
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy user_franchise_progress_select on public.user_franchise_progress for select to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy watch_rooms_delete_host on public.watch_rooms for delete to authenticated
  using ((host_user_id = ( SELECT auth.uid() AS uid)));
create policy watch_rooms_update_host on public.watch_rooms for update to authenticated
  using ((host_user_id = ( SELECT auth.uid() AS uid)))
  with check ((host_user_id = ( SELECT auth.uid() AS uid)));
create policy watch_rooms_select_member on public.watch_rooms for select to authenticated
  using (is_watch_room_member((id)::text));
create policy watch_room_members_delete_own on public.watch_room_members for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy watch_room_members_select_same_room on public.watch_room_members for select to authenticated
  using (is_watch_room_member((room_id)::text));
create policy watch_room_memories_insert_participant on public.watch_room_memories for insert to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND is_watch_room_member((room_id)::text)));
create policy watch_room_memories_select_participant on public.watch_room_memories for select to authenticated
  using (((( SELECT auth.uid() AS uid) = ANY (participant_user_ids)) OR is_watch_room_member((room_id)::text)));

-- ---------------------------------------------------------------------------
-- Storage object policies
-- ---------------------------------------------------------------------------
create policy profile_assets_delete_own on storage.objects for delete to authenticated
  using (((bucket_id = 'profile-assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy profile_assets_insert_own on storage.objects for insert to authenticated
  with check (((bucket_id = 'profile-assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy profile_assets_select_own on storage.objects for select to authenticated
  using (((bucket_id = 'profile-assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy profile_assets_update_own on storage.objects for update to authenticated
  using (((bucket_id = 'profile-assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  with check (((bucket_id = 'profile-assets'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy watch_memories_member_read on storage.objects for select to authenticated
  using (((bucket_id = 'watch-memories'::text) AND is_watch_room_member((storage.foldername(name))[1])));
create policy watch_memories_member_update on storage.objects for update to authenticated
  using (((bucket_id = 'watch-memories'::text) AND is_watch_room_member((storage.foldername(name))[1])))
  with check (((bucket_id = 'watch-memories'::text) AND is_watch_room_member((storage.foldername(name))[1])));
create policy watch_memories_member_write on storage.objects for insert to authenticated
  with check (((bucket_id = 'watch-memories'::text) AND is_watch_room_member((storage.foldername(name))[1])));
create policy watch_memories_participant_read on storage.objects for select to authenticated
  using (((bucket_id = 'watch-memories'::text) AND (EXISTS ( SELECT 1
   FROM watch_room_memories m
  WHERE ((m.image_path = objects.name) AND (auth.uid() = ANY (m.participant_user_ids)))))));

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
revoke all on public.admin_user_directory from anon, authenticated;
revoke all on public.app_announcements from anon, authenticated;
revoke all on public.app_telemetry_events from anon, authenticated;
revoke all on public.app_themes from anon, authenticated;
revoke all on public.external_ratings_active_alerts from anon, authenticated;
revoke all on public.external_ratings_alert_events from anon, authenticated;
revoke all on public.external_ratings_cache from anon, authenticated;
revoke all on public.external_ratings_function_logs from anon, authenticated;
revoke all on public.franchise_collections from anon, authenticated;
revoke all on public.franchise_entries from anon, authenticated;
revoke all on public.provider_configs from anon, authenticated;
revoke all on private.rate_limit_windows from anon, authenticated;
revoke all on public.user_announcement_views from anon, authenticated;
revoke all on public.user_audit_logs from anon, authenticated;
revoke all on public.user_daily_recommendations from anon, authenticated;
revoke all on public.user_episode_progress from anon, authenticated;
revoke all on public.user_franchise_progress from anon, authenticated;
revoke all on public.user_media_library from anon, authenticated;
revoke all on public.user_profiles from anon, authenticated;
revoke all on public.user_settings from anon, authenticated;
revoke all on public.user_watch_history from anon, authenticated;
revoke all on public.watch_room_members from anon, authenticated;
revoke all on public.watch_room_memories from anon, authenticated;
revoke all on public.watch_rooms from anon, authenticated;
grant select on public.app_announcements to anon;
grant select on public.app_announcements to authenticated;
grant insert on public.app_telemetry_events to authenticated;
grant select on public.app_themes to authenticated;
grant select on public.franchise_collections to anon;
grant select on public.franchise_collections to authenticated;
grant select on public.franchise_entries to anon;
grant select on public.franchise_entries to authenticated;
grant select on public.provider_configs to anon;
grant select on public.provider_configs to authenticated;
grant insert, select, update on public.user_announcement_views to authenticated;
grant insert, select on public.user_audit_logs to authenticated;
grant delete, insert, select, update on public.user_daily_recommendations to authenticated;
grant delete, insert, select, update on public.user_episode_progress to authenticated;
grant delete, insert, select on public.user_franchise_progress to authenticated;
grant delete, insert, select, update on public.user_media_library to authenticated;
grant insert, select, update on public.user_profiles to authenticated;
grant insert, select, update on public.user_settings to authenticated;
grant delete, insert, select, update on public.user_watch_history to authenticated;
grant select on public.watch_room_members to authenticated;
grant insert, select on public.watch_room_memories to authenticated;
grant delete, select, update on public.watch_rooms to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function assign_streambox_user_display_name() from public, anon, authenticated;
revoke all on function assign_streambox_user_email() from public, anon, authenticated;
revoke all on function capture_external_ratings_alerts() from public, anon, authenticated;
revoke all on function cast_gender_array_is_valid(text[]) from public, anon, authenticated;
revoke all on function cleanup_expired_watch_rooms() from public, anon, authenticated;
revoke all on function cleanup_external_ratings_monitoring(integer) from public, anon, authenticated;
revoke all on function cleanup_streambox_event_logs(integer) from public, anon, authenticated;
revoke all on function cleanup_streambox_rate_limit_windows(integer) from public, anon, authenticated;
revoke all on function consume_streambox_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
revoke all on function create_watch_room(text,media_type,integer,text,text,text,text,smallint,smallint,text,text,text) from public, anon, authenticated;
revoke all on function delete_streambox_watch_history_entry(media_type,bigint,jsonb,uuid) from public, anon, authenticated;
revoke all on function delete_streambox_watch_history_entry(media_type,bigint,jsonb) from public, anon, authenticated;
revoke all on function end_watch_room(uuid) from public, anon, authenticated;
revoke all on function ensure_external_ratings_jobs(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function get_hot_external_ratings_candidates(integer) from public, anon, authenticated;
revoke all on function get_my_streambox_bootstrap() from public, anon, authenticated;
revoke all on function handle_streambox_user_created() from public, anon, authenticated;
revoke all on function is_watch_room_member(text) from public, anon, authenticated;
revoke all on function is_watch_room_member_by_code(text) from public, anon, authenticated;
revoke all on function join_watch_room(text,text) from public, anon, authenticated;
revoke all on function log_streambox_user_event(text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function make_streambox_entity_key(media_type,bigint,uuid) from public, anon, authenticated;
revoke all on function propagate_streambox_user_display_name() from public, anon, authenticated;
revoke all on function propagate_streambox_user_email() from public, anon, authenticated;
revoke all on function provider_configs_set_updated_at() from public, anon, authenticated;
revoke all on function prune_recently_viewed_library_entries() from public, anon, authenticated;
revoke all on function remove_watch_memory(uuid) from public, anon, authenticated;
revoke all on function resolve_streambox_user_display_name(uuid) from public, anon, authenticated;
revoke all on function resolve_streambox_user_email(uuid) from public, anon, authenticated;
revoke all on function rls_auto_enable() from public, anon, authenticated;
revoke all on function set_updated_at() from public, anon, authenticated;
revoke all on function sync_streambox_episode_progress(bigint,integer,integer,boolean,timestamp with time zone,jsonb,jsonb) from public, anon, authenticated;
revoke all on function sync_streambox_media_library_item(text,user_media_list_kind,media_type,bigint,text,timestamp with time zone,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function sync_streambox_media_library_item(text,user_media_list_kind,media_type,bigint,text,timestamp with time zone,jsonb,jsonb) from public, anon, authenticated;
revoke all on function sync_streambox_profile_and_settings(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function sync_streambox_watch_history_entry(media_type,bigint,text,text,text,text[],integer,integer,numeric,integer,bigint[],text[],text[],text[],bigint[],text[],text[],timestamp with time zone,integer,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function sync_streambox_watch_history_entry(media_type,bigint,text,text,text,text[],integer,integer,numeric,integer,bigint[],text[],text[],text[],bigint[],text[],text[],timestamp with time zone,integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function cast_gender_array_is_valid(text[]) to authenticated;
grant execute on function cleanup_expired_watch_rooms() to authenticated;
grant execute on function create_watch_room(text,media_type,integer,text,text,text,text,smallint,smallint,text,text,text) to authenticated;
grant execute on function delete_streambox_watch_history_entry(media_type,bigint,jsonb) to authenticated;
grant execute on function delete_streambox_watch_history_entry(media_type,bigint,jsonb,uuid) to authenticated;
grant execute on function end_watch_room(uuid) to authenticated;
grant execute on function get_my_streambox_bootstrap() to authenticated;
grant execute on function is_watch_room_member(text) to authenticated;
grant execute on function is_watch_room_member_by_code(text) to authenticated;
grant execute on function join_watch_room(text,text) to authenticated;
grant execute on function log_streambox_user_event(text,text,text,text,jsonb) to authenticated;
grant execute on function remove_watch_memory(uuid) to authenticated;
grant execute on function resolve_streambox_user_display_name(uuid) to authenticated;
grant execute on function sync_streambox_episode_progress(bigint,integer,integer,boolean,timestamp with time zone,jsonb,jsonb) to authenticated;
grant execute on function sync_streambox_media_library_item(text,user_media_list_kind,media_type,bigint,text,timestamp with time zone,jsonb,jsonb) to authenticated;
grant execute on function sync_streambox_media_library_item(text,user_media_list_kind,media_type,bigint,text,timestamp with time zone,jsonb,jsonb,uuid) to authenticated;
grant execute on function sync_streambox_profile_and_settings(jsonb,jsonb,jsonb) to authenticated;
grant execute on function sync_streambox_watch_history_entry(media_type,bigint,text,text,text,text[],integer,integer,numeric,integer,bigint[],text[],text[],text[],bigint[],text[],text[],timestamp with time zone,integer,jsonb,jsonb) to authenticated;
grant execute on function sync_streambox_watch_history_entry(media_type,bigint,text,text,text,text[],integer,integer,numeric,integer,bigint[],text[],text[],text[],bigint[],text[],text[],timestamp with time zone,integer,jsonb,jsonb,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------
-- Guarded: pg_cron is present on Supabase but not necessarily on a bare local Postgres,
-- and the ratings refresh job needs project-specific secrets that do not belong in git.
do $baseline$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('external-ratings-alert-capture',      '*/15 * * * *', $job$select public.capture_external_ratings_alerts();$job$);
    perform cron.schedule('external-ratings-monitoring-cleanup', '33 3 * * *',   $job$select public.cleanup_external_ratings_monitoring(30);$job$);
    perform cron.schedule('watch-together-cleanup',              '30 4 * * *',   $job$select public.cleanup_expired_watch_rooms();$job$);
    perform cron.schedule('streambox-event-log-cleanup',         '45 3 * * *',   $job$select public.cleanup_streambox_event_logs(90);$job$);
    -- 'external-ratings-hot-refresh' is intentionally omitted: it embeds a project URL
    -- and invokes an edge function. Recreate it per environment.
  end if;
end
$baseline$;
