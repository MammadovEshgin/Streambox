import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, FlatList, Image, ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { getUserPublicList, type PublicListItem } from "../api/social";
import { getTmdbImageUrl } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import type { HomeStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<HomeStackParamList, "UserPublicList">;

const PAGE_SIZE = 40;
const NUM_COLUMNS = 3;
const HORIZONTAL_PADDING = 16;
const GAP = 10;
const screenWidth = Dimensions.get("window").width;
const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const cardHeight = cardWidth * 1.5;

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

const GridWrap = styled.View`
  flex: 1;
  padding-horizontal: ${HORIZONTAL_PADDING}px;
`;

const CardRoot = styled.Pressable`
  width: ${cardWidth}px;
  margin-bottom: 16px;
`;

const PosterFrame = styled.View`
  width: ${cardWidth}px;
  height: ${cardHeight}px;
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const Title = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 17px;
  font-weight: 700;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-top: 60px;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin-top: 10px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

export function UserPublicListScreen({ route, navigation }: Props) {
  const { userId, list, title } = route.params;
  const { t } = useTranslation();
  const currentTheme = useTheme();
  const [items, setItems] = useState<PublicListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const reachedEnd = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = await getUserPublicList({ userId, list, limit: PAGE_SIZE });
      reachedEnd.current = rows.length < PAGE_SIZE;
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [userId, list]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEndReached = useCallback(async () => {
    if (reachedEnd.current || loadingMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const before = items[items.length - 1].activityAt;
      const next = await getUserPublicList({ userId, list, before, limit: PAGE_SIZE });
      reachedEnd.current = next.length < PAGE_SIZE;
      setItems((current) => [...current, ...next]);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [items, list, loadingMore, userId]);

  const openMedia = useCallback(
    (item: PublicListItem) => {
      if (item.mediaType === "movie") navigation.navigate("MovieDetail", { movieId: String(item.tmdbId) });
      else navigation.navigate("SeriesDetail", { seriesId: String(item.tmdbId) });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PublicListItem>) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w342");
      return (
        <CardRoot onPress={() => openMedia(item)}>
          <PosterFrame>
            {posterUri ? (
              <Image source={{ uri: posterUri }} style={{ width: cardWidth, height: cardHeight }} resizeMode="cover" />
            ) : null}
          </PosterFrame>
          {item.title ? <Title numberOfLines={1}>{item.title}</Title> : null}
        </CardRoot>
      );
    },
    [openMedia]
  );

  const headerTitle =
    title ??
    (list === "watchlist" ? t("profile.watchlist") : list === "liked" ? t("profile.liked") : t("profile.watched"));

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle numberOfLines={1}>{headerTitle}</ScreenTitle>
      </HeaderRow>

      {loading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : items.length === 0 ? (
        <EmptyWrap>
          <Feather name="film" size={32} color={currentTheme.colors.textSecondary} />
          <EmptyText>
            {list === "watchlist"
              ? t("social.emptyWatchlist")
              : list === "liked"
                ? t("social.emptyLiked")
                : t("social.emptyWatched")}
          </EmptyText>
        </EmptyWrap>
      ) : (
        <GridWrap>
          <FlatList
            data={items}
            numColumns={NUM_COLUMNS}
            keyExtractor={(item) => `${item.mediaType}-${item.tmdbId}`}
            renderItem={renderItem}
            columnWrapperStyle={{ gap: GAP }}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
          />
        </GridWrap>
      )}
    </SafeContainer>
  );
}
