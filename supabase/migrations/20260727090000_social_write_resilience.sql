-- ════════════════════════════════════════════════════════════════════════════
-- Resilience for social WRITE RPCs (on top of 20260725120000 / 20260726*).
--
-- Field symptom: tapping Follow bumped the follower count for a moment and then
-- snapped back to 0 — i.e. follow_user RAISED and the client rolled back its
-- optimistic update. Two independent failure modes were possible, both fixed
-- here in the same spirit as the search_users hardening in 20260726100000:
--
--   1) The shared rate limiter now degrades OPEN inside every social write RPC.
--      consume_streambox_rate_limit() INSERTs into private.rate_limit_windows;
--      if that bookkeeping throws for ANY reason it must never abort the user's
--      action. A follow / handle change is not worth losing over a rate-limit
--      write hiccup — the limit is a courtesy, not a correctness gate.
--
--   2) follow_user's bell-notification INSERT is now best-effort: wrapped in its
--      own sub-block (savepoint) so a notification failure can only roll back the
--      notification, never the follow row itself. Previously any error building
--      or inserting the notification aborted the whole transaction and the
--      follow silently vanished.
--
-- Pure CREATE OR REPLACE of existing functions (signatures unchanged); sorts
-- after the remote head. Grants re-asserted defensively.
-- ════════════════════════════════════════════════════════════════════════════

-- ── follow_user: degrade-open limiter + best-effort notification ─────────────
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

  -- Rate limit is best-effort: never let its bookkeeping block the follow.
  begin
    v_rate := public.consume_streambox_rate_limit(v_uid, 'follow_user', 60, 60);
  exception
    when others then
      v_rate := jsonb_build_object('allowed', true);
  end;
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
    raise exception 'too many follow actions' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.user_follows (follower_id, followee_id)
  values (v_uid, p_user_id)
  on conflict (follower_id, followee_id) do nothing;
  get diagnostics v_row_count = row_count;

  -- Only a genuinely new edge produces a (deduped) notification, and the whole
  -- thing is best-effort: a notification failure must not undo the follow.
  if v_row_count > 0 then
    begin
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
    exception
      when others then
        null; -- swallow: the bell is a courtesy, the follow already committed
    end;
  end if;

  return jsonb_build_object('following', true);
end;
$$;

revoke all on function public.follow_user(uuid) from public;
revoke all on function public.follow_user(uuid) from anon;
grant execute on function public.follow_user(uuid) to authenticated;

-- ── set_my_username: degrade-open limiter (rest of the body unchanged) ───────
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

  begin
    v_rate := public.consume_streambox_rate_limit(v_uid, 'set_username', 10, 3600);
  exception
    when others then
      v_rate := jsonb_build_object('allowed', true);
  end;
  if not coalesce((v_rate ->> 'allowed')::boolean, true) then
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

-- Nudge PostgREST to reload the updated function definitions immediately.
notify pgrst, 'reload schema';
