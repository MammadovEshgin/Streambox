-- ════════════════════════════════════════════════════════════════════════════
-- search_users robustness (on top of 20260726090000)
--
-- The people-search RPC kept coming back empty in the field. Root cause was the
-- STABLE-with-write bug fixed in 20260726090000 (PostgREST ran it read-only, so
-- the rate-limit INSERT aborted the whole call). This migration hardens the same
-- function so a rate-limit hiccup can NEVER swallow search results again, and
-- fixes a correctness nit:
--   • VOLATILE (unchanged) so the rate-limit write is legal.
--   • The rate-limit call degrades OPEN: if the bookkeeping INSERT throws for any
--     reason, search still runs (the limit is a courtesy, not a gate on reads).
--   • LIKE wildcards in the query are escaped — nickname handles contain '_',
--     which is a single-char wildcard in LIKE and was over-matching.
-- ════════════════════════════════════════════════════════════════════════════

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
  v_like text;
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

  -- Rate limit is best-effort: never let its bookkeeping block a read.
  begin
    v_rate := public.consume_streambox_rate_limit(v_uid, 'search_users', 40, 60);
  exception
    when others then
      v_rate := jsonb_build_object('allowed', true);
  end;
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'too many searches' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  -- Escape LIKE metacharacters (\ % _) so an underscore in a nickname handle is
  -- matched literally rather than as a wildcard.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_prefix := v_like || '%';

  return query
    select p.id, p.username, p.display_name, p.avatar_path, p.avatar_version,
      exists (select 1 from public.user_follows f where f.follower_id = v_uid and f.followee_id = p.id)
    from public.user_profiles p
    where p.id <> v_uid
      and p.username is not null
      and (
        lower(p.username) like '%' || v_like || '%' escape '\'
        or lower(p.display_name) like '%' || v_like || '%' escape '\'
      )
    order by
      (case
        when lower(p.username) like v_prefix escape '\' then 0
        when lower(p.display_name) like v_prefix escape '\' then 1
        else 2
      end),
      p.username asc
    limit 20;
end;
$$;

revoke all on function public.search_users(text) from public;
revoke all on function public.search_users(text) from anon;
grant execute on function public.search_users(text) to authenticated;

notify pgrst, 'reload schema';
