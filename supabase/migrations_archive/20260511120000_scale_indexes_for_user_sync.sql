-- Extra indexes for larger user-data sync workloads.
-- These are intentionally idempotent so they are safe on existing projects.

create index if not exists user_media_library_user_list_updated_idx
  on public.user_media_library (user_id, list_kind, updated_at desc);

create index if not exists user_media_library_user_internal_lookup_idx
  on public.user_media_library (user_id, list_kind, media_type, internal_id)
  where internal_id is not null;

create index if not exists user_watch_history_user_internal_lookup_idx
  on public.user_watch_history (user_id, media_type, internal_id)
  where internal_id is not null;

create index if not exists user_watch_history_user_updated_idx
  on public.user_watch_history (user_id, updated_at desc);

create index if not exists user_daily_recommendations_user_updated_idx
  on public.user_daily_recommendations (user_id, updated_at desc);

create index if not exists user_audit_logs_user_action_occurred_idx
  on public.user_audit_logs (user_id, action_type, occurred_at desc);

do $$
begin
  if to_regclass('public.franchise_entries') is not null then
    execute 'create index if not exists franchise_entries_franchise_order_idx
      on public.franchise_entries (franchise_id, watch_order)';
  end if;

  if to_regclass('public.user_franchise_progress') is not null then
    execute 'create index if not exists user_franchise_progress_user_entry_idx
      on public.user_franchise_progress (user_id, entry_id)';
    execute 'create index if not exists user_franchise_progress_entry_idx
      on public.user_franchise_progress (entry_id)';
  end if;
end $$;
