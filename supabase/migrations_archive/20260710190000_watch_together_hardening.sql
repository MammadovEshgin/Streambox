-- Watch Together — security & lifecycle hardening. Apply manually (never db push).
--
-- ⚠ ORDER MATTERS FOR TESTING: the app (from this commit on) joins the room's
-- Realtime channel with private:true. Until sections 1–2 below are applied,
-- private channel joins are REJECTED and Watch Together cannot connect. Apply
-- this migration BEFORE testing the new build.
--
-- 1) Membership check by room code (channels are named watch-room:<code>).
-- 2) Realtime authorization: only room members may receive/send on a room's
--    private channel. Previously the channel was public — anyone holding the
--    anon key + the 6-char code could eavesdrop chat/signals and inject
--    playback control without ever joining the room.
-- 3) Memories: drop the direct-DELETE policy (deletes must go through the
--    per-user remove_watch_memory RPC — a creator could otherwise hard-delete
--    the shared row and erase the partner's copy).
-- 4) Storage: allow members to OVERWRITE objects in their room's folder — the
--    memory-upload outbox retries with a deterministic path, and an upsert on
--    an existing object needs UPDATE (a retried half-finished upload was
--    otherwise stuck forever).
-- 5) join_watch_room: 500ms penalty on the not-found path. An exception rolls
--    back any attempt logging, but the sleep happens BEFORE the raise, so
--    brute-forcing codes is throttled to ~2 guesses/second per connection.
-- 6) cleanup_expired_watch_rooms(): purges long-expired room rows and their
--    orphaned Storage objects (camera stills were never deleted anywhere).
--    Scheduled via pg_cron when available; also nudged opportunistically by
--    the app (at most once/day per device).

-- ── 1. Membership by code ────────────────────────────────────────────────────
create or replace function public.is_watch_room_member_by_code(p_code text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.watch_rooms r
    join public.watch_room_members m on m.room_id = r.id
    where r.code = upper(p_code)
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_watch_room_member_by_code(text) from public;
revoke all on function public.is_watch_room_member_by_code(text) from anon;
grant execute on function public.is_watch_room_member_by_code(text) to authenticated;

-- ── 2. Private Realtime channels (topics: watch-room:<code>) ────────────────
drop policy if exists "watch_room_channel_receive" on realtime.messages;
create policy "watch_room_channel_receive"
  on realtime.messages
  for select
  to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'watch-room:%'
    and public.is_watch_room_member_by_code(split_part((select realtime.topic()), ':', 2))
  );

drop policy if exists "watch_room_channel_send" on realtime.messages;
create policy "watch_room_channel_send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'watch-room:%'
    and public.is_watch_room_member_by_code(split_part((select realtime.topic()), ':', 2))
  );

-- ── 3. Memories: RPC is the only delete path ─────────────────────────────────
drop policy if exists "watch_room_memories_delete_own" on public.watch_room_memories;

-- ── 4. Storage: members may overwrite their room's objects (outbox retries) ──
drop policy if exists "watch_memories_member_update" on storage.objects;
create policy "watch_memories_member_update"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'watch-memories' and public.is_watch_room_member((storage.foldername(name))[1]))
  with check (bucket_id = 'watch-memories' and public.is_watch_room_member((storage.foldername(name))[1]));

-- ── 5. join_watch_room: throttle code guessing ───────────────────────────────
create or replace function public.join_watch_room(
  p_code text,
  p_nickname text
)
returns public.watch_rooms
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ── 6. Expired-room cleanup ──────────────────────────────────────────────────
-- Rooms expire after 12h but nothing ever deleted the rows, and the camera
-- stills under {room}/stills/ were never cleaned up at all. 7 days after
-- expiry: drop the room's Storage objects (except polaroids still referenced
-- by a memory row — those stay for the shelf) and the room row itself
-- (members cascade; memories keep working via participant_user_ids +
-- the participant read policy from 20260709120000).
create or replace function public.cleanup_expired_watch_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.cleanup_expired_watch_rooms() from public;
revoke all on function public.cleanup_expired_watch_rooms() from anon;
-- The app nudges this at most once a day per device; it only ever touches
-- rooms expired >7 days, so authenticated execution is safe.
grant execute on function public.cleanup_expired_watch_rooms() to authenticated;

-- Schedule daily at 04:30 UTC when pg_cron is enabled (Dashboard → Database →
-- Extensions). Harmless no-op otherwise — the app-side nudge still runs it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('watch-together-cleanup', '30 4 * * *', 'select public.cleanup_expired_watch_rooms()');
  end if;
end $$;

-- Nudge PostgREST to pick up the new/redefined functions immediately.
notify pgrst, 'reload schema';
