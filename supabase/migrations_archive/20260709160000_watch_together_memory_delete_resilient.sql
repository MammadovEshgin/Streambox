-- Watch Together — make memory deletion resilient. Apply manually (never db push).
--
-- remove_watch_memory() deletes the Storage polaroid when the last participant
-- removes a memory. If that Storage delete errors (permission/RLS on
-- storage.objects), the whole transaction was rolling back and the user's delete
-- failed with a generic error. Wrap the Storage cleanup in its own block so it is
-- best-effort and can never fail the memory removal itself.

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

  -- Last participant out: hard-delete the row; clean up its polaroid object as a
  -- best-effort step that must never abort the row deletion.
  if coalesce(array_length(v_remaining, 1), 0) = 0 then
    delete from public.watch_room_memories where id = p_memory_id;
    begin
      delete from storage.objects
        where bucket_id = 'watch-memories' and name = v_image;
    exception
      when others then
        null; -- ignore storage cleanup failures; the memory is already gone
    end;
  end if;
end;
$$;

revoke all on function public.remove_watch_memory(uuid) from public;
revoke all on function public.remove_watch_memory(uuid) from anon;
grant execute on function public.remove_watch_memory(uuid) to authenticated;

-- Nudge PostgREST to pick up the redefined function immediately.
notify pgrst, 'reload schema';
