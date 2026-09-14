-- Watch Together — "Shared Sessions" shelf hardening. Apply manually (never db push).
--
-- 1) Per-user memory removal. Deleting a card removes only YOU from the memory's
--    participants; the row and its Storage polaroid are purged only once nobody
--    is left, so one person deleting never erases their partner's copy.
-- 2) Durable image reads. A participant can always read their memory's polaroid
--    from Storage, even after the room row has expired and been cleaned up (at
--    which point is_watch_room_member() no longer matches). Without this, both
--    users eventually lose the ability to load a saved memory image.

-- ── Per-user removal RPC (SECURITY DEFINER: bypasses RLS to edit the shared row
--    and to clean up Storage on the last-one-out). ─────────────────────────────
create or replace function public.remove_watch_memory(p_memory_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining uuid[];
  v_image text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.watch_room_memories
  set participant_user_ids = array_remove(participant_user_ids, auth.uid())
  where id = p_memory_id
    and auth.uid() = any (participant_user_ids)
  returning participant_user_ids, image_path into v_remaining, v_image;

  -- Caller was not a participant (or the row is already gone): nothing to do.
  if not found then
    return;
  end if;

  -- Last participant out: hard-delete the row and its polaroid object.
  if coalesce(array_length(v_remaining, 1), 0) = 0 then
    delete from public.watch_room_memories where id = p_memory_id;
    delete from storage.objects
      where bucket_id = 'watch-memories' and name = v_image;
  end if;
end;
$$;

revoke all on function public.remove_watch_memory(uuid) from public;
revoke all on function public.remove_watch_memory(uuid) from anon;
grant execute on function public.remove_watch_memory(uuid) to authenticated;

-- ── Durable participant read of the polaroid image. RLS SELECT policies are
--    permissive (OR-combined), so this supplements the member-read policy and
--    keeps the image reachable for the life of the memory row. ────────────────
drop policy if exists "watch_memories_participant_read" on storage.objects;
create policy "watch_memories_participant_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'watch-memories'
    and exists (
      select 1
      from public.watch_room_memories m
      where m.image_path = storage.objects.name
        and auth.uid() = any (m.participant_user_ids)
    )
  );
