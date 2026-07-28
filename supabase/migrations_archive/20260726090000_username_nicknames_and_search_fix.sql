-- ════════════════════════════════════════════════════════════════════════════
-- Fixes + rework on top of 20260725120000_social_follow_platform.sql
--
-- 1) search_users was declared STABLE but consumes the shared rate limiter,
--    which INSERTs into private.rate_limit_windows. PostgREST executes
--    stable/immutable RPCs inside a READ ONLY transaction, so every call died
--    with "cannot execute INSERT in a read-only transaction" and the client
--    rendered an empty People section. Recreated VOLATILE with the same body.
--
-- 2) Generated usernames must not leak the email local part
--    (esqinmemmedov700 → bad). New movie-themed nickname generator
--    (night_owl_7 style), wired into the signup trigger, plus a re-backfill of
--    every profile whose handle was never manually changed
--    (username_changed_at IS NULL — only set_my_username sets it, so custom
--    handles are preserved).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. search_users: volatile so the rate-limit write is legal ──────────────
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

-- ── 2. Movie-themed nickname generator ──────────────────────────────────────
-- Deterministic per user (hash of the uuid picks the combo) so a re-run of the
-- backfill is a no-op; probes attempt+1 combos until one is free. Word lists
-- are sized so adjective(≤8) + '_' + noun(≤7) + '_' + 1-2 digits ≤ 20 chars,
-- which keeps every candidate inside the username format constraint.
create or replace function public.streambox_generate_nickname(p_seed uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adjectives text[] := array[
    'night', 'silver', 'noir', 'retro', 'cosmic', 'midnight', 'golden',
    'shadow', 'electric', 'crimson', 'lunar', 'neon', 'velvet', 'silent',
    'wild', 'indie', 'mystic', 'stellar', 'scarlet', 'vintage'
  ];
  v_nouns text[] := array[
    'owl', 'reel', 'frame', 'popcorn', 'cameo', 'scene', 'script', 'usher',
    'critic', 'binger', 'rewind', 'matinee', 'montage', 'credits', 'sequel',
    'teaser', 'poster', 'ticket', 'screen', 'camera'
  ];
  v_hash bigint;
  v_candidate text;
  v_attempt integer := 0;
begin
  -- Mask the sign bit so the modulo arithmetic below never goes negative.
  v_hash := hashtextextended(coalesce(p_seed::text, gen_random_uuid()::text), 42)
            & 9223372036854775807;
  loop
    v_candidate :=
      v_adjectives[1 + ((v_hash + v_attempt) % array_length(v_adjectives, 1))::int]
      || '_'
      || v_nouns[1 + ((v_hash / 7 + v_attempt * 3) % array_length(v_nouns, 1))::int]
      || '_'
      || (1 + ((v_hash / 13 + v_attempt * 17) % 99))::text;

    if length(v_candidate) <= 20
       and not public.streambox_username_is_reserved(v_candidate)
       and not exists (
         -- Ignore the seed user's own row so re-running the backfill
         -- deterministically regenerates the same handle (no-op).
         select 1 from public.user_profiles
         where lower(username) = lower(v_candidate)
           and id is distinct from p_seed
       )
    then
      return v_candidate;
    end if;

    v_attempt := v_attempt + 1;
    if v_attempt > 2000 then
      -- ~40k combos exhausted; fall back to the legacy numeric-suffix path.
      return public.streambox_generate_username('user');
    end if;
  end loop;
end;
$$;

revoke all on function public.streambox_generate_nickname(uuid) from public;
revoke all on function public.streambox_generate_nickname(uuid) from anon;

-- New signups: nickname handle, no email involvement at all.
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
  next_username := public.streambox_generate_nickname(new.id);

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

-- Re-backfill: replace every never-manually-changed handle (this includes all
-- the email-derived ones from 20260725120000). Custom handles keep their
-- username_changed_at and are skipped.
do $$
declare
  v_row record;
begin
  for v_row in
    select p.id
    from public.user_profiles p
    where p.username_changed_at is null
    order by p.joined_at asc, p.id asc
  loop
    update public.user_profiles
    set username = public.streambox_generate_nickname(v_row.id)
    where id = v_row.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
