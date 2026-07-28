-- ════════════════════════════════════════════════════════════════════════════
-- get_user_public_list: reliable FULL pagination (on top of 20260725120000).
--
-- Field symptom: a peer's Watched/Watchlist/Liked sections showed only a handful
-- of titles even though the profile counts said 89, and "See all" stopped after
-- one page. Two root causes:
--
--   1) The limit was hard-capped at 40 AND the client only ever asked for one
--      page, so at most 40 rows were ever fetched.
--   2) Pagination used a single-column keyset (activity_at < p_before). Letterboxd
--      imports and the local→cloud backfill stamp every row with an IDENTICAL
--      collected_at, so page 2 (`collected_at < <that timestamp>`) skipped EVERY
--      remaining tied row — "many but not all".
--
-- Fix: OFFSET-based pagination with a fully deterministic ORDER BY
-- (activity_at desc, tmdb_id desc, media_type desc) so no rows are ever skipped
-- or duplicated across pages regardless of timestamp ties; cap raised to 100.
-- p_before is retained (still honored) for backward compatibility.
--
-- The signature changes (adds p_offset), so DROP the old 5-arg function first to
-- avoid a PostgREST overload ambiguity, then recreate. Column names/types of the
-- returned table are unchanged, so the client mapping is untouched.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer);

create or replace function public.get_user_public_list(
  p_user_id uuid,
  p_list text,
  p_media public.media_type default null,
  p_before timestamptz default null,
  p_limit integer default 40,
  p_offset integer default 0
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
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
begin
  if p_list = 'watched' then
    return query
      select h.media_type, h.tmdb_id, h.title, h.poster_path, h.watched_at
      from public.user_watch_history h
      where h.user_id = p_user_id
        and (p_media is null or h.media_type = p_media)
        and h.watched_at < v_before
      order by h.watched_at desc, h.tmdb_id desc, h.media_type desc
      limit v_limit offset v_offset;
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
      order by l.collected_at desc, l.tmdb_id desc, l.media_type desc
      limit v_limit offset v_offset;
  else
    raise exception 'invalid list kind: %', p_list using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer, integer) from public;
revoke all on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer, integer) from anon;
grant execute on function public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer, integer) to authenticated;

notify pgrst, 'reload schema';
