create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

do $$
begin
  if to_regtype('public.media_type') is null then
    create type public.media_type as enum ('movie', 'tv');
  end if;

  if to_regtype('public.user_media_list_kind') is null then
    create type public.user_media_list_kind as enum ('watchlist', 'liked', 'recently_viewed');
  end if;
end
$$;

create or replace function public.cast_gender_array_is_valid(genders text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1
    from unnest(coalesce(genders, '{}'::text[])) as gender
    where gender is not null
      and gender not in ('male', 'female')
  );
$$;

revoke all on function public.cast_gender_array_is_valid(text[]) from public;
revoke all on function public.cast_gender_array_is_valid(text[]) from anon;
grant execute on function public.cast_gender_array_is_valid(text[]) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create table if not exists public.app_themes (
  id text primary key,
  display_name text not null,
  description text not null,
  primary_color text not null,
  sort_order smallint not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (char_length(btrim(id)) between 1 and 50),
  check (char_length(btrim(display_name)) between 1 and 80),
  check (char_length(description) between 1 and 240),
  check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (sort_order >= 1)
);

insert into public.app_themes (id, display_name, description, primary_color, sort_order, is_active)
values
  ('cinema-ember', 'Cinema Ember', 'Classic StreamBox heat with a premium cinema glow.', '#FF4D00', 1, true),
  ('velvet-crimson', 'Netflix Red', 'Netflix-inspired signature red for a bold but familiar premium streaming look.', '#E50914', 2, true),
  ('aurora-cyan', 'Prime Video Blue', 'Prime Video-inspired blue with a bright streaming accent and familiar dark-mode contrast.', '#00A8E1', 3, true),
  ('emerald-noir', 'Emerald Noir', 'Dark screen, rich green highlights, understated and premium.', '#22C55E', 4, true),
  ('luxe-gold', 'Luxe Gold', 'Soft brushed gold with warm editorial character and less visual fatigue.', '#B9974F', 5, true),
  ('glacier-blue', 'Glacier Blue', 'Refined slate-blue accent with a cool premium tone instead of harsh brightness.', '#7B97C9', 6, true)
on conflict (id) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  primary_color = excluded.primary_color,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'My Profile',
  bio text not null default '',
  location_text text not null default '',
  birthday date,
  joined_at timestamptz not null default timezone('utc', now()),
  avatar_path text,
  banner_path text,
  avatar_version integer not null default 0,
  banner_version integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (char_length(btrim(display_name)) between 1 and 50),
  check (char_length(bio) <= 160),
  check (char_length(location_text) <= 60),
  check (avatar_path is null or avatar_path ~* '^[0-9a-f-]{36}/avatars/[A-Za-z0-9._/-]{1,255}$'),
  check (banner_path is null or banner_path ~* '^[0-9a-f-]{36}/banners/[A-Za-z0-9._/-]{1,255}$'),
  check (avatar_version >= 0),
  check (banner_version >= 0)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme_id text not null references public.app_themes(id) on update cascade,
  onboarding_completed_at timestamptz,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(preferences) = 'object')
);

create table if not exists public.user_media_library (
  user_id uuid not null references auth.users(id) on delete cascade,
  list_kind public.user_media_list_kind not null,
  media_type public.media_type not null,
  tmdb_id bigint not null,
  imdb_id text,
  collected_at timestamptz not null default timezone('utc', now()),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, list_kind, media_type, tmdb_id),
  check (tmdb_id > 0),
  check (imdb_id is null or imdb_id ~ '^tt[0-9]{7,10}$'),
  check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.user_watch_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type public.media_type not null,
  tmdb_id bigint not null,
  imdb_id text,
  title text not null,
  poster_path text,
  genres text[] not null default '{}'::text[],
  runtime_minutes integer,
  episode_count integer,
  vote_average numeric(4, 2) not null default 0,
  release_year integer,
  cast_ids bigint[] not null default '{}'::bigint[],
  cast_names text[] not null default '{}'::text[],
  cast_profile_paths text[] not null default '{}'::text[],
  cast_genders text[] not null default '{}'::text[],
  director_ids bigint[] not null default '{}'::bigint[],
  director_names text[] not null default '{}'::text[],
  director_profile_paths text[] not null default '{}'::text[],
  watched_at timestamptz not null,
  metadata_version integer not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, media_type, tmdb_id),
  check (tmdb_id > 0),
  check (imdb_id is null or imdb_id ~ '^tt[0-9]{7,10}$'),
  check (char_length(btrim(title)) between 1 and 500),
  check (vote_average between 0 and 10),
  check (runtime_minutes is null or runtime_minutes between 1 and 5000),
  check (episode_count is null or episode_count between 1 and 50000),
  check (release_year is null or release_year between 1878 and 2100),
  check (metadata_version >= 1),
  check (cardinality(genres) <= 25),
  check (cardinality(cast_ids) <= 5),
  check (cardinality(director_ids) <= 5),
  check (cardinality(cast_ids) = cardinality(cast_names)),
  check (cardinality(cast_ids) = cardinality(cast_profile_paths)),
  check (cardinality(cast_ids) = cardinality(cast_genders)),
  check (cardinality(director_ids) = cardinality(director_names)),
  check (cardinality(director_ids) = cardinality(director_profile_paths)),
  check (public.cast_gender_array_is_valid(cast_genders)),
  check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.user_daily_recommendations (
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_kind text not null default 'movie_of_the_day',
  recommendation_date date not null,
  media_type public.media_type not null default 'movie',
  tmdb_id bigint,
  imdb_id text,
  strategy text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, recommendation_kind, recommendation_date),
  check (char_length(btrim(recommendation_kind)) between 1 and 64),
  check (strategy is null or char_length(btrim(strategy)) between 1 and 64),
  check (tmdb_id is null or tmdb_id > 0),
  check (imdb_id is null or imdb_id ~ '^tt[0-9]{7,10}$'),
  check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists private.rate_limit_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_key text not null,
  window_started_at timestamptz not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, action_key, window_started_at),
  check (char_length(btrim(action_key)) between 1 and 64),
  check (hit_count >= 0)
);

create index if not exists app_themes_active_sort_idx
  on public.app_themes (is_active, sort_order);

create index if not exists user_media_library_lookup_idx
  on public.user_media_library (user_id, media_type, tmdb_id);

create index if not exists user_media_library_watchlist_idx
  on public.user_media_library (user_id, collected_at desc)
  where list_kind = 'watchlist';

create index if not exists user_media_library_liked_idx
  on public.user_media_library (user_id, collected_at desc)
  where list_kind = 'liked';

create index if not exists user_media_library_recent_idx
  on public.user_media_library (user_id, collected_at desc)
  where list_kind = 'recently_viewed';

create index if not exists user_watch_history_watched_at_idx
  on public.user_watch_history (user_id, watched_at desc);

create index if not exists user_watch_history_media_idx
  on public.user_watch_history (user_id, media_type, watched_at desc);

create index if not exists user_watch_history_genres_gin_idx
  on public.user_watch_history using gin (genres);

create index if not exists user_daily_recommendations_lookup_idx
  on public.user_daily_recommendations (user_id, recommendation_kind, recommendation_date desc);

create index if not exists private_rate_limit_windows_updated_at_idx
  on private.rate_limit_windows (updated_at desc);

create or replace function public.handle_streambox_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.handle_streambox_user_created() from public;
revoke all on function public.handle_streambox_user_created() from anon;
revoke all on function public.handle_streambox_user_created() from authenticated;

drop trigger if exists on_streambox_user_created on auth.users;
create trigger on_streambox_user_created
  after insert on auth.users
  for each row execute function public.handle_streambox_user_created();

insert into public.user_profiles (id, display_name, joined_at)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''), 'My Profile'),
  coalesce(users.created_at, timezone('utc', now()))
from auth.users as users
on conflict (id) do nothing;

insert into public.user_settings (user_id, theme_id, onboarding_completed_at)
select
  users.id,
  'cinema-ember',
  coalesce(users.created_at, timezone('utc', now()))
from auth.users as users
on conflict (user_id) do nothing;

create or replace function public.prune_recently_viewed_library_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.prune_recently_viewed_library_entries() from public;
revoke all on function public.prune_recently_viewed_library_entries() from anon;
revoke all on function public.prune_recently_viewed_library_entries() from authenticated;

create or replace function public.consume_streambox_rate_limit(
  target_user_id uuid,
  action_key text,
  max_hits integer default 30,
  window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
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
$$;

revoke all on function public.consume_streambox_rate_limit(uuid, text, integer, integer) from public;
revoke all on function public.consume_streambox_rate_limit(uuid, text, integer, integer) from anon;
revoke all on function public.consume_streambox_rate_limit(uuid, text, integer, integer) from authenticated;
grant execute on function public.consume_streambox_rate_limit(uuid, text, integer, integer) to service_role;

create or replace function public.cleanup_streambox_rate_limit_windows(retention_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = private, public
as $$
declare
  deleted_rows integer := 0;
begin
  delete from private.rate_limit_windows
  where updated_at < timezone('utc', now()) - make_interval(days => greatest(coalesce(retention_days, 7), 1));

  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$$;

revoke all on function public.cleanup_streambox_rate_limit_windows(integer) from public;
revoke all on function public.cleanup_streambox_rate_limit_windows(integer) from anon;
revoke all on function public.cleanup_streambox_rate_limit_windows(integer) from authenticated;
grant execute on function public.cleanup_streambox_rate_limit_windows(integer) to service_role;

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

drop trigger if exists set_app_themes_updated_at on public.app_themes;
create trigger set_app_themes_updated_at
  before update on public.app_themes
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_media_library_updated_at on public.user_media_library;
create trigger set_user_media_library_updated_at
  before update on public.user_media_library
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_watch_history_updated_at on public.user_watch_history;
create trigger set_user_watch_history_updated_at
  before update on public.user_watch_history
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_daily_recommendations_updated_at on public.user_daily_recommendations;
create trigger set_user_daily_recommendations_updated_at
  before update on public.user_daily_recommendations
  for each row execute function public.set_updated_at();

drop trigger if exists set_private_rate_limit_windows_updated_at on private.rate_limit_windows;
create trigger set_private_rate_limit_windows_updated_at
  before update on private.rate_limit_windows
  for each row execute function public.set_updated_at();

drop trigger if exists prune_recently_viewed_library_entries on public.user_media_library;
create trigger prune_recently_viewed_library_entries
  after insert or update on public.user_media_library
  for each row
  when (new.list_kind = 'recently_viewed')
  execute function public.prune_recently_viewed_library_entries();

alter table public.app_themes enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_media_library enable row level security;
alter table public.user_watch_history enable row level security;
alter table public.user_daily_recommendations enable row level security;

revoke all on public.app_themes from anon;
revoke all on public.app_themes from authenticated;
revoke all on public.user_profiles from anon;
revoke all on public.user_profiles from authenticated;
revoke all on public.user_settings from anon;
revoke all on public.user_settings from authenticated;
revoke all on public.user_media_library from anon;
revoke all on public.user_media_library from authenticated;
revoke all on public.user_watch_history from anon;
revoke all on public.user_watch_history from authenticated;
revoke all on public.user_daily_recommendations from anon;
revoke all on public.user_daily_recommendations from authenticated;
revoke all on private.rate_limit_windows from anon;
revoke all on private.rate_limit_windows from authenticated;

grant select on public.app_themes to authenticated;
grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.user_media_library to authenticated;
grant select, insert, update, delete on public.user_watch_history to authenticated;
grant select, insert, update, delete on public.user_daily_recommendations to authenticated;
grant usage on type public.media_type to authenticated;
grant usage on type public.user_media_list_kind to authenticated;

drop policy if exists "app_themes_authenticated_read" on public.app_themes;
create policy "app_themes_authenticated_read"
  on public.app_themes
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own"
  on public.user_profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own"
  on public.user_profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
  on public.user_profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_media_library_select_own" on public.user_media_library;
create policy "user_media_library_select_own"
  on public.user_media_library
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_media_library_insert_own" on public.user_media_library;
create policy "user_media_library_insert_own"
  on public.user_media_library
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_media_library_update_own" on public.user_media_library;
create policy "user_media_library_update_own"
  on public.user_media_library
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_media_library_delete_own" on public.user_media_library;
create policy "user_media_library_delete_own"
  on public.user_media_library
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_watch_history_select_own" on public.user_watch_history;
create policy "user_watch_history_select_own"
  on public.user_watch_history
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_watch_history_insert_own" on public.user_watch_history;
create policy "user_watch_history_insert_own"
  on public.user_watch_history
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_watch_history_update_own" on public.user_watch_history;
create policy "user_watch_history_update_own"
  on public.user_watch_history
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_watch_history_delete_own" on public.user_watch_history;
create policy "user_watch_history_delete_own"
  on public.user_watch_history
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_daily_recommendations_select_own" on public.user_daily_recommendations;
create policy "user_daily_recommendations_select_own"
  on public.user_daily_recommendations
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_daily_recommendations_insert_own" on public.user_daily_recommendations;
create policy "user_daily_recommendations_insert_own"
  on public.user_daily_recommendations
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_daily_recommendations_update_own" on public.user_daily_recommendations;
create policy "user_daily_recommendations_update_own"
  on public.user_daily_recommendations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_daily_recommendations_delete_own" on public.user_daily_recommendations;
create policy "user_daily_recommendations_delete_own"
  on public.user_daily_recommendations
  for delete
  to authenticated
  using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-assets',
  'profile-assets',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_assets_select_own" on storage.objects;
create policy "profile_assets_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_assets_insert_own" on storage.objects;
create policy "profile_assets_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_assets_update_own" on storage.objects;
create policy "profile_assets_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_assets_delete_own" on storage.objects;
create policy "profile_assets_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );