-- New StreamBox accounts must default to the green "Emerald Noir" theme, not
-- the orange "Cinema Ember".
--
-- The signup trigger handle_streambox_user_created() seeded user_settings with
-- theme_id = 'cinema-ember'. That row then synced down to the client and
-- overrode the app's own green default, so every brand-new account opened in
-- orange. Replace the trigger function so new users start on 'emerald-noir'.
--
-- Scope: this only changes the default for brand-new rows. Existing users keep
-- whatever theme they have chosen. The 'cinema-ember' literals that remain in
-- sync_streambox_profile_and_settings are unreachable in practice
-- (user_settings.theme_id is NOT NULL and this trigger always creates the row
-- first, so the on-conflict insert and the coalesce fallback never apply
-- orange), so they are intentionally left untouched to avoid recreating that
-- large function.

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
  values (new.id, 'emerald-noir')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_streambox_user_created() from public;
revoke all on function public.handle_streambox_user_created() from anon;
revoke all on function public.handle_streambox_user_created() from authenticated;
