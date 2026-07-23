-- Watch Together — private 2-person watch rooms (synced playback + face-cam +
-- polaroid memories). Media (camera/mic) rides WebRTC peer-to-peer and never
-- touches Postgres; these tables hold only durable room state and the saved
-- polaroid "memories". Ephemeral signaling/sync/chat rides Supabase Realtime
-- broadcast, so nothing here is written per keystroke or per ICE candidate.
--
-- Reuses the existing public.media_type enum. Apply manually (never db push).

-- ── Membership helper (SECURITY DEFINER to avoid recursive RLS on the members
-- table). Accepts text so the same function guards uuid columns and Storage
-- folder names; a non-uuid input safely denies. ────────────────────────────
create or replace function public.is_watch_room_member(p_room_id text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  begin
    v_room_id := p_room_id::uuid;
  exception
    when others then
      return false;
  end;

  return exists (
    select 1
    from public.watch_room_members
    where room_id = v_room_id
      and user_id = auth.uid()
  );
end;
$$;

revoke all on function public.is_watch_room_member(text) from public;
revoke all on function public.is_watch_room_member(text) from anon;
grant execute on function public.is_watch_room_member(text) to authenticated;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.watch_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references auth.users (id) on delete cascade,
  media_type public.media_type not null,
  tmdb_id integer not null,
  title text not null,
  poster_path text,
  backdrop_path text,
  season_number smallint,
  episode_number smallint,
  status text not null default 'lobby',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '12 hours',
  check (status in ('lobby', 'watching', 'ended')),
  check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  check (char_length(btrim(title)) between 1 and 300),
  check (tmdb_id > 0)
);

create table if not exists public.watch_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null,
  role text not null,
  joined_at timestamptz not null default timezone('utc', now()),
  unique (room_id, user_id),
  check (role in ('host', 'guest')),
  check (char_length(btrim(nickname)) between 1 and 20)
);

-- Session nickname is unique within a room, case-insensitively.
create unique index if not exists watch_room_members_room_nickname_key
  on public.watch_room_members (room_id, lower(nickname));
create index if not exists watch_room_members_user_idx
  on public.watch_room_members (user_id);

create table if not exists public.watch_room_memories (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.watch_rooms (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  media_type public.media_type not null,
  tmdb_id integer not null,
  title text not null,
  position_seconds integer not null default 0,
  image_path text not null,
  caption text,
  participant_nicknames text[] not null default '{}',
  -- Denormalized so BOTH participants keep the memory even after the room row
  -- expires and is cleaned up.
  participant_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  check (char_length(btrim(title)) between 1 and 300),
  check (position_seconds >= 0)
);

create index if not exists watch_room_memories_participants_idx
  on public.watch_room_memories using gin (participant_user_ids);

-- ── updated_at trigger (reuses public.set_updated_at from the user-data platform) ──
drop trigger if exists watch_rooms_set_updated_at on public.watch_rooms;
create trigger watch_rooms_set_updated_at
  before update on public.watch_rooms
  for each row execute function public.set_updated_at();

-- ── Grants ──────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.watch_rooms to authenticated;
grant select, insert, update, delete on public.watch_room_members to authenticated;
grant select, insert, update, delete on public.watch_room_memories to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.watch_rooms enable row level security;
alter table public.watch_room_members enable row level security;
alter table public.watch_room_memories enable row level security;

-- Rooms: a member can read the room; only the host can mutate it directly
-- (creation/joining go through the RPCs below, which run as SECURITY DEFINER).
drop policy if exists "watch_rooms_select_member" on public.watch_rooms;
create policy "watch_rooms_select_member"
  on public.watch_rooms
  for select
  to authenticated
  using (public.is_watch_room_member(id::text));

drop policy if exists "watch_rooms_update_host" on public.watch_rooms;
create policy "watch_rooms_update_host"
  on public.watch_rooms
  for update
  to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

drop policy if exists "watch_rooms_delete_host" on public.watch_rooms;
create policy "watch_rooms_delete_host"
  on public.watch_rooms
  for delete
  to authenticated
  using (host_user_id = auth.uid());

-- Members: everyone in a room can see the room's members (needed to render the
-- lobby and enforce nickname uniqueness client-side); a user can remove only
-- their own membership.
drop policy if exists "watch_room_members_select_same_room" on public.watch_room_members;
create policy "watch_room_members_select_same_room"
  on public.watch_room_members
  for select
  to authenticated
  using (public.is_watch_room_member(room_id::text));

drop policy if exists "watch_room_members_delete_own" on public.watch_room_members;
create policy "watch_room_members_delete_own"
  on public.watch_room_members
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Memories: a participant can read/insert their room's memories.
drop policy if exists "watch_room_memories_select_participant" on public.watch_room_memories;
create policy "watch_room_memories_select_participant"
  on public.watch_room_memories
  for select
  to authenticated
  using (auth.uid() = any (participant_user_ids) or public.is_watch_room_member(room_id::text));

drop policy if exists "watch_room_memories_insert_participant" on public.watch_room_memories;
create policy "watch_room_memories_insert_participant"
  on public.watch_room_memories
  for insert
  to authenticated
  with check (created_by = auth.uid() and public.is_watch_room_member(room_id::text));

drop policy if exists "watch_room_memories_delete_own" on public.watch_room_memories;
create policy "watch_room_memories_delete_own"
  on public.watch_room_memories
  for delete
  to authenticated
  using (created_by = auth.uid());

-- ── RPCs (SECURITY DEFINER): create/join look rooms up by code across RLS, so
-- the join code alone is the capability to enter a private room. ─────────────
create or replace function public.create_watch_room(
  p_code text,
  p_media_type public.media_type,
  p_tmdb_id integer,
  p_title text,
  p_nickname text,
  p_poster_path text default null,
  p_backdrop_path text default null,
  p_season_number smallint default null,
  p_episode_number smallint default null
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
    poster_path, backdrop_path, season_number, episode_number, status
  )
  values (
    upper(btrim(p_code)), auth.uid(), p_media_type, p_tmdb_id, btrim(p_title),
    p_poster_path, p_backdrop_path, p_season_number, p_episode_number, 'lobby'
  )
  returning * into v_room;

  insert into public.watch_room_members (room_id, user_id, nickname, role)
  values (v_room.id, auth.uid(), btrim(p_nickname), 'host');

  return v_room;
end;
$$;

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

  -- Idempotent reconnect: an existing member just gets the room back.
  if exists (
    select 1 from public.watch_room_members
    where room_id = v_room.id and user_id = auth.uid()
  ) then
    return v_room;
  end if;

  select count(*) into v_member_count
  from public.watch_room_members
  where room_id = v_room.id;

  if v_member_count >= 2 then
    raise exception 'room is full' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.watch_room_members
    where room_id = v_room.id and lower(nickname) = lower(btrim(p_nickname))
  ) then
    raise exception 'nickname already taken in this room' using errcode = 'P0001';
  end if;

  insert into public.watch_room_members (room_id, user_id, nickname, role)
  values (v_room.id, auth.uid(), btrim(p_nickname), 'guest');

  return v_room;
end;
$$;

create or replace function public.end_watch_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.watch_rooms
  set status = 'ended',
      updated_at = timezone('utc', now())
  where id = p_room_id
    and host_user_id = auth.uid();
end;
$$;

revoke all on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint) from public;
revoke all on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint) from anon;
grant execute on function public.create_watch_room(text, public.media_type, integer, text, text, text, text, smallint, smallint) to authenticated;

revoke all on function public.join_watch_room(text, text) from public;
revoke all on function public.join_watch_room(text, text) from anon;
grant execute on function public.join_watch_room(text, text) to authenticated;

revoke all on function public.end_watch_room(uuid) from public;
revoke all on function public.end_watch_room(uuid) from anon;
grant execute on function public.end_watch_room(uuid) to authenticated;

-- ── Storage: private bucket for polaroid images, uploaded under {room_id}/… ──
insert into storage.buckets (id, name, public)
values ('watch-memories', 'watch-memories', false)
on conflict (id) do nothing;

drop policy if exists "watch_memories_member_read" on storage.objects;
create policy "watch_memories_member_read"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'watch-memories' and public.is_watch_room_member((storage.foldername(name))[1]));

drop policy if exists "watch_memories_member_write" on storage.objects;
create policy "watch_memories_member_write"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'watch-memories' and public.is_watch_room_member((storage.foldername(name))[1]));
