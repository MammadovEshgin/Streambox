-- Follow-up to 20260728120000_db_audit_remediation.sql
--
-- Three items the first pass missed, all confirmed against the post-migration advisor run.
-- Same safety contract: no user rows touched, no columns changed, idempotent.

begin;

-- ---------------------------------------------------------------------------
-- P1-3 (remainder)  anon EXECUTE on the pre-internal_id compatibility overloads
-- ---------------------------------------------------------------------------
-- The first migration revoked anon on the internal_id-carrying overloads but not on the
-- 8-arg / 21-arg / 3-arg compatibility shims kept for the 1.0.2 and 1.1.0 fleets. Those
-- fleets authenticate, so dropping the anon grant affects no working caller. The
-- functions already raise 'not authenticated' when auth.uid() is null.
revoke execute on function public.sync_streambox_media_library_item(
  text, public.user_media_list_kind, public.media_type, bigint, text, timestamptz, jsonb, jsonb
) from anon;

revoke execute on function public.sync_streambox_watch_history_entry(
  public.media_type, bigint, text, text, text, text[], integer, integer, numeric, integer,
  bigint[], text[], text[], text[], bigint[], text[], text[], timestamptz, integer, jsonb, jsonb
) from anon;

revoke execute on function public.delete_streambox_watch_history_entry(
  public.media_type, bigint, jsonb
) from anon;

-- ---------------------------------------------------------------------------
-- P1-3 (remainder)  Pin search_path on the last function that lacks it
-- ---------------------------------------------------------------------------
-- make_streambox_entity_key is SECURITY INVOKER, so this is hardening rather than an
-- escalation fix, but it is the last function tripping function_search_path_mutable.
alter function public.make_streambox_entity_key(public.media_type, bigint, uuid)
  set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- P1-4 (remainder)  provider_configs still carried TRUNCATE for anon
-- ---------------------------------------------------------------------------
-- The app never reads this table directly — provider configuration is served by the
-- `provider-configs` edge function, which uses service_role and is unaffected by these
-- grants. SELECT is retained because the RLS policy (provider_configs_read, TO PUBLIC
-- USING true) implies read access is intended; only the non-read privileges go away.
revoke truncate, references, trigger on public.provider_configs from anon, authenticated;

commit;
