-- Watch Together: carry the resolver's match fields (IMDb id, year, original
-- title) on the room so BOTH participants resolve the SAME title. Without them
-- the provider match scoring in WebPlayerService can pick a wrong-title stream
-- (e.g. "Obsession" 2026 → "Fear" 1996). Idempotent; apply manually.

alter table public.watch_rooms
  add column if not exists imdb_id text,
  add column if not exists year text,
  add column if not exists original_title text;

-- create_watch_room gains three optional params. Drop the old signature first
-- (adding params changes the signature, which create-or-replace can't do).
drop function if exists public.create_watch_room(
  text, public.media_type, integer, text, text, text, text, smallint, smallint
);

create or replace function public.create_watch_room(
  p_code text,
  p_media_type public.media_type,
  p_tmdb_id integer,
  p_title text,
  p_nickname text,
  p_poster_path text default null,
  p_backdrop_path text default null,
  p_season_number smallint default null,
  p_episode_number smallint default null,
  p_imdb_id text default null,
  p_year text default null,
  p_original_title text default null
)
returns public.watch_rooms
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint, text, text, text) from public;
revoke all on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint, text, text, text) from anon;
grant execute on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint, text, text, text) to authenticated;
