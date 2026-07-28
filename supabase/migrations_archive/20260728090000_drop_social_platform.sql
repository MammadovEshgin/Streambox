-- ════════════════════════════════════════════════════════════════════════════
-- TEARDOWN: remove the runtime-1.3.0 social platform in full.
--
-- The follow graph, activity feed, in-app notifications, follow-gated Watch
-- Together invites, push tokens, public-profile/search read models, and the
-- username layer are all being dropped — no trace left. Everything reversed here
-- was introduced by 20260725120000 / 20260726090000 / 20260726100000 /
-- 20260727090000 / 20260727100000 / 20260727110000.
--
-- Deliberately PRESERVED (shared / pre-social core — must NOT be touched):
--   • public.media_type / public.user_media_list_kind enums
--   • public.consume_streambox_rate_limit(), public.set_updated_at()
--   • user_profiles / user_settings / user_media_library / user_watch_history /
--     user_episode_progress / user_audit_logs / user_daily_recommendations
--     (their rows and RLS are untouched — only the additive username columns go)
--   • the entire Watch Together core (watch_rooms / watch_room_members / the
--     synced-playback + memories platform) — only the follow-invite bridge goes
--
-- Everything uses IF EXISTS, so this is safe whether or not the social
-- migrations were ever applied, and is idempotent on re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Activity triggers on the CORE tables (must be dropped by name; they live
--       on user_watch_history / user_media_library, not on a social table) ────
drop trigger if exists streambox_activity_watch_history_ins on public.user_watch_history;
drop trigger if exists streambox_activity_watch_history_del on public.user_watch_history;
drop trigger if exists streambox_activity_media_library_ins on public.user_media_library;
drop trigger if exists streambox_activity_media_library_del on public.user_media_library;

-- ── 2. Social RPCs + trigger functions ─────────────────────────────────────
drop function if exists public.follow_user(uuid);
drop function if exists public.unfollow_user(uuid);
drop function if exists public.streambox_users_are_mutual(uuid, uuid);
drop function if exists public.get_follow_list(uuid, text, timestamptz, integer);
drop function if exists public.get_mutual_follows();
drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer);
drop function if exists public.get_user_public_list(uuid, text, public.media_type, timestamptz, integer, integer);
drop function if exists public.search_users(text);
drop function if exists public.get_following_activity(timestamptz, bigint, integer);
drop function if exists public.mark_notifications_read(bigint[]);
drop function if exists public.send_watch_invite(uuid, text, public.media_type, bigint, text, text, text, text, text);
drop function if exists public.respond_watch_invite(uuid, boolean);
drop function if exists public.cancel_watch_invite(uuid);
drop function if exists public.get_watch_invite(uuid);
drop function if exists public.register_push_token(text, text);
drop function if exists public.set_my_username(text);
drop function if exists public.streambox_generate_nickname(uuid);
drop function if exists public.streambox_generate_username(text);
drop function if exists public.streambox_username_is_reserved(text);
drop function if exists public.streambox_activity_from_watch_history();
drop function if exists public.streambox_activity_retract_watch_history();
drop function if exists public.streambox_activity_from_media_library();
drop function if exists public.streambox_activity_retract_media_library();

-- ── 3. Social tables (CASCADE drops their policies + indexes, and removes them
--       from the supabase_realtime publication automatically) ────────────────
drop table if exists public.user_follows cascade;
drop table if exists public.user_activity cascade;
drop table if exists public.user_notifications cascade;
drop table if exists public.watch_invites cascade;
drop table if exists public.user_push_tokens cascade;

-- ── 4. Peer avatar/banner storage read policy (added for public profiles) ────
drop policy if exists "profile_assets_peer_read" on storage.objects;

-- ── 5. Username layer on user_profiles ──────────────────────────────────────
-- display_name pattern index was added for search and is NOT tied to the
-- username column, so drop it explicitly; the username indexes + format
-- constraint fall with the column via CASCADE.
drop index if exists public.user_profiles_display_name_pattern_idx;
alter table public.user_profiles drop column if exists username_changed_at;
alter table public.user_profiles drop column if exists username cascade;

-- ── 6. Restore the signup trigger to its pre-social form (no username gen) ───
create or replace function public.handle_streambox_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_display_name text;
begin
  next_display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'My Profile');

  insert into public.user_profiles (id, display_name, joined_at)
  values (new.id, next_display_name, coalesce(new.created_at, timezone('utc', now())))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, theme_id)
  values (new.id, 'cinema-ember')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_streambox_user_created() from public;
revoke all on function public.handle_streambox_user_created() from anon;
revoke all on function public.handle_streambox_user_created() from authenticated;

notify pgrst, 'reload schema';
