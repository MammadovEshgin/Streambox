import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  followUser,
  getCurrentUserId,
  getFollowList,
  unfollowUser,
  type FollowListEntry,
  type FollowListKind,
} from "../api/social";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { SocialAvatar } from "../components/social/SocialAvatar";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "FollowList">;

const PAGE_SIZE = 40;

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

const SegmentRow = styled.View`
  flex-direction: row;
  gap: 8px;
  padding: 4px 16px 12px;
`;

const SegmentChip = styled.Pressable<{ $active: boolean }>`
  padding: 8px 14px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised)};
`;

const SegmentLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-size: 13px;
  font-weight: 600;
`;

const Row = styled.Pressable`
  flex-direction: row;
  align-items: center;
  padding: 10px 16px;
`;

const RowBody = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const NameText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  font-weight: 600;
`;

const HandleText = styled.Text`
  margin-top: 1px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
`;

const FollowBtn = styled.Pressable<{ $following: boolean }>`
  padding: 7px 14px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ $following, theme }) => ($following ? theme.colors.border : theme.colors.primary)};
  background-color: ${({ $following, theme }) => ($following ? "transparent" : theme.colors.primary)};
`;

const FollowBtnLabel = styled.Text<{ $following: boolean }>`
  color: ${({ $following, theme }) => ($following ? theme.colors.textPrimary : theme.colors.textOnPrimary)};
  font-size: 12px;
  font-weight: 700;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 60px 32px;
`;

const EmptyText = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  text-align: center;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

export function FollowListScreen({ route, navigation }: Props) {
  const { userId, kind: initialKind } = route.params;
  const { t } = useTranslation();
  const currentTheme = useTheme();
  const [kind, setKind] = useState<FollowListKind>(initialKind);
  const [entries, setEntries] = useState<FollowListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [myId, setMyId] = useState<string | null>(null);
  const reachedEnd = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getCurrentUserId().then((id) => {
      if (!cancelled) setMyId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (targetKind: FollowListKind) => {
      setLoading(true);
      reachedEnd.current = false;
      try {
        const rows = await getFollowList({ userId, kind: targetKind, limit: PAGE_SIZE });
        reachedEnd.current = rows.length < PAGE_SIZE;
        setEntries(rows);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  const handleEndReached = useCallback(async () => {
    if (reachedEnd.current || loadingMore || entries.length === 0) return;
    setLoadingMore(true);
    try {
      const before = entries[entries.length - 1].createdAt;
      const next = await getFollowList({ userId, kind, before, limit: PAGE_SIZE });
      reachedEnd.current = next.length < PAGE_SIZE;
      setEntries((current) => [...current, ...next]);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [entries, kind, loadingMore, userId]);

  const toggleFollow = useCallback(
    async (entry: FollowListEntry) => {
      if (pending.has(entry.userId)) return;
      const nextFollowing = !entry.isFollowing;
      setPending((current) => new Set(current).add(entry.userId));
      setEntries((current) =>
        current.map((row) => (row.userId === entry.userId ? { ...row, isFollowing: nextFollowing } : row))
      );
      try {
        if (nextFollowing) await followUser(entry.userId);
        else await unfollowUser(entry.userId);
      } catch {
        // revert on failure
        setEntries((current) =>
          current.map((row) => (row.userId === entry.userId ? { ...row, isFollowing: entry.isFollowing } : row))
        );
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(entry.userId);
          return next;
        });
      }
    },
    [pending]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FollowListEntry>) => {
      const isSelf = myId != null && item.userId === myId;
      return (
        <Row onPress={() => navigation.navigate("UserProfile", { userId: item.userId })}>
          <SocialAvatar avatarPath={item.avatarPath} avatarVersion={item.avatarVersion} displayName={item.displayName} size={46} />
          <RowBody>
            <NameText numberOfLines={1}>{item.displayName}</NameText>
            {item.username ? <HandleText numberOfLines={1}>@{item.username}</HandleText> : null}
          </RowBody>
          {/* You can't follow yourself, so never show a follow control on your own row. */}
          {!isSelf && (
            <FollowBtn $following={item.isFollowing} onPress={() => toggleFollow(item)} disabled={pending.has(item.userId)}>
              <FollowBtnLabel $following={item.isFollowing}>
                {item.isFollowing
                  ? t("social.following")
                  : item.followsMe
                    ? t("social.followBack")
                    : t("social.follow")}
              </FollowBtnLabel>
            </FollowBtn>
          )}
        </Row>
      );
    },
    [myId, navigation, pending, t, toggleFollow]
  );

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{kind === "followers" ? t("social.followers") : t("social.followingLabel")}</ScreenTitle>
      </HeaderRow>

      <SegmentRow>
        <SegmentChip $active={kind === "followers"} onPress={() => setKind("followers")}>
          <SegmentLabel $active={kind === "followers"}>{t("social.followers")}</SegmentLabel>
        </SegmentChip>
        <SegmentChip $active={kind === "following"} onPress={() => setKind("following")}>
          <SegmentLabel $active={kind === "following"}>{t("social.followingLabel")}</SegmentLabel>
        </SegmentChip>
      </SegmentRow>

      {loading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : entries.length === 0 ? (
        <EmptyWrap>
          <Feather name="users" size={32} color={currentTheme.colors.textSecondary} />
          <EmptyText>
            {kind === "followers" ? t("social.followListEmptyFollowers") : t("social.followListEmptyFollowing")}
          </EmptyText>
        </EmptyWrap>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.userId}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
        />
      )}
    </SafeContainer>
  );
}
