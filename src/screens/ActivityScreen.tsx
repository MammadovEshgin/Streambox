import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Image, ListRenderItemInfo, Pressable } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { getFollowingActivity } from "../api/social";
import { getTmdbImageUrl } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { getCachedActivity, setCachedActivity } from "../services/socialFeedCache";
import { SocialAvatar } from "../components/social/SocialAvatar";
import { formatRelativeTime } from "../components/social/socialTime";
import {
  activityFeedCursor,
  groupActivityFeed,
  mergeActivityPages,
  type ActivityEventType,
  type ActivityFeedRow,
  type ActivityItem,
} from "../utils/activityFeed";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "ActivityFeed">;

const PAGE_SIZE = 50;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px 8px;
`;

const BackButton = styled.Pressable`
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`;

const ScreenTitle = styled.Text`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const RowRoot = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
`;

const RowBody = styled.Pressable`
  flex: 1;
  margin: 0 12px;
`;

const RowText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  line-height: 19px;
`;

const Strong = styled.Text`
  font-weight: 700;
`;

const RowTime = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
`;

const Poster = styled.Pressable`
  width: 42px;
  height: 63px;
  border-radius: 6px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 60px 32px;
`;

const EmptyTitle = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 17px;
  font-weight: 700;
  text-align: center;
`;

const EmptyBody = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
  text-align: center;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

function eventVerb(t: (key: string, opts?: Record<string, unknown>) => string, type: ActivityEventType): string {
  if (type === "liked") return t("social.activityLiked");
  if (type === "watchlisted") return t("social.activityWatchlisted");
  return t("social.activityWatched");
}

function groupVerb(t: (key: string, opts?: Record<string, unknown>) => string, type: ActivityEventType, count: number): string {
  if (type === "liked") return t("social.activityGroupLiked", { count });
  if (type === "watchlisted") return t("social.activityGroupWatchlisted", { count });
  return t("social.activityGroupWatched", { count });
}

export function ActivityScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const currentTheme = useTheme();
  const isFocused = useIsFocused();
  // Render the cached first page instantly (warmed from ProfileScreen); the
  // initial load below reconciles in the background. Spinner only on a truly
  // cold session.
  const [items, setItems] = useState<ActivityItem[]>(() => getCachedActivity() ?? []);
  const [loading, setLoading] = useState(() => getCachedActivity() === null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const reachedEnd = useRef(false);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    try {
      const rows = await getFollowingActivity({ limit: PAGE_SIZE });
      reachedEnd.current = rows.length < PAGE_SIZE;
      setItems(rows);
      setCachedActivity(rows);
    } catch {
      // keep current
    } finally {
      if (mode === "refresh") setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load("refresh");
  }, [load]);

  const handleEndReached = useCallback(async () => {
    if (reachedEnd.current || loadingMore || items.length === 0) return;
    const cursor = activityFeedCursor(items);
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await getFollowingActivity({
        before: cursor.before,
        beforeId: cursor.beforeId,
        limit: PAGE_SIZE,
      });
      reachedEnd.current = next.length < PAGE_SIZE;
      setItems((current) => mergeActivityPages(current, next));
    } catch {
      // ignore; user can pull to refresh
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  const rows = useMemo(() => groupActivityFeed(items), [items]);

  const openMedia = useCallback(
    (mediaType: "movie" | "tv", tmdbId: number) => {
      if (mediaType === "movie") navigation.navigate("MovieDetail", { movieId: String(tmdbId) });
      else navigation.navigate("SeriesDetail", { seriesId: String(tmdbId) });
    },
    [navigation]
  );

  const openProfile = useCallback(
    (userId: string) => navigation.navigate("UserProfile", { userId }),
    [navigation]
  );

  const renderRow = useCallback(
    ({ item: row }: ListRenderItemInfo<ActivityFeedRow>) => {
      const name = row.kind === "single" ? row.item.displayName : row.displayName;
      const actorId = row.kind === "single" ? row.item.actorId : row.actorId;
      const avatarPath = row.kind === "single" ? row.item.avatarPath : row.avatarPath;
      const avatarVersion = row.kind === "single" ? row.item.avatarVersion : row.avatarVersion;
      const createdAt = row.kind === "single" ? row.item.createdAt : row.latestCreatedAt;

      return (
        <RowRoot>
          <Pressable onPress={() => openProfile(actorId)}>
            <SocialAvatar avatarPath={avatarPath} avatarVersion={avatarVersion} displayName={name} size={44} />
          </Pressable>
          <RowBody onPress={() => openProfile(actorId)}>
            {row.kind === "single" ? (
              <RowText numberOfLines={2}>
                <Strong>{name}</Strong> {eventVerb(t, row.item.eventType)} <Strong>{row.item.title}</Strong>
              </RowText>
            ) : (
              <RowText numberOfLines={2}>
                <Strong>{name}</Strong> {groupVerb(t, row.eventType, row.count)}
              </RowText>
            )}
            <RowTime>{formatRelativeTime(createdAt, t)}</RowTime>
          </RowBody>
          {row.kind === "single" && (
            <Poster onPress={() => openMedia(row.item.mediaType, row.item.tmdbId)}>
              {row.item.posterPath ? (
                <Image
                  source={{ uri: getTmdbImageUrl(row.item.posterPath, "w185") ?? undefined }}
                  style={{ width: 42, height: 63 }}
                  resizeMode="cover"
                />
              ) : null}
            </Poster>
          )}
        </RowRoot>
      );
    },
    [openMedia, openProfile, t]
  );

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{t("social.activityTitle")}</ScreenTitle>
      </HeaderRow>

      {loading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : rows.length === 0 ? (
        <EmptyWrap>
          <Feather name="users" size={34} color={currentTheme.colors.textSecondary} />
          <EmptyTitle>{t("social.activityEmptyTitle")}</EmptyTitle>
          <EmptyBody>{t("social.activityEmptyBody")}</EmptyBody>
        </EmptyWrap>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
        />
      )}
    </SafeContainer>
  );
}
