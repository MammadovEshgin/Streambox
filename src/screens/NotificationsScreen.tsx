import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, ListRenderItemInfo, Pressable } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  fetchNotifications,
  markNotificationsRead,
  type AppNotification,
} from "../api/social";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { SocialAvatar } from "../components/social/SocialAvatar";
import { formatRelativeTime } from "../components/social/socialTime";
import { registerForPushNotifications } from "../services/pushNotifications";
import { userInboxService } from "../services/userInboxService";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Notifications">;

const NOTIFICATIONS_POLL_MS = 60_000;

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

const MarkAllText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 600;
`;

const Row = styled.Pressable<{ $unread: boolean }>`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
  background-color: ${({ $unread, theme }) => ($unread ? theme.colors.primarySoftStrong : "transparent")};
`;

const RowBody = styled.View`
  flex: 1;
  margin-left: 12px;
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

function actorName(notification: AppNotification): string {
  const payload = notification.payload;
  const display = typeof payload.displayName === "string" ? payload.displayName : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  return display || (username ? `@${username}` : "Someone");
}

export function NotificationsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const currentTheme = useTheme();
  const isFocused = useIsFocused();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const seenIds = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const rows = await fetchNotifications({ limit: 50 });
      seenIds.current = new Set(rows.map((row) => row.id));
      setItems(rows);
    } catch {
      // keep whatever we already have
    } finally {
      setLoading(false);
    }
  }, []);

  // On open: load, mark everything read, request push permission (the sensible
  // moment — not at launch), and subscribe to live inserts.
  useEffect(() => {
    void load();
    void markNotificationsRead(null).catch(() => undefined);
    void registerForPushNotifications();

    const unsubscribe = userInboxService.addListener({
      onNotification: (notification) => {
        if (seenIds.current.has(notification.id)) return;
        seenIds.current.add(notification.id);
        setItems((current) => [notification, ...current]);
      },
    });
    return unsubscribe;
  }, [load]);

  // Polling floor while visible (free tier / dead socket).
  useEffect(() => {
    if (!isFocused) return;
    const timer = setInterval(() => void load(), NOTIFICATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [isFocused, load]);

  const handleMarkAll = useCallback(async () => {
    setItems((current) => current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
    await markNotificationsRead(null).catch(() => undefined);
  }, []);

  const handlePress = useCallback(
    (notification: AppNotification) => {
      if (notification.actorId) {
        navigation.navigate("UserProfile", { userId: notification.actorId });
      }
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AppNotification>) => {
      const name = actorName(item);
      const avatarPath = typeof item.payload.avatarPath === "string" ? item.payload.avatarPath : null;
      const avatarVersion = typeof item.payload.avatarVersion === "number" ? item.payload.avatarVersion : 0;
      const title = typeof item.payload.title === "string" ? item.payload.title : "";
      const body =
        item.type === "follow" ? t("social.notifFollow") : `${t("social.notifInvite")}${title ? ` ${title}` : ""}`;
      return (
        <Row $unread={!item.readAt} onPress={() => handlePress(item)}>
          <SocialAvatar avatarPath={avatarPath} avatarVersion={avatarVersion} displayName={name} size={44} />
          <RowBody>
            <RowText numberOfLines={2}>
              <Strong>{name}</Strong> {body}
            </RowText>
            <RowTime>{formatRelativeTime(item.createdAt, t)}</RowTime>
          </RowBody>
        </Row>
      );
    },
    [handlePress, t]
  );

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{t("social.notificationsTitle")}</ScreenTitle>
        {items.length > 0 && (
          <Pressable onPress={handleMarkAll} hitSlop={8}>
            <MarkAllText>{t("social.markAllRead")}</MarkAllText>
          </Pressable>
        )}
      </HeaderRow>

      {loading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : items.length === 0 ? (
        <EmptyWrap>
          <Feather name="bell" size={32} color={currentTheme.colors.textSecondary} />
          <EmptyText>{t("social.notificationsEmpty")}</EmptyText>
        </EmptyWrap>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeContainer>
  );
}
