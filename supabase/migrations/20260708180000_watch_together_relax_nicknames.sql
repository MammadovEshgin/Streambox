-- Watch Together: nicknames are display-only labels, not identities. Drop the
-- per-room uniqueness (it blocked legitimate joins) and make join idempotent so
-- re-entering a room never errors. Apply manually; idempotent.

drop index if exists public.watch_room_members_room_nickname_key;

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
