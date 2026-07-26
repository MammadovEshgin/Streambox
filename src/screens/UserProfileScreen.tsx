import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  followUser,
  getPublicProfile,
  getUserPublicList,
  resolveProfileAssetUrl,
  unfollowUser,
  type PublicListItem,
  type PublicListKind,
  type PublicProfile,
} from "../api/social";
import { getTmdbImageUrl } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { SocialAvatar } from "../components/social/SocialAvatar";
import type { HomeStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "UserProfile">;

const HeaderBar = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  padding: 8px 12px;
`;

const CircleButton = styled.Pressable`
  width: 38px;
  height: 38px;
  border-radius: 19px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.5);
`;

const Banner = styled.View`
  width: 100%;
  height: 150px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const AvatarWrap = styled.View`
  margin-top: -36px;
  padding-left: 16px;
`;

const Identity = styled.View`
  padding: 8px 16px 0;
`;

const DisplayName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.4px;
`;

const Handle = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const Bio = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  line-height: 20px;
`;

const StatsRow = styled.View`
  flex-direction: row;
  gap: 22px;
  margin-top: 14px;
  padding: 0 16px;
`;

const StatPill = styled.Pressable`
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
`;

const StatValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
`;

const StatLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const FollowButton = styled.Pressable<{ $following: boolean }>`
  margin: 16px 16px 4px;
  min-height: 44px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $following, theme }) => ($following ? theme.colors.border : theme.colors.primary)};
  background-color: ${({ $following, theme }) => ($following ? "transparent" : theme.colors.primary)};
`;

const FollowLabel = styled.Text<{ $following: boolean }>`
  color: ${({ $following, theme }) => ($following ? theme.colors.textPrimary : theme.colors.textOnPrimary)};
  font-size: 14px;
  font-weight: 700;
`;

const Rail = styled.View`
  margin-top: 22px;
`;

const RailHeader = styled.View`
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 16px 10px;
`;

const RailTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
`;

const RailCount = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const RailSeeAll = styled.Pressable``;

const RailSeeAllText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 600;
`;

const PosterCard = styled.Pressable`
  width: 96px;
  margin-right: 10px;
`;

const PosterFrame = styled.View`
  width: 96px;
  height: 144px;
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const RailEmpty = styled.Text`
  padding: 0 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
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

export function UserProfileScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const { t } = useTranslation();
  const currentTheme = useTheme();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [lists, setLists] = useState<Lists>({ watched: [], watchlist: [], liked: [] });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const [prof, watched, watchlist, liked] = await Promise.all([
          getPublicProfile(userId),
          getUserPublicList({ userId, list: "watched", limit: 24 }),
          getUserPublicList({ userId, list: "watchlist", limit: 24 }),
          getUserPublicList({ userId, list: "liked", limit: 24 }),
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

  const toggleFollow = useCallback(async () => {
    if (!profile || followBusy) return;
    const next = !profile.isFollowing;
    setFollowBusy(true);
    setProfile((current) =>
      current
        ? {
            ...current,
            isFollowing: next,
            counts: { ...current.counts, followers: current.counts.followers + (next ? 1 : -1) },
          }
        : current
    );
    try {
      if (next) await followUser(profile.userId);
      else await unfollowUser(profile.userId);
    } catch {
      setProfile((current) =>
        current
          ? {
              ...current,
              isFollowing: !next,
              counts: { ...current.counts, followers: current.counts.followers + (next ? -1 : 1) },
            }
          : current
      );
    } finally {
      setFollowBusy(false);
    }
  }, [followBusy, profile]);

  const openMedia = useCallback(
    (item: PublicListItem) => {
      if (item.mediaType === "movie") navigation.navigate("MovieDetail", { movieId: String(item.tmdbId) });
      else navigation.navigate("SeriesDetail", { seriesId: String(item.tmdbId) });
    },
    [navigation]
  );

  const renderRail = (
    titleKey: string,
    kind: PublicListKind,
    list: PublicListItem[],
    emptyKey: string,
    total: number
  ) => (
    <Rail>
      <RailHeader>
        <RailTitle>{t(titleKey)}</RailTitle>
        {total > list.length && profile ? (
          <RailSeeAll
            onPress={() =>
              navigation.navigate("UserPublicList", { userId: profile.userId, list: kind, title: t(titleKey) })
            }
          >
            <RailSeeAllText>{t("social.seeAll")}</RailSeeAllText>
          </RailSeeAll>
        ) : (
          <RailCount>{total}</RailCount>
        )}
      </RailHeader>
      {list.length === 0 ? (
        <RailEmpty>{t(emptyKey)}</RailEmpty>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {list.map((item) => (
            <PosterCard key={`${item.mediaType}-${item.tmdbId}`} onPress={() => openMedia(item)}>
              <PosterFrame>
                {item.posterPath ? (
                  <Image
                    source={{ uri: getTmdbImageUrl(item.posterPath, "w185") ?? undefined }}
                    style={{ width: 96, height: 144 }}
                    resizeMode="cover"
                  />
                ) : null}
              </PosterFrame>
            </PosterCard>
          ))}
        </ScrollView>
      )}
    </Rail>
  );

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
        <HeaderBar>
          <CircleButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </CircleButton>
        </HeaderBar>
        <ErrorWrap>
          <Feather name="user-x" size={34} color={currentTheme.colors.textSecondary} />
          <ErrorText>{t("social.profileLoadFailed")}</ErrorText>
        </ErrorWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <HeaderBar>
        <CircleButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </CircleButton>
      </HeaderBar>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <Banner>
          {bannerUri ? <Image source={{ uri: bannerUri }} style={{ width: "100%", height: 150 }} resizeMode="cover" /> : null}
        </Banner>
        <AvatarWrap>
          <SocialAvatar
            avatarPath={profile.avatarPath}
            avatarVersion={profile.avatarVersion}
            displayName={profile.displayName}
            size={72}
          />
        </AvatarWrap>

        <Identity>
          <DisplayName numberOfLines={1}>{profile.displayName}</DisplayName>
          {profile.username ? <Handle numberOfLines={1}>@{profile.username}</Handle> : null}
          {profile.bio ? <Bio numberOfLines={4}>{profile.bio}</Bio> : null}
        </Identity>

        <StatsRow>
          <StatPill onPress={() => navigation.navigate("FollowList", { userId: profile.userId, kind: "followers" })}>
            <StatValue>{profile.counts.followers}</StatValue>
            <StatLabel>{t("social.followers")}</StatLabel>
          </StatPill>
          <StatPill onPress={() => navigation.navigate("FollowList", { userId: profile.userId, kind: "following" })}>
            <StatValue>{profile.counts.following}</StatValue>
            <StatLabel>{t("social.followingLabel")}</StatLabel>
          </StatPill>
        </StatsRow>

        {!profile.isSelf && (
          <FollowButton $following={profile.isFollowing} onPress={toggleFollow} disabled={followBusy}>
            <FollowLabel $following={profile.isFollowing}>
              {profile.isFollowing ? t("social.following") : profile.followsMe ? t("social.followBack") : t("social.follow")}
            </FollowLabel>
          </FollowButton>
        )}

        {renderRail("profile.watched", "watched", lists.watched, "social.emptyWatched", profile.counts.watched)}
        {renderRail("profile.watchlist", "watchlist", lists.watchlist, "social.emptyWatchlist", profile.counts.watchlist)}
        {renderRail("profile.liked", "liked", lists.liked, "social.emptyLiked", profile.counts.liked)}
      </ScrollView>
    </SafeContainer>
  );
}
