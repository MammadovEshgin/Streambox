import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, type ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  followUser,
  getPublicProfile,
  getUserPublicList,
  resolveProfileAssetUrl,
  SocialRpcError,
  unfollowUser,
  type PublicListItem,
  type PublicListKind,
  type PublicProfile,
} from "../api/social";
import type { MediaItem } from "../api/tmdb";
import { MediaCard } from "../components/home/MediaCard";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { SocialAvatar } from "../components/social/SocialAvatar";
import { formatLocalizedDate } from "../localization/format";
import i18n from "../localization/i18n";
import { normalizeAppLanguage } from "../localization/types";
import {
  getHydratedMediaItemsFromCache,
  getSharedHydratedMediaCache,
  hydrateMediaIds,
} from "../services/mediaHydration";
import {
  optimisticFollowState,
  rollbackFollowState,
  splitHydratableIds,
} from "../utils/socialProfile";
import { formatHandle } from "../utils/usernames";
import type { HomeStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "UserProfile">;

// â”€â”€ Layout constants (mirrors ProfileScreen) â”€â”€
const BANNER_HEIGHT = 160;
const AVATAR_SIZE = 80;
const AVATAR_OVERLAP = AVATAR_SIZE / 2;
// The server caps a page at 100. One page covers the vast majority of profiles
// in full; anything beyond is reachable via each section's "See all".
const LIST_FETCH_LIMIT = 100;

// â”€â”€ Styled components (kept visually identical to the signed-in ProfileScreen) â”€â”€
const Content = styled.ScrollView.attrs({
  showsVerticalScrollIndicator: false,
})`
  flex: 1;
`;

const Header = styled.View`
  padding-bottom: 12px;
`;

const BannerWrap = styled.View`
  height: ${BANNER_HEIGHT}px;
  background-color: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
`;

const BannerImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const BannerPlaceholder = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const BackButton = styled.Pressable`
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 10;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background-color: rgba(0, 0, 0, 0.5);
`;

const AvatarArea = styled.View`
  margin-top: -${AVATAR_OVERLAP}px;
  padding-horizontal: 16px;
  flex-direction: row;
  align-items: flex-start;
`;

const AvatarCircle = styled.View`
  width: ${AVATAR_SIZE}px;
  height: ${AVATAR_SIZE}px;
  border-radius: ${AVATAR_SIZE / 2}px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.background};
  border-width: 3px;
  border-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const ProfileInfo = styled.View`
  padding-horizontal: 16px;
  margin-top: 10px;
`;

const ProfileTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  letter-spacing: -0.5px;
  margin-top: 4px;
`;

const ProfileHandle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 13px;
  margin-top: 2px;
`;

const ProfileBio = styled.Text`
  margin-top: 8px;
  color: #ffffff;
  font-family: Outfit_400Regular;
  font-size: 15px;
  line-height: 22px;
`;

const MetaStack = styled.View`
  align-items: flex-start;
  margin-top: 16px;
  gap: 8px;
`;

const MetaItem = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding-vertical: 2px;
`;

const MetaText = styled.Text`
  color: rgba(255, 255, 255, 0.7);
  font-family: Outfit_500Medium;
  font-size: 14px;
`;

const StatsRow = styled.View`
  flex-direction: row;
  justify-content: flex-start;
  gap: 20px;
  margin-top: 20px;
  padding-bottom: 20px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const StatItem = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const StatNumber = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

const StatLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
`;

const FollowStatButton = styled.Pressable`
  align-items: center;
  justify-content: center;
  padding-vertical: 1px;
`;

const FollowButton = styled.Pressable<{ $following: boolean }>`
  margin: 16px 16px 0;
  min-height: 44px;
  border-radius: 5px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $following, theme }) => ($following ? theme.colors.border : theme.colors.primary)};
  background-color: ${({ $following, theme }) => ($following ? "transparent" : theme.colors.primary)};
`;

const FollowLabel = styled.Text<{ $following: boolean }>`
  color: ${({ $following, theme }) => ($following ? theme.colors.textPrimary : theme.colors.textOnPrimary)};
  font-family: Outfit_700Bold;
  font-size: 14px;
`;

const SectionWrap = styled.View`
  margin-top: 30px;
  padding-horizontal: 16px;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  align-items: baseline;
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const SectionDot = styled.View`
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.primary};
  margin-horizontal: 8px;
  margin-bottom: 3px;
`;

const SectionMeta = styled.Text`
  color: rgba(255, 255, 255, 0.3);
  font-family: Outfit_500Medium;
  font-size: 13px;
`;

const SeeAllButton = styled.Pressable`
  margin-left: auto;
  padding: 2px 0;
`;

const SeeAllText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 13px;
`;

const ToggleRow = styled.View`
  flex-direction: row;
  gap: 6px;
  margin-bottom: 14px;
`;

const ToggleChip = styled.Pressable<{ $active: boolean }>`
  padding: 6px 14px;
  border-radius: 5px;
  background-color: ${({ $active, theme }) => ($active ? `${theme.colors.primary}15` : "rgba(255,255,255,0.04)")};
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? `${theme.colors.primary}30` : "transparent")};
`;

const ToggleLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : "rgba(255,255,255,0.35)")};
  font-family: Outfit_600SemiBold;
  font-size: 12px;
  letter-spacing: 0.2px;
`;

const RailWrap = styled.View`
  height: 282px;
`;

const RailCardWrap = styled.View`
  margin-right: 12px;
`;

const EmptySection = styled.View`
  height: 140px;
  border-radius: 5px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.06);
  background-color: rgba(255, 255, 255, 0.02);
  align-items: center;
  justify-content: center;
`;

const EmptyIcon = styled.View`
  margin-bottom: 8px;
  opacity: 0.3;
`;

const EmptyText = styled.Text`
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
`;

const BottomSpacer = styled.View`
  height: 40px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const ErrorWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 40px;
`;

const ErrorText = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  text-align: center;
`;

type Lists = Record<PublicListKind, PublicListItem[]>;
type MediaFilter = "movie" | "tv";

function formatJoinedDate(iso: string): string {
  if (!iso) return "";
  try {
    return i18n.t("profile.joinedOn", {
      date: formatLocalizedDate(new Date(iso), { day: "numeric", month: "long", year: "numeric" }),
    });
  } catch {
    return "";
  }
}

export function UserProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const { t, i18n: translationI18n } = useTranslation();
  const currentTheme = useTheme();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [lists, setLists] = useState<Lists>({ watched: [], watchlist: [], liked: [] });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [watchedFilter, setWatchedFilter] = useState<MediaFilter>("movie");
  const [watchlistFilter, setWatchlistFilter] = useState<MediaFilter>("movie");
  const [likedFilter, setLikedFilter] = useState<MediaFilter>("movie");

  // Posters are hydrated by tmdbId (the public-list snapshot often has no poster
  // for Letterboxd-imported / backfilled / detail-less rows) exactly like the
  // signed-in profile does, so a peer's lists never render as blank cards.
  const cacheRef = useRef(getSharedHydratedMediaCache());
  const [hydrationTick, setHydrationTick] = useState(0);
  const resolvedContentLanguage = useMemo(
    () => normalizeAppLanguage(translationI18n.resolvedLanguage ?? translationI18n.language),
    [translationI18n.language, translationI18n.resolvedLanguage]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [prof, watched, watchlist, liked] = await Promise.all([
          getPublicProfile(userId),
          getUserPublicList({ userId, list: "watched", limit: LIST_FETCH_LIMIT }),
          getUserPublicList({ userId, list: "watchlist", limit: LIST_FETCH_LIMIT }),
          getUserPublicList({ userId, list: "liked", limit: LIST_FETCH_LIMIT }),
        ]);
        if (cancelled) return;
        if (!prof) {
          setFailed(true);
          return;
        }
        setProfile(prof);
        setLists({ watched, watchlist, liked });
        if (prof.bannerPath) {
          void resolveProfileAssetUrl(prof.bannerPath, prof.bannerVersion).then((uri) => {
            if (!cancelled) setBannerUri(uri);
          });
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Warm the shared hydrated-media cache, then bump the tick so the memoised
  // rails re-read it. Only watchlist/liked are hydrated: watched rows already
  // carry a real poster_path + title from user_watch_history, so hydrating them
  // would just burn TMDB-proxy quota for no visible gain.
  useEffect(() => {
    const movieSet = new Set<number>();
    const seriesSet = new Set<number>();
    (["watchlist", "liked"] as const).forEach((kind) => {
      const { movieIds, seriesIds } = splitHydratableIds(lists[kind]);
      movieIds.forEach((id) => movieSet.add(id));
      seriesIds.forEach((id) => seriesSet.add(id));
    });
    if (movieSet.size === 0 && seriesSet.size === 0) return;

    let cancelled = false;
    void hydrateMediaIds([...movieSet], [...seriesSet], cacheRef.current)
      .then(() => {
        if (!cancelled) startTransition(() => setHydrationTick((tick) => tick + 1));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lists, resolvedContentLanguage]);

  const toggleFollow = useCallback(async () => {
    if (!profile || followBusy) return;
    const next = !profile.isFollowing;
    setFollowBusy(true);
    setProfile((current) => (current ? optimisticFollowState(current, next) : current));
    try {
      if (next) await followUser(profile.userId);
      else await unfollowUser(profile.userId);
    } catch (error) {
      // Roll the optimistic update back and tell the user why — a silent revert
      // (count flicks to 1 then back to 0) is worse than an explicit reason.
      setProfile((current) => (current ? rollbackFollowState(current, next) : current));
      const hint = error instanceof SocialRpcError ? error.hint : null;
      Alert.alert(
        t("social.followErrorTitle"),
        hint === "rate_limited" ? t("social.followRateLimited") : t("social.followFailed")
      );
    } finally {
      setFollowBusy(false);
    }
  }, [followBusy, profile, t]);

  const openMedia = useCallback(
    (item: MediaItem) => {
      if (item.mediaType === "movie") navigation.navigate("MovieDetail", { movieId: String(item.id) });
      else navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
    },
    [navigation]
  );

  const renderCard = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => (
      <RailCardWrap>
        <MediaCard item={item} onPress={() => openMedia(item)} />
      </RailCardWrap>
    ),
    [openMedia]
  );
  const keyExtractor = useCallback((item: MediaItem) => `${item.mediaType}-${item.id}`, []);

  // Look up whatever posters/titles have hydrated so far, keyed by media id.
  // Rebuilt as the cache warms (`hydrationTick`) or the language changes.
  const hydratedById = useMemo(() => {
    const map = new Map<string, MediaItem>();
    (["watched", "watchlist", "liked"] as const).forEach((kind) => {
      const { movieIds, seriesIds } = splitHydratableIds(lists[kind]);
      for (const media of getHydratedMediaItemsFromCache(movieIds, seriesIds, cacheRef.current)) {
        map.set(`${media.mediaType}-${media.id}`, media);
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, hydrationTick, resolvedContentLanguage]);

  // Every fetched row becomes a card (never hidden behind hydration), so a
  // section's count matches what's shown and the whole list is visible. Watched
  // rows carry a real poster_path so they paint instantly; watchlist/liked rows
  // usually have an empty snapshot, so their poster/title fill in from `hydratedById`
  // as TMDB resolves. tmdb-id-less rows can't be opened/hydrated, so they're dropped.
  const buildRail = useCallback(
    (kind: PublicListKind, filter: MediaFilter): MediaItem[] =>
      lists[kind]
        .filter(
          (row) =>
            row.mediaType === (filter === "movie" ? "movie" : "tv") &&
            Number.isFinite(row.tmdbId) &&
            row.tmdbId > 0
        )
        .map((row) => {
          const hydrated = hydratedById.get(`${row.mediaType}-${row.tmdbId}`);
          return {
            id: row.tmdbId,
            title: hydrated?.title ?? row.title ?? "",
            posterPath: hydrated?.posterPath ?? row.posterPath ?? null,
            backdropPath: hydrated?.backdropPath ?? null,
            rating: hydrated?.rating ?? 0,
            overview: hydrated?.overview ?? "",
            year: hydrated?.year ?? "",
            mediaType: row.mediaType,
            genreIds: hydrated?.genreIds,
          } satisfies MediaItem;
        }),
    [lists, hydratedById]
  );

  const sectionItems = useMemo(
    () => ({
      watched: buildRail("watched", watchedFilter),
      watchlist: buildRail("watchlist", watchlistFilter),
      liked: buildRail("liked", likedFilter),
    }),
    [buildRail, watchedFilter, watchlistFilter, likedFilter]
  );

  const mediaLabel = useCallback(
    (filter: MediaFilter) =>
      filter === "movie" ? t("common.movies").toLowerCase() : t("common.series").toLowerCase(),
    [t]
  );

  const renderSection = (
    kind: PublicListKind,
    titleKey: string,
    filter: MediaFilter,
    setFilter: (value: MediaFilter) => void,
    emptyIcon: keyof typeof Feather.glyphMap,
    emptyMovieKey: string,
    emptySeriesKey: string
  ) => {
    const items = sectionItems[kind];
    return (
      <SectionWrap>
        <SectionHeader>
          <SectionTitle>{t(titleKey)}</SectionTitle>
          <SectionDot />
          <SectionMeta>{t("profile.sectionCount", { count: items.length, label: mediaLabel(filter) })}</SectionMeta>
          {profile && (
            <SeeAllButton
              onPress={() =>
                navigation.navigate("UserPublicList", { userId: profile.userId, list: kind, title: t(titleKey) })
              }
            >
              <SeeAllText>{t("common.seeAll")}</SeeAllText>
            </SeeAllButton>
          )}
        </SectionHeader>
        <ToggleRow>
          <ToggleChip $active={filter === "movie"} onPress={() => setFilter("movie")}>
            <ToggleLabel $active={filter === "movie"}>{t("common.movies")}</ToggleLabel>
          </ToggleChip>
          <ToggleChip $active={filter === "tv"} onPress={() => setFilter("tv")}>
            <ToggleLabel $active={filter === "tv"}>{t("common.series")}</ToggleLabel>
          </ToggleChip>
        </ToggleRow>
        {items.length === 0 ? (
          <EmptySection>
            <EmptyIcon>
              <Feather name={emptyIcon} size={24} color={currentTheme.colors.textSecondary} />
            </EmptyIcon>
            <EmptyText>{filter === "movie" ? t(emptyMovieKey) : t(emptySeriesKey)}</EmptyText>
          </EmptySection>
        ) : (
          <RailWrap>
            <FlatList
              data={items}
              horizontal
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              windowSize={3}
              removeClippedSubviews
              keyExtractor={keyExtractor}
              renderItem={renderCard}
              showsHorizontalScrollIndicator={false}
            />
          </RailWrap>
        )}
      </SectionWrap>
    );
  };

  if (loading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  if (failed || !profile) {
    return (
      <SafeContainer>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </BackButton>
        <ErrorWrap>
          <Feather name="user-x" size={34} color={currentTheme.colors.textSecondary} />
          <ErrorText>{t("social.profileLoadFailed")}</ErrorText>
        </ErrorWrap>
      </SafeContainer>
    );
  }

  const joinedText = formatJoinedDate(profile.joinedAt);

  return (
    <SafeContainer>
      <Content>
        <Header>
          <BannerWrap>
            {bannerUri ? (
              <BannerImage source={{ uri: bannerUri }} resizeMode="cover" />
            ) : (
              <BannerPlaceholder>
                <Feather name="image" size={28} color={currentTheme.colors.textSecondary} />
              </BannerPlaceholder>
            )}
          </BannerWrap>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </BackButton>

          <AvatarArea>
            <AvatarCircle>
              <SocialAvatar
                avatarPath={profile.avatarPath}
                avatarVersion={profile.avatarVersion}
                displayName={profile.displayName}
                size={AVATAR_SIZE - 6}
              />
            </AvatarCircle>
          </AvatarArea>

          <ProfileInfo>
            <ProfileTitle numberOfLines={1}>{profile.displayName}</ProfileTitle>
            {!!profile.username && <ProfileHandle numberOfLines={1}>{formatHandle(profile.username)}</ProfileHandle>}
            {!!profile.bio && <ProfileBio numberOfLines={4}>{profile.bio}</ProfileBio>}

            {(!!profile.location || !!joinedText) && (
              <MetaStack>
                {!!profile.location && (
                  <MetaItem>
                    <Feather name="map-pin" size={14} color={currentTheme.colors.primary} />
                    <MetaText>{profile.location}</MetaText>
                  </MetaItem>
                )}
                {!!joinedText && (
                  <MetaItem>
                    <Feather name="calendar" size={14} color={currentTheme.colors.primary} />
                    <MetaText>{joinedText}</MetaText>
                  </MetaItem>
                )}
              </MetaStack>
            )}

            <StatsRow>
              <StatItem>
                <StatNumber>{profile.counts.watched}</StatNumber>
                <StatLabel>{t("profile.watched")}</StatLabel>
              </StatItem>
              <StatItem>
                <StatNumber>{profile.counts.watchlist}</StatNumber>
                <StatLabel>{t("profile.watchlist")}</StatLabel>
              </StatItem>
              <StatItem>
                <StatNumber>{profile.counts.liked}</StatNumber>
                <StatLabel>{t("profile.liked")}</StatLabel>
              </StatItem>
              <FollowStatButton
                onPress={() => navigation.navigate("FollowList", { userId: profile.userId, kind: "followers" })}
                accessibilityRole="button"
                accessibilityLabel={`${t("social.followers")} · ${t("social.followingLabel")}`}
                hitSlop={8}
              >
                <Feather name="users" size={18} color={currentTheme.colors.textPrimary} />
              </FollowStatButton>
            </StatsRow>
          </ProfileInfo>

          {!profile.isSelf && (
            <FollowButton $following={profile.isFollowing} onPress={toggleFollow} disabled={followBusy}>
              <FollowLabel $following={profile.isFollowing}>
                {profile.isFollowing
                  ? t("social.following")
                  : profile.followsMe
                    ? t("social.followBack")
                    : t("social.follow")}
              </FollowLabel>
            </FollowButton>
          )}
        </Header>

        {renderSection(
          "watched",
          "profile.watched",
          watchedFilter,
          setWatchedFilter,
          "play-circle",
          "profile.noMoviesWatchedYet",
          "profile.noSeriesWatchedYet"
        )}
        {renderSection(
          "watchlist",
          "profile.watchlist",
          watchlistFilter,
          setWatchlistFilter,
          "bookmark",
          "profile.noMoviesInWatchlist",
          "profile.noSeriesInWatchlist"
        )}
        {renderSection(
          "liked",
          "profile.liked",
          likedFilter,
          setLikedFilter,
          "heart",
          "profile.noMoviesLikedYet",
          "profile.noSeriesLikedYet"
        )}

        <BottomSpacer />
      </Content>
    </SafeContainer>
  );
}
