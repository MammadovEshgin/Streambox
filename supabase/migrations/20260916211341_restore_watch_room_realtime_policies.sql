-- Restore the Watch Together Realtime authorization policies to the replay path.
--
-- The app joins each room's channel with private:true (src/services/watchRoomService.ts)
-- and relies on two RLS policies on realtime.messages so that only room members can
-- receive or send on a `watch-room:<code>` topic. Production has them: they were applied
-- from migrations_archive/20260710190000_watch_together_hardening.sql in July 2026.
--
-- The 2026-07-28 baseline (20260101000000_baseline_schema.sql) was generated from the
-- public/private/storage catalogs only and never emitted the realtime schema, so a
-- database rebuilt from supabase/migrations/ came up with NO policy on the topic --
-- the anon key plus a six-character room code was enough to read chat and WebRTC
-- signals and inject playback control. This file closes that gap on every rebuild.
--
-- Idempotent: drop-if-exists + create, identical text to the archived migration. On
-- production it is a no-op re-creation of the same two policies. No user data is
-- touched. Reversible by dropping the two policies.
--
-- Depends on public.is_watch_room_member_by_code(text), defined in the baseline.

begin;

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

commit;
