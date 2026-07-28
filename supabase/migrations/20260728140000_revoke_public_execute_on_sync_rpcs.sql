-- Closes the last three anon_security_definer_function_executable findings.
--
-- The previous two migrations used `revoke execute ... from anon`, which was a no-op:
-- anon never held a direct grant. It reaches these functions by inheriting the default
-- EXECUTE that Postgres grants to PUBLIC on every new function. The revoke has to target
-- PUBLIC itself.
--
-- Verified safe before writing: all seven functions below already carry an explicit
-- `authenticated=X/postgres` entry in proacl, so revoking PUBLIC leaves the app's real
-- caller untouched. service_role and postgres likewise hold explicit grants.
--
-- No user rows touched. Idempotent.

begin;

-- SECURITY DEFINER, internal_id-carrying (current fleets)
revoke execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb, uuid
) from public;

revoke execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb, uuid
) from public;

revoke execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb, uuid
) from public;

-- SECURITY INVOKER compatibility shims (1.0.2 / 1.1.0 fleets)
revoke execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb
) from public;

revoke execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb
) from public;

revoke execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb
) from public;

revoke execute on function public.sync_streambox_episode_progress(
  bigint, integer, integer, boolean, timestamptz, jsonb, jsonb
) from public;

-- Belt and braces: re-assert the grant the app actually relies on. Already present on all
-- seven, so this is a no-op today — it just means the file is correct standalone.
grant execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb, uuid
) to authenticated;

grant execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb, uuid
) to authenticated;

grant execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb, uuid
) to authenticated;

grant execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb
) to authenticated;

grant execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb
) to authenticated;

grant execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb
) to authenticated;

grant execute on function public.sync_streambox_episode_progress(
  bigint, integer, integer, boolean, timestamptz, jsonb, jsonb
) to authenticated;

commit;
