-- Social follow platform (runtime 1.3.0) — usernames, a public follow graph,
-- a Letterboxd-style activity feed, in-app notifications, mutual-follow Watch
-- Together invites, and Android push tokens. Apply MANUALLY (never db push);
-- this file sorts after the remote head 20260710190000.
--
-- Design guardrails (do NOT relax):
--   • Existing user-data tables (user_profiles / user_media_library /
--     user_watch_history / user_settings) keep their OWNER-ONLY RLS. Public
--     reads for other users happen ONLY through the SECURITY DEFINER read RPCs
--     below, which project an explicitly-curated public surface — never the raw
--     rows (emails, birthday, settings, and Shared Sessions stay private).
--   • Writes to the follow graph / invites / notifications go through RPCs; the
--     underlying tables keep direct write grants revoked, so the RPCs are the
--     only mutation path and can enforce rate limits + server-side gating.
--   • v1 scope: every profile is PUBLIC to authenticated users, Letterboxd-style.
--     No private accounts and no blocking in v1 (stated here so future readers
--     know it was a deliberate choice, not an oversight).
--
-- Reuses the existing public.media_type enum, the public.user_media_list_kind
-- enum, public.set_updated_at(), and public.consume_streambox_rate_limit(
--   target_user_id uuid, action_key text, max_hits int, window_seconds int).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. USERNAMES
-- ════════════════════════════════════════════════════════════════════════════

alter table public.user_profiles
  add column if not exists username text,
  add column if not exists username_changed_at timestamptz;

-- Case-insensitive uniqueness without the citext dependency.
create unique index if not exists user_profiles_username_key
  on public.user_profiles (lower(username));

-- Prefix-search support for search_users (lowercased LIKE 'q%').
create index if not exists user_profiles_username_pattern_idx
  on public.user_profiles (lower(username) text_pattern_ops);
create index if not exists user_profiles_display_name_pattern_idx
  on public.user_profiles (lower(display_name) text_pattern_ops);

-- Format constraint: lowercase a-z, 0-9, underscore, 3–20 chars. NULL is
-- allowed only transiently (added before the backfill populates it).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_username_format'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_username_format
      check (username is null or username ~ '^[a-z0-9_]{3,20}$');
  end if;
end $$;

-- Reserved / abusive handles rejected at generation + change time. Kept short
-- and lowercase; the last row is a minimal slur/abuse blocklist.
create or replace function public.streambox_username_is_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_username, '')) = any (array[
    'streambox', 'admin', 'administrator', 'support', 'system', 'root',
    'moderator', 'mod', 'official', 'help', 'staff', 'owner', 'api', 'www',
    'me', 'you', 'null', 'undefined', 'everyone', 'here',
    'nigger', 'nigga', 'faggot', 'retard', 'rapist', 'cunt', 'whore'
  ]);
$$;

revoke all on function public.streambox_username_is_reserved(text) from public;
revoke all on function public.streambox_username_is_reserved(text) from anon;

-- Deterministically derive a unique, valid username from a free-text seed
-- (email local part on signup / backfill). Sanitizes to the allowed charset,
-- pads to the 3-char minimum, then appends a numeric suffix until the handle is
-- both non-reserved and free. Runs inside SECURITY DEFINER callers, so the
-- uniqueness probe sees rows committed earlier in the same transaction.
create or replace function public.streambox_generate_username(p_seed text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 0;
  v_max_base_len integer;
begin
  v_base := regexp_replace(lower(coalesce(p_seed, '')), '[^a-z0-9_]', '', 'g');
  if length(v_base) < 3 then
    v_base := 'user';
  elsif length(v_base) > 20 then
    v_base := left(v_base, 20);
  end if;

  v_candidate := v_base;
  loop
    if not public.streambox_username_is_reserved(v_candidate)
       and not exists (
         select 1 from public.user_profiles where lower(username) = lower(v_candidate)
       )
    then
      return v_candidate;
    end if;

    v_suffix := v_suffix + 1;
    -- Trim the base so base+suffix never exceeds the 20-char limit.
    v_max_base_len := greatest(20 - length(v_suffix::text), 2);
    v_candidate := left(v_base, v_max_base_len) || v_suffix::text;
  end loop;
end;
$$;

revoke all on function public.streambox_generate_username(text) from public;
revoke all on function public.streambox_generate_username(text) from anon;

-- Backfill every existing profile that predates usernames. Deterministic order
-- so a re-run (all usernames already set) is a no-op.
do $$
declare
  v_row record;
  v_email text;
begin
  for v_row in
    select p.id
    from public.user_profiles p
    where p.username is null
    order by p.joined_at asc, p.id asc
  loop
    select u.email into v_email from auth.users u where u.id = v_row.id;
    update public.user_profiles
    set username = public.streambox_generate_username(split_part(coalesce(v_email, ''), '@', 1))
    where id = v_row.id;
  end loop;
end $$;

-- New signups get a username the same way (extends the existing trigger; the
-- rest of its body — display name, settings row — is unchanged).
create or replace function public.handle_streambox_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_display_name text;
  next_username text;
begin
  next_display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'My Profile');
  next_username := public.streambox_generate_username(split_part(coalesce(new.email, ''), '@', 1));

  insert into public.user_profiles (id, display_name, username, joined_at)
  values (new.id, next_display_name, next_username, coalesce(new.created_at, timezone('utc', now())))
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

-- Change username: validate format + reserved list, enforce a 30-day cooldown,
-- rate-limit churn, and surface a friendly hint token per failure so the client
-- can localize the message. A unique-violation from a race maps to 'taken'.
create or replace function public.set_my_username(p_username text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_current text;
  v_changed_at timestamptz;
  v_rate jsonb;
  v_profile public.user_profiles;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  v_rate := public.consume_streambox_rate_limit(v_uid, 'set_username', 10, 3600);
  if not (v_rate ->> 'allowed')::boolean then
    raise exception 'too many username changes' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username format' using errcode = 'P0001', hint = 'invalid_format';
  end if;

  if public.streambox_username_is_reserved(v_username) then
    raise exception 'username is reserved' using errcode = 'P0001', hint = 'reserved';
  end if;

  select username, username_changed_at into v_current, v_changed_at
  from public.user_profiles where id = v_uid;

  -- Idempotent no-op: setting the same handle does not consume the cooldown.
  if v_current is not null and lower(v_current) = v_username then
    select * into v_profile from public.user_profiles where id = v_uid;
    return v_profile;
  end if;

  if v_changed_at is not null
     and v_changed_at > timezone('utc', now()) - interval '30 days' then
    raise exception 'username change on cooldown' using errcode = 'P0001', hint = 'cooldown';
  end if;

  -- The old handle is freed atomically here (single UPDATE releases the old row
  -- from the unique index and claims the new value in one statement).
  begin
    update public.user_profiles
    set username = v_username,
        username_changed_at = timezone('utc', now())
    where id = v_uid
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'username is taken' using errcode = 'P0001', hint = 'taken';
  end;

  return v_profile;
end;
$$;

revoke all on function public.set_my_username(text) from public;
revoke all on function public.set_my_username(text) from anon;
grant execute on function public.set_my_username(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. FOLLOW GRAPH
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists user_follows_followee_idx
  on public.user_follows (followee_id, created_at desc);
create index if not exists user_follows_follower_idx
  on public.user_follows (follower_id, created_at desc);

alter table public.user_follows enable row level security;

revoke all on public.user_follows from anon;
revoke all on public.user_follows from authenticated;
-- Public graph, Letterboxd-style: any authenticated user may READ the whole
-- graph. Writes are RPC-only (follow_user / unfollow_user), so no insert/delete
-- grant is issued here.
grant select on public.user_follows to authenticated;

drop policy if exists "user_follows_select_all" on public.user_follows;
create policy "user_follows_select_all"
  on public.user_follows
  for select
  to authenticated
  using (true);

create or replace function public.streambox_users_are_mutual(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_follows where follower_id = p_a and followee_id = p_b)
     and exists (select 1 from public.user_follows where follower_id = p_b and followee_id = p_a);
$$;

revoke all on function public.streambox_users_are_mutual(uuid, uuid) from public;
revoke all on function public.streambox_users_are_mutual(uuid, uuid) from anon;

-- follow_user: idempotent insert + a follow notification (deduped so refollowing
-- within 7 days does not spam the bell). Self-follow blocked; target must exist.
create or replace function public.follow_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rate jsonb;
  v_row_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'cannot follow yourself' using errcode = 'P0001', hint = 'self_follow';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002', hint = 'not_found';
  end if;

  v_rate := public.consume_streambox_rate_limit(v_uid, 'follow_user', 60, 60);
  if not (v_rate ->> 'allowed')::boolean then
    raise exception 'too many follow actions' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.user_follows (follower_id, followee_id)
  values (v_uid, p_user_id)
  on conflict (follower_id, followee_id) do nothing;
  get diagnostics v_row_count = row_count;

  if v_row_count > 0 then
    if not exists (
      select 1 from public.user_notifications n
      where n.user_id = p_user_id and n.actor_id = v_uid and n.type = 'follow'
        and n.created_at > timezone('utc', now()) - interval '7 days'
    ) then
      insert into public.user_notifications (user_id, type, actor_id, payload)
      select p_user_id, 'follow', v_uid,
        jsonb_build_object(
          'username', pr.username,
          'displayName', pr.display_name,
          'avatarPath', pr.avatar_path,
          'avatarVersion', pr.avatar_version
        )
      from public.user_profiles pr where pr.id = v_uid;
    end if;
  end if;

  return jsonb_build_object('following', true);
end;
$$;

create or replace function public.unfollow_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  delete from public.user_follows
  where follower_id = v_uid and followee_id = p_user_id;
  return jsonb_build_object('following', false);
end;
$$;

revoke all on function public.follow_user(uuid) from public;
revoke all on function public.follow_user(uuid) from anon;
grant execute on function public.follow_user(uuid) to authenticated;

revoke all on function public.unfollow_user(uuid) from public;
revoke all on function public.unfollow_user(uuid) from anon;
grant execute on function public.unfollow_user(uuid) to authenticated;

-- Followers / Following list, keyset-paginated on created_at. Each row carries
-- the viewer's relationship (is_following / follows_me) so the list can render a
-- follow-back button without N extra round-trips.
create or replace function public.get_follow_list(
  p_user_id uuid,
  p_kind text,
  p_before timestamptz default null,
  p_limit integer default 40
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  avatar_version integer,
  is_following boolean,
  follows_me boolean,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 40);
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
begin
  if p_kind = 'followers' then
    return query
      select p.id, p.username, p.display_name, p.avatar_path, p.avatar_version,
        exists (select 1 from public.user_follows a where a.follower_id = v_uid and a.followee_id = p.id),
        exists (select 1 from public.user_follows b where b.follower_id = p.id and b.followee_id = v_uid),
        f.created_at
      from public.user_follows f
      join public.user_profiles p on p.id = f.follower_id
      where f.followee_id = p_user_id and f.created_at < v_before
      order by f.created_at desc
      limit v_limit;
  elsif p_kind = 'following' then
    return query
      select p.id, p.username, p.display_name, p.avatar_path, p.avatar_version,
        exists (select 1 from public.user_follows a where a.follower_id = v_uid and a.followee_id = p.id),
        exists (select 1 from public.user_follows b where b.follower_id = p.id and b.followee_id = v_uid),
        f.created_at
      from public.user_follows f
      join public.user_profiles p on p.id = f.followee_id
      where f.follower_id = p_user_id and f.created_at < v_before
      order by f.created_at desc
      limit v_limit;
  else
    raise exception 'invalid follow list kind: %', p_kind using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.get_follow_list(uuid, text, timestamptz, integer) from public;
revoke all on function public.get_follow_list(uuid, text, timestamptz, integer) from anon;
grant execute on function public.get_follow_list(uuid, text, timestamptz, integer) to authenticated;

-- Mutual follows (both directions exist) — the invite candidate list.
create or replace function public.get_mutual_follows()
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  avatar_version integer
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_path, p.avatar_version
  from public.user_follows f
  join public.user_follows g
    on g.follower_id = f.followee_id and g.followee_id = f.follower_id
  join public.user_profiles p on p.id = f.followee_id
  where f.follower_id = auth.uid()
  order by p.display_name asc, p.username asc;
$$;

revoke all on function public.get_mutual_follows() from public;
revoke all on function public.get_mutual_follows() from anon;
grant execute on function public.get_mutual_follows() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. PUBLIC PROFILE READ MODEL (curated surface, NOT RLS loosening)
-- ════════════════════════════════════════════════════════════════════════════

-- Everything a public profile header needs, plus the viewer's relationship.
-- Shared Sessions / memories are deliberately EXCLUDED (private).
create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'userId', p.id,
    'displayName', p.display_name,
    'username', p.username,
    'bio', p.bio,
    'location', p.location_text,
    'avatarPath', p.avatar_path,
    'bannerPath', p.banner_path,
    'avatarVersion', p.avatar_version,
    'bannerVersion', p.banner_version,
    'joinedAt', p.joined_at,
    'isSelf', p.id = auth.uid(),
    'isFollowing', exists (
      select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followee_id = p.id
    ),
    'followsMe', exists (
      select 1 from public.user_follows f where f.follower_id = p.id and f.followee_id = auth.uid()
    ),
    'counts', jsonb_build_object(
      'watched', (select count(*) from public.user_watch_history h where h.user_id = p.id),
      'watchlist', (select count(*) from public.user_media_library l
                    where l.user_id = p.id and l.list_kind = 'watchlist'),
      'liked', (select count(*) from public.user_media_library l
                where l.user_id = p.id and l.list_kind = 'liked'),
      'followers', (select count(*) from public.user_follows f where f.followee_id = p.id),
      'following', (select count(*) from public.user_follows f where f.follower_id = p.id)
    )
  )
  from public.user_profiles p
  where p.id = p_user_id;
$$;

revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_public_profile(uuid) from anon;
grant execute on function public.get_public_profile(uuid) to authenticated;

-- A page of a user's public Watched / Watchlist / Liked list. Projects only the
-- poster/title fields (never the raw snapshot), keyset-paginated on the item
-- timestamp. Media-list titles come from the snapshot the sync layer stores
-- ({ title, posterPath, ... }); a backfilled empty snapshot yields nulls the
-- client hydrates by tmdb_id.
create or replace function public.get_user_public_list(
  p_user_id uuid,
  p_list text,
  p_media public.media_type default null,
  p_before timestamptz default null,
  p_limit integer default 40
)
returns table (
  media_type public.media_type,
  tmdb_id bigint,
  title text,
  poster_path text,
  activity_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 40);
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
begin
  if p_list = 'watched' then
    return query
      select h.media_type, h.tmdb_id, h.title, h.poster_path, h.watched_at
      from public.user_watch_history h
      where h.user_id = p_user_id
        and (p_media is null or h.media_type = p_media)
        and h.watched_at < v_before
      order by h.watched_at desc
      limit v_limit;
  elsif p_list in ('watchlist', 'liked') then
    return query
      select l.media_type, l.tmdb_id,
        nullif(l.snapshot ->> 'title', '') as title,
        l.snapshot ->> 'posterPath' as poster_path,
        l.collected_at
      from public.user_media_library l
      where l.user_id = p_user_id
        and l.list_kind = p_list::public.user_media_list_kind
        and (p_media is null or l.media_type = p_media)
        and l.collected_at < v_before
      order by l.collected_at desc
      limit v_limit;
  else
    raise exception 'invalid list kind: %', p_list using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer) from public;
revoke all on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer) from anon;
grant execute on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer) to authenticated;

-- People search: prefix-first, rate-limited, excludes the caller. A leading '@'
-- is tolerated (the client routes @-queries here).
create or replace function public.search_users(p_query text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  avatar_version integer,
  is_following boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_prefix text;
  v_rate jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if left(v_q, 1) = '@' then
    v_q := substr(v_q, 2);
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  v_rate := public.consume_streambox_rate_limit(v_uid, 'search_users', 40, 60);
  if not (v_rate ->> 'allowed')::boolean then
    raise exception 'too many searches' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  v_prefix := v_q || '%';
  return query
    select p.id, p.username, p.display_name, p.avatar_path, p.avatar_version,
      exists (select 1 from public.user_follows f where f.follower_id = v_uid and f.followee_id = p.id)
    from public.user_profiles p
    where p.id <> v_uid
      and p.username is not null
      and (
        lower(p.username) like '%' || v_q || '%'
        or lower(p.display_name) like '%' || v_q || '%'
      )
    order by
      (case
        when lower(p.username) like v_prefix then 0
        when lower(p.display_name) like v_prefix then 1
        else 2
      end),
      p.username asc
    limit 20;
end;
$$;

revoke all on function public.search_users(text) from public;
revoke all on function public.search_users(text) from anon;
grant execute on function public.search_users(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. ACTIVITY FEED (populated by DB triggers, not app code)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('watched', 'liked', 'watchlisted')),
  media_type public.media_type not null,
  tmdb_id bigint not null,
  title text not null,
  poster_path text,
  created_at timestamptz not null default timezone('utc', now()),
  check (tmdb_id > 0)
);

create index if not exists user_activity_user_created_idx
  on public.user_activity (user_id, created_at desc, id desc);
create index if not exists user_activity_created_idx
  on public.user_activity (created_at desc, id desc);

-- created_at intentionally uses the DB insert time (default now()), NOT the
-- original watched_at — a bulk Letterboxd import then lands as a burst the
-- client-side feed grouping collapses into one "watched N films" row.

create or replace function public.streambox_activity_from_watch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_activity (user_id, event_type, media_type, tmdb_id, title, poster_path)
  values (new.user_id, 'watched', new.media_type, new.tmdb_id, new.title, new.poster_path);
  return null;
end;
$$;

create or replace function public.streambox_activity_retract_watch_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_activity
  where user_id = old.user_id and event_type = 'watched'
    and media_type = old.media_type and tmdb_id = old.tmdb_id;
  return null;
end;
$$;

create or replace function public.streambox_activity_from_media_library()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text := case when new.list_kind = 'liked' then 'liked' else 'watchlisted' end;
begin
  insert into public.user_activity (user_id, event_type, media_type, tmdb_id, title, poster_path)
  values (
    new.user_id, v_event, new.media_type, new.tmdb_id,
    coalesce(nullif(new.snapshot ->> 'title', ''), ''),
    new.snapshot ->> 'posterPath'
  );
  return null;
end;
$$;

create or replace function public.streambox_activity_retract_media_library()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text := case when old.list_kind = 'liked' then 'liked' else 'watchlisted' end;
begin
  delete from public.user_activity
  where user_id = old.user_id and event_type = v_event
    and media_type = old.media_type and tmdb_id = old.tmdb_id;
  return null;
end;
$$;

revoke all on function public.streambox_activity_from_watch_history() from public, anon, authenticated;
revoke all on function public.streambox_activity_retract_watch_history() from public, anon, authenticated;
revoke all on function public.streambox_activity_from_media_library() from public, anon, authenticated;
revoke all on function public.streambox_activity_retract_media_library() from public, anon, authenticated;

-- AFTER INSERT only fires for genuinely new rows: an upsert that resolves to a
-- conflicting row fires UPDATE triggers instead, so the sync queue's replayed
-- upserts never duplicate activity.
drop trigger if exists streambox_activity_watch_history_ins on public.user_watch_history;
create trigger streambox_activity_watch_history_ins
  after insert on public.user_watch_history
  for each row execute function public.streambox_activity_from_watch_history();

drop trigger if exists streambox_activity_watch_history_del on public.user_watch_history;
create trigger streambox_activity_watch_history_del
  after delete on public.user_watch_history
  for each row execute function public.streambox_activity_retract_watch_history();

drop trigger if exists streambox_activity_media_library_ins on public.user_media_library;
create trigger streambox_activity_media_library_ins
  after insert on public.user_media_library
  for each row
  when (new.list_kind in ('watchlist', 'liked'))
  execute function public.streambox_activity_from_media_library();

drop trigger if exists streambox_activity_media_library_del on public.user_media_library;
create trigger streambox_activity_media_library_del
  after delete on public.user_media_library
  for each row
  when (old.list_kind in ('watchlist', 'liked'))
  execute function public.streambox_activity_retract_media_library();

alter table public.user_activity enable row level security;
revoke all on public.user_activity from anon;
revoke all on public.user_activity from authenticated;
-- No direct grants: activity is written by triggers and read via the RPC below.
-- An owner-can-read policy is kept for defense-in-depth / debugging only.
drop policy if exists "user_activity_select_own" on public.user_activity;
create policy "user_activity_select_own"
  on public.user_activity
  for select
  to authenticated
  using (user_id = auth.uid());

-- Feed of everyone the caller follows, newest first, composite keyset cursor
-- (created_at, id) so a burst of identical timestamps (bulk import) paginates
-- without skips or repeats.
create or replace function public.get_following_activity(
  p_before timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns table (
  activity_id bigint,
  actor_id uuid,
  username text,
  display_name text,
  avatar_path text,
  avatar_version integer,
  event_type text,
  media_type public.media_type,
  tmdb_id bigint,
  title text,
  poster_path text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.user_id, p.username, p.display_name, p.avatar_path, p.avatar_version,
         a.event_type, a.media_type, a.tmdb_id, a.title, a.poster_path, a.created_at
  from public.user_activity a
  join public.user_profiles p on p.id = a.user_id
  where a.user_id in (
      select followee_id from public.user_follows where follower_id = auth.uid()
    )
    and (a.created_at, a.id) < (
      coalesce(p_before, 'infinity'::timestamptz),
      coalesce(p_before_id, 9223372036854775807)
    )
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke all on function public.get_following_activity(timestamptz, bigint, integer) from public;
revoke all on function public.get_following_activity(timestamptz, bigint, integer) from anon;
grant execute on function public.get_following_activity(timestamptz, bigint, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. IN-APP NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('follow', 'watch_invite')),
  actor_id uuid references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);
create index if not exists user_notifications_unread_idx
  on public.user_notifications (user_id) where read_at is null;

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon;
revoke all on public.user_notifications from authenticated;
-- Recipients may READ their own notifications (also gates Realtime delivery).
-- The only mutation is marking read, via the RPC below — no write grant here.
grant select on public.user_notifications to authenticated;

drop policy if exists "user_notifications_select_own" on public.user_notifications;
create policy "user_notifications_select_own"
  on public.user_notifications
  for select
  to authenticated
  using (user_id = auth.uid());

-- Mark some (or, with null, all) of the caller's unread notifications read.
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  update public.user_notifications
  set read_at = timezone('utc', now())
  where user_id = v_uid and read_at is null
    and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(bigint[]) from public;
revoke all on function public.mark_notifications_read(bigint[]) from anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. WATCH TOGETHER INVITES (mutual-follow gated, 2-minute TTL)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.watch_invites (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  room_code text not null,
  media_type public.media_type not null,
  tmdb_id bigint not null,
  title text not null,
  poster_path text,
  backdrop_path text,
  year text,
  imdb_id text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  responded_at timestamptz,
  check (from_user <> to_user),
  check (tmdb_id > 0),
  check (char_length(btrim(title)) between 1 and 300)
);

create index if not exists watch_invites_to_user_idx
  on public.watch_invites (to_user, created_at desc);
create index if not exists watch_invites_from_user_idx
  on public.watch_invites (from_user, created_at desc);
-- At most one PENDING invite per ordered pair — the race-safe spam guard.
create unique index if not exists watch_invites_pending_pair_idx
  on public.watch_invites (from_user, to_user) where status = 'pending';

alter table public.watch_invites enable row level security;
revoke all on public.watch_invites from anon;
revoke all on public.watch_invites from authenticated;
-- Either party may READ their invites (gates Realtime delivery for both the
-- recipient's incoming popup and the sender's waiting overlay). Writes are
-- RPC-only.
grant select on public.watch_invites to authenticated;

drop policy if exists "watch_invites_select_party" on public.watch_invites;
create policy "watch_invites_select_party"
  on public.watch_invites
  for select
  to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- send_watch_invite: server-side mutual-follow gate + room-membership check,
-- 2-minute TTL, one-pending-per-pair, plus the recipient notification that
-- drives the incoming popup and the push.
create or replace function public.send_watch_invite(
  p_to_user uuid,
  p_room_code text,
  p_media_type public.media_type,
  p_tmdb_id bigint,
  p_title text,
  p_poster_path text default null,
  p_backdrop_path text default null,
  p_year text default null,
  p_imdb_id text default null
)
returns public.watch_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.watch_rooms;
  v_invite public.watch_invites;
  v_rate jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_to_user is null or p_to_user = v_uid then
    raise exception 'invalid invite target' using errcode = 'P0001', hint = 'invalid_target';
  end if;

  if not public.streambox_users_are_mutual(v_uid, p_to_user) then
    raise exception 'invite requires a mutual follow' using errcode = 'P0001', hint = 'not_mutual';
  end if;

  -- Sender must currently be a member of a live room with this code.
  select r.* into v_room
  from public.watch_rooms r
  join public.watch_room_members m on m.room_id = r.id
  where r.code = upper(btrim(p_room_code))
    and m.user_id = v_uid
    and r.status <> 'ended'
    and r.expires_at > timezone('utc', now());
  if not found then
    raise exception 'not a member of that room' using errcode = 'P0002', hint = 'not_in_room';
  end if;

  v_rate := public.consume_streambox_rate_limit(v_uid, 'send_invite', 20, 300);
  if not (v_rate ->> 'allowed')::boolean then
    raise exception 'too many invites' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  -- Lazily expire a stale pending invite for this pair so the unique partial
  -- index does not block a fresh one.
  update public.watch_invites
  set status = 'expired', responded_at = timezone('utc', now())
  where from_user = v_uid and to_user = p_to_user
    and status = 'pending' and expires_at <= timezone('utc', now());

  if exists (
    select 1 from public.watch_invites
    where from_user = v_uid and to_user = p_to_user
      and status = 'pending' and expires_at > timezone('utc', now())
  ) then
    raise exception 'invite already pending' using errcode = 'P0001', hint = 'already_pending';
  end if;

  insert into public.watch_invites (
    from_user, to_user, room_code, media_type, tmdb_id, title,
    poster_path, backdrop_path, year, imdb_id, expires_at
  )
  values (
    v_uid, p_to_user, upper(btrim(p_room_code)), p_media_type, p_tmdb_id, btrim(p_title),
    p_poster_path, p_backdrop_path, p_year, p_imdb_id,
    timezone('utc', now()) + interval '2 minutes'
  )
  returning * into v_invite;

  insert into public.user_notifications (user_id, type, actor_id, payload)
  select p_to_user, 'watch_invite', v_uid,
    jsonb_build_object(
      'inviteId', v_invite.id,
      'roomCode', v_invite.room_code,
      'mediaType', v_invite.media_type,
      'tmdbId', v_invite.tmdb_id,
      'title', v_invite.title,
      'posterPath', v_invite.poster_path,
      'backdropPath', v_invite.backdrop_path,
      'year', v_invite.year,
      'imdbId', v_invite.imdb_id,
      'expiresAt', v_invite.expires_at,
      'username', pr.username,
      'displayName', pr.display_name,
      'avatarPath', pr.avatar_path,
      'avatarVersion', pr.avatar_version
    )
  from public.user_profiles pr where pr.id = v_uid;

  return v_invite;
end;
$$;

-- respond_watch_invite: recipient only. The atomic status predicate makes a
-- late cancel/expiry the winner — accepting a cancelled invite is impossible.
create or replace function public.respond_watch_invite(p_invite_id uuid, p_accept boolean)
returns public.watch_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.watch_invites;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.watch_invites
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = timezone('utc', now())
  where id = p_invite_id
    and to_user = v_uid
    and status = 'pending'
    and expires_at > timezone('utc', now())
  returning * into v_invite;

  if not found then
    -- Flip an expired-but-still-pending row so its state reads correctly, then
    -- report unavailability (cancelled / already handled / expired).
    update public.watch_invites
    set status = 'expired'
    where id = p_invite_id and to_user = v_uid
      and status = 'pending' and expires_at <= timezone('utc', now());
    raise exception 'invite is no longer available' using errcode = 'P0002', hint = 'invite_unavailable';
  end if;

  return v_invite;
end;
$$;

-- cancel_watch_invite: sender only, pending only.
create or replace function public.cancel_watch_invite(p_invite_id uuid)
returns public.watch_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.watch_invites;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  update public.watch_invites
  set status = 'cancelled', responded_at = timezone('utc', now())
  where id = p_invite_id and from_user = v_uid and status = 'pending'
  returning * into v_invite;
  if not found then
    raise exception 'invite cannot be cancelled' using errcode = 'P0002', hint = 'cannot_cancel';
  end if;
  return v_invite;
end;
$$;

-- Single-invite read for the waiting-overlay 5s poll + recipient popup rehydrate
-- (either party). Expiry is derived client-side from expires_at, so a killed app
-- opening an old notification sees the expired state.
create or replace function public.get_watch_invite(p_invite_id uuid)
returns public.watch_invites
language sql
security definer
stable
set search_path = public
as $$
  select * from public.watch_invites
  where id = p_invite_id and (from_user = auth.uid() or to_user = auth.uid());
$$;

revoke all on function public.send_watch_invite(uuid, text, public.media_type, bigint, text, text, text, text, text) from public;
revoke all on function public.send_watch_invite(uuid, text, public.media_type, bigint, text, text, text, text, text) from anon;
grant execute on function public.send_watch_invite(uuid, text, public.media_type, bigint, text, text, text, text, text) to authenticated;

revoke all on function public.respond_watch_invite(uuid, boolean) from public;
revoke all on function public.respond_watch_invite(uuid, boolean) from anon;
grant execute on function public.respond_watch_invite(uuid, boolean) to authenticated;

revoke all on function public.cancel_watch_invite(uuid) from public;
revoke all on function public.cancel_watch_invite(uuid) from anon;
grant execute on function public.cancel_watch_invite(uuid) to authenticated;

revoke all on function public.get_watch_invite(uuid) from public;
revoke all on function public.get_watch_invite(uuid) from anon;
grant execute on function public.get_watch_invite(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. ANDROID PUSH TOKENS
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, token),
  check (char_length(btrim(token)) between 1 and 512),
  check (platform in ('android', 'ios'))
);

create index if not exists user_push_tokens_user_idx
  on public.user_push_tokens (user_id);

alter table public.user_push_tokens enable row level security;
revoke all on public.user_push_tokens from anon;
revoke all on public.user_push_tokens from authenticated;
-- Owner-scoped: the client can read/delete its own tokens (sign-out cleanup);
-- registration is via the upsert RPC. The push Worker reads with the service
-- role, which bypasses RLS.
grant select, delete on public.user_push_tokens to authenticated;

drop policy if exists "user_push_tokens_select_own" on public.user_push_tokens;
create policy "user_push_tokens_select_own"
  on public.user_push_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_push_tokens_delete_own" on public.user_push_tokens;
create policy "user_push_tokens_delete_own"
  on public.user_push_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;
  insert into public.user_push_tokens (user_id, token, platform, updated_at)
  values (v_uid, btrim(p_token), coalesce(nullif(btrim(p_platform), ''), 'android'), timezone('utc', now()))
  on conflict (user_id, token)
  do update set updated_at = timezone('utc', now()), platform = excluded.platform;
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
revoke all on function public.register_push_token(text, text) from anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. PROFILE-ASSET VISIBILITY (public profiles need peers' avatars/banners)
-- ════════════════════════════════════════════════════════════════════════════
-- The profile-assets bucket is private and previously readable ONLY by its
-- owner (profile_assets_select_own from 20260312). Public profiles / follow
-- lists / the activity feed all render OTHER users' avatars + banners, so add a
-- read policy for exactly those two subfolders to every authenticated user.
-- The bucket stays private (bio/settings never lived here anyway; only
-- {uid}/avatars/… and {uid}/banners/… objects exist), and the client resolves
-- peers' images with short-lived signed URLs.
drop policy if exists "profile_assets_peer_read" on storage.objects;
create policy "profile_assets_peer_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'profile-assets'
    and (storage.foldername(name))[2] in ('avatars', 'banners')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 9. REALTIME PUBLICATION (RLS still applies to postgres_changes)
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'watch_invites'
  ) then
    alter publication supabase_realtime add table public.watch_invites;
  end if;
end $$;

-- Nudge PostgREST to pick up the new tables + functions immediately.
notify pgrst, 'reload schema';
