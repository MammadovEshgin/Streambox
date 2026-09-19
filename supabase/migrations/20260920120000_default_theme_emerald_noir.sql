-- New accounts default to the green theme (emerald-noir), not orange (cinema-ember).
--
-- The client's default has been emerald-noir since 2026-06-30, but the signup
-- trigger and the settings RPC insert/fall back to cinema-ember, and the first
-- sign-in adopts the server's settings wholesale, so a fresh install turned
-- orange the moment a new account signed in. This was fixed once by
-- 20260630120000_default_theme_emerald_noir.sql and lost when the 2026-07-28
-- rebaseline moved that file to migrations_archive/ and re-emitted both
-- functions with the old literal.
--
-- Both bodies are copied verbatim from 20260101000000_baseline_schema.sql; only
-- the three theme literals change. Existing users' theme_id is left alone.

CREATE OR REPLACE FUNCTION public.handle_streambox_user_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_streambox_profile_and_settings(profile_payload jsonb DEFAULT '{}'::jsonb, settings_payload jsonb DEFAULT '{}'::jsonb, audit_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  current_settings public.user_settings%rowtype;
  normalized_profile jsonb := coalesce(profile_payload, '{}'::jsonb);
  normalized_settings jsonb := coalesce(settings_payload, '{}'::jsonb);
  normalized_audit_metadata jsonb := coalesce(audit_metadata, '{}'::jsonb);
  next_display_name text;
  next_bio text;
  next_location text;
  next_birthday date;
  next_joined_at timestamptz;
  next_avatar_path text;
  next_banner_path text;
  next_avatar_version integer;
  next_banner_version integer;
  next_theme_id text;
  next_onboarding_completed_at timestamptz;
  next_preferences jsonb;
  changed_profile_fields text[] := '{}'::text[];
  changed_asset_fields text[] := '{}'::text[];
begin
  if current_user_id is null then
    raise exception 'not authenticated';
  end if;

  if jsonb_typeof(normalized_profile) <> 'object' then
    raise exception 'profile_payload must be a json object';
  end if;

  if jsonb_typeof(normalized_settings) <> 'object' then
    raise exception 'settings_payload must be a json object';
  end if;

  if jsonb_typeof(normalized_audit_metadata) <> 'object' then
    raise exception 'audit_metadata must be a json object';
  end if;

  insert into public.user_profiles (id, display_name, joined_at)
  values (current_user_id, 'My Profile', timezone('utc', now()))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id, theme_id)
  values (current_user_id, 'emerald-noir')
  on conflict (user_id) do nothing;

  select *
  into current_profile
  from public.user_profiles
  where id = current_user_id;

  select *
  into current_settings
  from public.user_settings
  where user_id = current_user_id;

  next_display_name := coalesce(
    case when normalized_profile ? 'displayName' then nullif(btrim(normalized_profile ->> 'displayName'), '') end,
    current_profile.display_name,
    'My Profile'
  );
  next_bio := coalesce(case when normalized_profile ? 'bio' then normalized_profile ->> 'bio' end, current_profile.bio, '');
  next_location := coalesce(
    case when normalized_profile ? 'location' then normalized_profile ->> 'location' end,
    current_profile.location_text,
    ''
  );
  next_birthday := case
    when normalized_profile ? 'birthday' then nullif(normalized_profile ->> 'birthday', '')::date
    else current_profile.birthday
  end;
  next_joined_at := case
    when normalized_profile ? 'joinedAt' then coalesce((normalized_profile ->> 'joinedAt')::timestamptz, current_profile.joined_at)
    else current_profile.joined_at
  end;
  next_avatar_path := case
    when normalized_profile ? 'avatarPath' then nullif(normalized_profile ->> 'avatarPath', '')
    else current_profile.avatar_path
  end;
  next_banner_path := case
    when normalized_profile ? 'bannerPath' then nullif(normalized_profile ->> 'bannerPath', '')
    else current_profile.banner_path
  end;
  next_avatar_version := case
    when normalized_profile ? 'avatarVersion' then greatest(coalesce((normalized_profile ->> 'avatarVersion')::integer, 0), 0)
    else current_profile.avatar_version
  end;
  next_banner_version := case
    when normalized_profile ? 'bannerVersion' then greatest(coalesce((normalized_profile ->> 'bannerVersion')::integer, 0), 0)
    else current_profile.banner_version
  end;
  next_theme_id := coalesce(
    case when normalized_settings ? 'themeId' then nullif(btrim(normalized_settings ->> 'themeId'), '') end,
    current_settings.theme_id,
    'emerald-noir'
  );
  next_onboarding_completed_at := case
    when normalized_settings ? 'onboardingCompletedAt' then nullif(normalized_settings ->> 'onboardingCompletedAt', '')::timestamptz
    else current_settings.onboarding_completed_at
  end;
  next_preferences := case
    when normalized_settings ? 'preferences' then normalized_settings -> 'preferences'
    else current_settings.preferences
  end;

  if next_preferences is null then
    next_preferences := '{}'::jsonb;
  end if;

  if jsonb_typeof(next_preferences) <> 'object' then
    raise exception 'settings preferences must be a json object';
  end if;

  if current_profile.display_name is distinct from next_display_name then
    changed_profile_fields := array_append(changed_profile_fields, 'displayName');
  end if;

  if current_profile.bio is distinct from next_bio then
    changed_profile_fields := array_append(changed_profile_fields, 'bio');
  end if;

  if current_profile.location_text is distinct from next_location then
    changed_profile_fields := array_append(changed_profile_fields, 'location');
  end if;

  if current_profile.birthday is distinct from next_birthday then
    changed_profile_fields := array_append(changed_profile_fields, 'birthday');
  end if;

  if current_profile.joined_at is distinct from next_joined_at then
    changed_profile_fields := array_append(changed_profile_fields, 'joinedAt');
  end if;

  if current_profile.avatar_path is distinct from next_avatar_path then
    changed_asset_fields := array_append(changed_asset_fields, 'avatarPath');
  end if;

  if current_profile.banner_path is distinct from next_banner_path then
    changed_asset_fields := array_append(changed_asset_fields, 'bannerPath');
  end if;

  if current_profile.avatar_version is distinct from next_avatar_version then
    changed_asset_fields := array_append(changed_asset_fields, 'avatarVersion');
  end if;

  if current_profile.banner_version is distinct from next_banner_version then
    changed_asset_fields := array_append(changed_asset_fields, 'bannerVersion');
  end if;

  update public.user_profiles
  set
    display_name = next_display_name,
    bio = next_bio,
    location_text = next_location,
    birthday = next_birthday,
    joined_at = coalesce(next_joined_at, current_profile.joined_at),
    avatar_path = next_avatar_path,
    banner_path = next_banner_path,
    avatar_version = next_avatar_version,
    banner_version = next_banner_version
  where id = current_user_id;

  update public.user_settings
  set
    theme_id = next_theme_id,
    onboarding_completed_at = next_onboarding_completed_at,
    preferences = next_preferences
  where user_id = current_user_id;

  if coalesce(array_length(changed_profile_fields, 1), 0) > 0 then
    perform public.log_streambox_user_event(
      'profile',
      'profile_updated',
      'profile',
      current_user_id::text,
      normalized_audit_metadata || jsonb_build_object('changedFields', to_jsonb(changed_profile_fields))
    );
  end if;

  if current_settings.theme_id is distinct from next_theme_id then
    perform public.log_streambox_user_event(
      'settings',
      'theme_changed',
      'settings',
      'theme',
      normalized_audit_metadata || jsonb_build_object('themeId', next_theme_id)
    );
  end if;

  if coalesce(array_length(changed_asset_fields, 1), 0) > 0 then
    perform public.log_streambox_user_event(
      'asset',
      'profile_assets_updated',
      'profile_assets',
      current_user_id::text,
      normalized_audit_metadata || jsonb_build_object('changedFields', to_jsonb(changed_asset_fields))
    );
  end if;
end;
$function$
;
