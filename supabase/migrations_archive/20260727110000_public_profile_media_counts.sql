-- ════════════════════════════════════════════════════════════════════════════
-- get_public_profile: per-media-type counts (on top of 20260725120000).
--
-- The peer-profile sections are split Movies / Series, but the profile only
-- returned COMBINED watched/watchlist/liked totals — so each section could not
-- show its true count without fetching (and hydrating) every row, which was slow
-- and still capped. Now the profile carries the movie/series breakdown too, so a
-- section header can render "200 movies" / "50 series" instantly and the rows can
-- load lazily as the user scrolls "See all".
--
-- Existing keys are unchanged (combined watched/watchlist/liked/followers/
-- following stay for the stats row); the six *Movies/*Series keys are additive.
-- Pure CREATE OR REPLACE (same signature).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'userId', p.id,
    'displayName', p.display_name,
    'username', p.username,
    'bio', p.bio,
    'location', p.location_text,
    'avatarPath', p.avatar_path,
    'bannerPath', p.banner_path,
    'avatarVersion', p.avatar_version,
    'bannerVersion', p.banner_version,
    'joinedAt', p.joined_at,
    'isSelf', p.id = auth.uid(),
    'isFollowing', exists (
      select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followee_id = p.id
    ),
    'followsMe', exists (
      select 1 from public.user_follows f where f.follower_id = p.id and f.followee_id = auth.uid()
    ),
    'counts', jsonb_build_object(
      'watched', (select count(*) from public.user_watch_history h where h.user_id = p.id),
      'watchedMovies', (select count(*) from public.user_watch_history h
                        where h.user_id = p.id and h.media_type = 'movie'),
      'watchedSeries', (select count(*) from public.user_watch_history h
                        where h.user_id = p.id and h.media_type = 'tv'),
      'watchlist', (select count(*) from public.user_media_library l
                    where l.user_id = p.id and l.list_kind = 'watchlist'),
      'watchlistMovies', (select count(*) from public.user_media_library l
                          where l.user_id = p.id and l.list_kind = 'watchlist' and l.media_type = 'movie'),
      'watchlistSeries', (select count(*) from public.user_media_library l
                          where l.user_id = p.id and l.list_kind = 'watchlist' and l.media_type = 'tv'),
      'liked', (select count(*) from public.user_media_library l
                where l.user_id = p.id and l.list_kind = 'liked'),
      'likedMovies', (select count(*) from public.user_media_library l
                      where l.user_id = p.id and l.list_kind = 'liked' and l.media_type = 'movie'),
      'likedSeries', (select count(*) from public.user_media_library l
                      where l.user_id = p.id and l.list_kind = 'liked' and l.media_type = 'tv'),
      'followers', (select count(*) from public.user_follows f where f.followee_id = p.id),
      'following', (select count(*) from public.user_follows f where f.follower_id = p.id)
    )
  )
  from public.user_profiles p
  where p.id = p_user_id;
$$;

revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_public_profile(uuid) from anon;
grant execute on function public.get_public_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
