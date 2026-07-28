create table if not exists public.user_episode_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  series_tmdb_id bigint not null,
  season_number integer not null,
  episode_number integer not null,
  watched_at timestamptz not null default timezone('utc', now()),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, series_tmdb_id, season_number, episode_number),
  check (series_tmdb_id > 0),
  check (season_number > 0),
  check (episode_number > 0),
  check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.user_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_category text not null,
  action_type text not null,
  entity_type text,
  entity_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  check (char_length(btrim(action_category)) between 1 and 64),
  check (char_length(btrim(action_type)) between 1 and 120),
  check (entity_type is null or char_length(btrim(entity_type)) between 1 and 80),
  check (entity_key is null or char_length(btrim(entity_key)) between 1 and 160),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists user_episode_progress_lookup_idx
  on public.user_episode_progress (user_id, series_tmdb_id, season_number, episode_number);

create index if not exists user_episode_progress_watched_at_idx
  on public.user_episode_progress (user_id, watched_at desc);

create index if not exists user_audit_logs_user_occurred_idx
  on public.user_audit_logs (user_id, occurred_at desc);

create index if not exists user_audit_logs_action_type_idx
  on public.user_audit_logs (user_id, action_type, occurred_at desc);

create or replace function public.make_streambox_entity_key(input_media_type public.media_type, input_tmdb_id bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select concat(input_media_type::text, ':', input_tmdb_id::text);
$$;

revoke all on function public.make_streambox_entity_key(public.media_type, bigint) from public;
revoke all on function public.make_streambox_entity_key(public.media_type, bigint) from anon;
grant execute on function public.make_streambox_entity_key(public.media_type, bigint) to authenticated;

create or replace function public.log_streambox_user_event(
  action_category text,
  action_type text,
  entity_type text default null,
  entity_key text default null,
  metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.log_streambox_user_event(text, text, text, text, jsonb) from public;
revoke all on function public.log_streambox_user_event(text, text, text, text, jsonb) from anon;
grant execute on function public.log_streambox_user_event(text, text, text, text, jsonb) to authenticated;

create or replace function public.sync_streambox_profile_and_settings(
  profile_payload jsonb default '{}'::jsonb,
  settings_payload jsonb default '{}'::jsonb,
  audit_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.sync_streambox_profile_and_settings(jsonb, jsonb, jsonb) from public;
revoke all on function public.sync_streambox_profile_and_settings(jsonb, jsonb, jsonb) from anon;
grant execute on function public.sync_streambox_profile_and_settings(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.sync_streambox_media_library_item(
  operation text,
  list_kind public.user_media_list_kind,
  media_type public.media_type,
  tmdb_id bigint,
  imdb_id text default null,
  collected_at timestamptz default null,
  snapshot jsonb default '{}'::jsonb,
  audit_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  -- Capturing parameters into local variables with unique prefixes to avoid ambiguity
  v_operation text := lower(coalesce(btrim(sync_streambox_media_library_item.operation), ''));
  v_list_kind public.user_media_list_kind := sync_streambox_media_library_item.list_kind;
  v_media_type public.media_type := sync_streambox_media_library_item.media_type;
  v_tmdb_id bigint := sync_streambox_media_library_item.tmdb_id;
  v_imdb_id text := sync_streambox_media_library_item.imdb_id;
  v_collected_at timestamptz := sync_streambox_media_library_item.collected_at;
  v_snapshot jsonb := coalesce(sync_streambox_media_library_item.snapshot, '{}'::jsonb);
  v_audit_metadata jsonb := coalesce(sync_streambox_media_library_item.audit_metadata, '{}'::jsonb);
  
  next_collected_at timestamptz := coalesce(v_collected_at, timezone('utc', now()));
  affected_rows integer := 0;
  resolved_action_type text;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if v_tmdb_id <= 0 then
    raise exception 'tmdb_id must be greater than 0';
  end if;

  if jsonb_typeof(v_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if jsonb_typeof(v_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  if v_operation = 'upsert' then
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
      v_list_kind,
      v_media_type,
      v_tmdb_id,
      nullif(v_imdb_id, ''),
      next_collected_at,
      v_snapshot
    )
    on conflict (user_id, list_kind, media_type, tmdb_id)
    do update
      set imdb_id = excluded.imdb_id,
          collected_at = excluded.collected_at,
          snapshot = excluded.snapshot;

    resolved_action_type := case
      when v_list_kind = 'watchlist' then 'watchlist_added'
      when v_list_kind = 'liked' then 'liked_added'
      else null
    end;

    if resolved_action_type is not null then
      perform public.log_streambox_user_event(
        'library',
        resolved_action_type,
        v_list_kind::text,
        public.make_streambox_entity_key(v_media_type, v_tmdb_id),
        v_audit_metadata
          || jsonb_build_object('listKind', v_list_kind::text, 'mediaType', v_media_type::text, 'tmdbId', v_tmdb_id)
      );
    end if;

    return true;
  end if;

  if v_operation = 'delete' then
    delete from public.user_media_library
    where user_id = current_user_id
      and public.user_media_library.list_kind = v_list_kind
      and public.user_media_library.media_type = v_media_type
      and public.user_media_library.tmdb_id = v_tmdb_id;

    get diagnostics affected_rows = row_count;

    if affected_rows > 0 then
      resolved_action_type := case
        when v_list_kind = 'watchlist' then 'watchlist_removed'
        when v_list_kind = 'liked' then 'liked_removed'
        else null
      end;

      if resolved_action_type is not null then
        perform public.log_streambox_user_event(
          'library',
          resolved_action_type,
          v_list_kind::text,
          public.make_streambox_entity_key(v_media_type, v_tmdb_id),
          v_audit_metadata
            || jsonb_build_object('listKind', v_list_kind::text, 'mediaType', v_media_type::text, 'tmdbId', v_tmdb_id)
        );
      end if;
    end if;

    return affected_rows > 0;
  end if;

  raise exception 'operation must be either upsert or delete';
end;
$$;

revoke all on function public.sync_streambox_media_library_item(text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb) from public;
revoke all on function public.sync_streambox_media_library_item(text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb) from anon;
grant execute on function public.sync_streambox_media_library_item(text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb) to authenticated;

create or replace function public.sync_streambox_watch_history_entry(
  media_type public.media_type,
  tmdb_id bigint,
  imdb_id text,
  title text,
  poster_path text,
  genres text[],
  runtime_minutes integer,
  episode_count integer,
  vote_average numeric,
  release_year integer,
  cast_ids bigint[],
  cast_names text[],
  cast_profile_paths text[],
  cast_genders text[],
  director_ids bigint[],
  director_names text[],
  director_profile_paths text[],
  watched_at timestamptz,
  metadata_version integer,
  snapshot jsonb default '{}'::jsonb,
  audit_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  v_media_type public.media_type := sync_streambox_watch_history_entry.media_type;
  v_tmdb_id bigint := sync_streambox_watch_history_entry.tmdb_id;
  v_imdb_id text := sync_streambox_watch_history_entry.imdb_id;
  v_title text := sync_streambox_watch_history_entry.title;
  v_poster_path text := sync_streambox_watch_history_entry.poster_path;
  v_genres text[] := sync_streambox_watch_history_entry.genres;
  v_runtime_minutes integer := sync_streambox_watch_history_entry.runtime_minutes;
  v_episode_count integer := sync_streambox_watch_history_entry.episode_count;
  v_vote_average numeric := sync_streambox_watch_history_entry.vote_average;
  v_release_year integer := sync_streambox_watch_history_entry.release_year;
  v_cast_ids bigint[] := sync_streambox_watch_history_entry.cast_ids;
  v_cast_names text[] := sync_streambox_watch_history_entry.cast_names;
  v_cast_profile_paths text[] := sync_streambox_watch_history_entry.cast_profile_paths;
  v_cast_genders text[] := sync_streambox_watch_history_entry.cast_genders;
  v_director_ids bigint[] := sync_streambox_watch_history_entry.director_ids;
  v_director_names text[] := sync_streambox_watch_history_entry.director_names;
  v_director_profile_paths text[] := sync_streambox_watch_history_entry.director_profile_paths;
  v_watched_at timestamptz := sync_streambox_watch_history_entry.watched_at;
  v_metadata_version integer := sync_streambox_watch_history_entry.metadata_version;
  v_snapshot jsonb := coalesce(sync_streambox_watch_history_entry.snapshot, '{}'::jsonb);
  v_audit_metadata jsonb := coalesce(sync_streambox_watch_history_entry.audit_metadata, '{}'::jsonb);
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if v_tmdb_id <= 0 then
    raise exception 'tmdb_id must be greater than 0';
  end if;

  if nullif(btrim(v_title), '') is null then
    raise exception 'title is required';
  end if;

  if jsonb_typeof(v_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if jsonb_typeof(v_audit_metadata) <> 'object' then
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
    v_media_type,
    v_tmdb_id,
    nullif(v_imdb_id, ''),
    btrim(v_title),
    v_poster_path,
    coalesce(v_genres, '{}'::text[]),
    v_runtime_minutes,
    v_episode_count,
    coalesce(v_vote_average, 0),
    v_release_year,
    coalesce(v_cast_ids, '{}'::bigint[]),
    coalesce(v_cast_names, '{}'::text[]),
    coalesce(v_cast_profile_paths, '{}'::text[]),
    coalesce(v_cast_genders, '{}'::text[]),
    coalesce(v_director_ids, '{}'::bigint[]),
    coalesce(v_director_names, '{}'::text[]),
    coalesce(v_director_profile_paths, '{}'::text[]),
    v_watched_at,
    greatest(coalesce(v_metadata_version, 1), 1),
    v_snapshot
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
    v_media_type::text,
    public.make_streambox_entity_key(v_media_type, v_tmdb_id),
    v_audit_metadata
      || jsonb_build_object('mediaType', v_media_type::text, 'tmdbId', v_tmdb_id, 'watchedAt', v_watched_at)
  );
end;
$$;

revoke all on function public.sync_streambox_watch_history_entry(public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer, bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb) from public;
revoke all on function public.sync_streambox_watch_history_entry(public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer, bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb) from anon;
grant execute on function public.sync_streambox_watch_history_entry(public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer, bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb) to authenticated;

create or replace function public.delete_streambox_watch_history_entry(
  media_type public.media_type,
  tmdb_id bigint,
  audit_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  v_media_type public.media_type := delete_streambox_watch_history_entry.media_type;
  v_tmdb_id bigint := delete_streambox_watch_history_entry.tmdb_id;
  v_audit_metadata jsonb := coalesce(delete_streambox_watch_history_entry.audit_metadata, '{}'::jsonb);
  affected_rows integer := 0;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(v_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  delete from public.user_watch_history
  where user_id = current_user_id
    and public.user_watch_history.media_type = v_media_type
    and public.user_watch_history.tmdb_id = v_tmdb_id;

  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    perform public.log_streambox_user_event(
      'watch_history',
      'watch_history_removed',
      v_media_type::text,
      public.make_streambox_entity_key(v_media_type, v_tmdb_id),
      v_audit_metadata || jsonb_build_object('mediaType', v_media_type::text, 'tmdbId', v_tmdb_id)
    );
  end if;

  return affected_rows > 0;
end;
$$;

revoke all on function public.delete_streambox_watch_history_entry(public.media_type, bigint, jsonb) from public;
revoke all on function public.delete_streambox_watch_history_entry(public.media_type, bigint, jsonb) from anon;
grant execute on function public.delete_streambox_watch_history_entry(public.media_type, bigint, jsonb) to authenticated;

create or replace function public.sync_streambox_episode_progress(
  series_tmdb_id bigint,
  season_number integer,
  episode_number integer,
  is_watched boolean,
  watched_at timestamptz default null,
  snapshot jsonb default '{}'::jsonb,
  audit_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  v_series_tmdb_id bigint := sync_streambox_episode_progress.series_tmdb_id;
  v_season_number integer := sync_streambox_episode_progress.season_number;
  v_episode_number integer := sync_streambox_episode_progress.episode_number;
  v_is_watched boolean := sync_streambox_episode_progress.is_watched;
  v_watched_at timestamptz := sync_streambox_episode_progress.watched_at;
  v_snapshot jsonb := coalesce(sync_streambox_episode_progress.snapshot, '{}'::jsonb);
  v_audit_metadata jsonb := coalesce(sync_streambox_episode_progress.audit_metadata, '{}'::jsonb);
  
  next_watched_at timestamptz := coalesce(v_watched_at, timezone('utc', now()));
  affected_rows integer := 0;
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if v_series_tmdb_id <= 0 or v_season_number <= 0 or v_episode_number <= 0 then
    raise exception 'series_tmdb_id, season_number, and episode_number must all be greater than 0';
  end if;

  if jsonb_typeof(v_snapshot) <> 'object' then
    raise exception 'snapshot must be a json object';
  end if;

  if v_is_watched then
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
      v_series_tmdb_id,
      v_season_number,
      v_episode_number,
      next_watched_at,
      v_snapshot
    )
    on conflict (user_id, series_tmdb_id, season_number, episode_number)
    do update
      set watched_at = excluded.watched_at,
          snapshot = excluded.snapshot;

    return true;
  end if;

  delete from public.user_episode_progress
  where user_id = current_user_id
    and public.user_episode_progress.series_tmdb_id = v_series_tmdb_id
    and public.user_episode_progress.season_number = v_season_number
    and public.user_episode_progress.episode_number = v_episode_number;

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

revoke all on function public.sync_streambox_episode_progress(bigint, integer, integer, boolean, timestamptz, jsonb, jsonb) from public;
revoke all on function public.sync_streambox_episode_progress(bigint, integer, integer, boolean, timestamptz, jsonb, jsonb) from anon;
grant execute on function public.sync_streambox_episode_progress(bigint, integer, integer, boolean, timestamptz, jsonb, jsonb) to authenticated;

create or replace function public.get_my_streambox_bootstrap()
returns jsonb
language sql
security invoker
set search_path = public
as $$
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
$$;

revoke all on function public.get_my_streambox_bootstrap() from public;
revoke all on function public.get_my_streambox_bootstrap() from anon;
grant execute on function public.get_my_streambox_bootstrap() to authenticated;

drop trigger if exists set_user_episode_progress_updated_at on public.user_episode_progress;
create trigger set_user_episode_progress_updated_at
  before update on public.user_episode_progress
  for each row execute function public.set_updated_at();

alter table public.user_episode_progress enable row level security;
alter table public.user_audit_logs enable row level security;

revoke all on public.user_episode_progress from anon;
revoke all on public.user_episode_progress from authenticated;
revoke all on public.user_audit_logs from anon;
revoke all on public.user_audit_logs from authenticated;

grant select, insert, update, delete on public.user_episode_progress to authenticated;
grant select, insert on public.user_audit_logs to authenticated;
grant usage, select on sequence public.user_audit_logs_id_seq to authenticated;

drop policy if exists "user_episode_progress_select_own" on public.user_episode_progress;
create policy "user_episode_progress_select_own"
  on public.user_episode_progress
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_episode_progress_insert_own" on public.user_episode_progress;
create policy "user_episode_progress_insert_own"
  on public.user_episode_progress
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_episode_progress_update_own" on public.user_episode_progress;
create policy "user_episode_progress_update_own"
  on public.user_episode_progress
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_episode_progress_delete_own" on public.user_episode_progress;
create policy "user_episode_progress_delete_own"
  on public.user_episode_progress
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_audit_logs_select_own" on public.user_audit_logs;
create policy "user_audit_logs_select_own"
  on public.user_audit_logs
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_audit_logs_insert_own" on public.user_audit_logs;
create policy "user_audit_logs_insert_own"
  on public.user_audit_logs
  for insert
  to authenticated
  with check (user_id = auth.uid());



