import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import {
  MediaItem,
  getDiscoverCollectionPage,
  getTmdbImageUrl,
  resolveTmdbMovieIdFromImdbId,
  resolveTmdbTvIdFromImdbId
} from "../api/tmdb";
import { formatRating } from "../api/mediaFormatting";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";
import { useAppSettings } from "../settings/AppSettingsContext";

const GRID_COLUMNS = 3;
const GRID_GAP = 10;
const HORIZONTAL_PADDING = 16;
const BOTTOM_PADDING = 24;
const INITIAL_BATCH = 9;
const BATCH_SIZE = 9;

const Root = styled.View`
  flex: 1;
`;

const Header = styled.View`
  padding: 8px 16px 14px;
  flex-direction: row;
  align-items: center;
`;

const BackButton = styled.Pressable`
  width: 34px;
  height: 34px;
  border-radius: 10px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.06);
`;

const HeaderTextWrap = styled.View`
  margin-left: 12px;
  flex: 1;
`;

const HeaderTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  line-height: 22px;
  font-family: Outfit_700Bold;
  letter-spacing: -0.3px;
`;

const CardPressable = styled.Pressable`
  width: 100%;
  margin-bottom: 12px;
  padding: 0 ${GRID_GAP / 2}px;
`;

const PosterFrame = styled.View`
  width: 100%;
  aspect-ratio: 0.6667;
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const PosterImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const RatingBadge = styled.View`
  position: absolute;
  left: 8px;
  bottom: 8px;
  flex-direction: row;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.68);
`;

const RatingValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 14px;
  font-family: Outfit_600SemiBold;
  letter-spacing: 0.15px;
`;

const NoImage = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const NoImageText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  letter-spacing: 0.2px;
  text-transform: uppercase;
`;

const CardTitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-family: Outfit_600SemiBold;
  letter-spacing: -0.2px;
`;

const CardMeta = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 14px;
`;

const FooterWrap = styled.View`
  padding-top: 6px;
  padding-bottom: 8px;
  align-items: center;
`;

const LoadMoreButton = styled.Pressable`
  min-width: 124px;
  height: 42px;
  padding: 0 18px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const LoadMoreText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-family: Outfit_600SemiBold;
  letter-spacing: 0.15px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EmptyText = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  text-align: center;
`;

type DiscoverGridProps = NativeStackScreenProps<HomeStackParamList, "DiscoverGrid">;

function mergeUniqueMedia(existing: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const existingKeys = new Set(existing.map((item) => `${item.mediaType}-${item.id}`));
  const merged = existing.slice();

  incoming.forEach((item) => {
    const key = `${item.mediaType}-${item.id}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      merged.push(item);
    }
  });

  return merged;
}

export function DiscoverGridScreen({ route, navigation }: DiscoverGridProps) {
  const { source, title } = route.params;
  const { t } = useTranslation();
  const { language } = useAppSettings();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await getDiscoverCollectionPage(source, 1);
      setItems(response.items);
      setPage(response.page);
      setTotalPages(response.totalPages);
      setVisibleCount(Math.min(INITIAL_BATCH, response.items.length));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("discover.unableToLoadList");
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [source, t, language]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial, language]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore) {
      return;
    }

    const availableInBuffer = items.length - visibleCount;
    if (availableInBuffer >= BATCH_SIZE) {
      setVisibleCount((prev) => prev + BATCH_SIZE);
      return;
    }

    if (availableInBuffer <= 0 && page >= totalPages) {
      return;
    }

    setIsLoadingMore(true);
    setErrorMessage(null);

    try {
      let workingItems = items.slice();
      let workingPage = page;
      let workingTotalPages = totalPages;

      // Fetch as many pages as needed so one click can reveal a full 3x3 batch.
      while (workingItems.length - visibleCount < BATCH_SIZE && workingPage < workingTotalPages) {
        const response = await getDiscoverCollectionPage(source, workingPage + 1);
        workingItems = mergeUniqueMedia(workingItems, response.items);
        workingPage = response.page;
        workingTotalPages = response.totalPages;
      }

      setItems(workingItems);
      setPage(workingPage);
      setTotalPages(workingTotalPages);
      setVisibleCount(Math.min(visibleCount + BATCH_SIZE, workingItems.length));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("discover.unableToLoadMoreTitles");
      setErrorMessage(message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, items.length, language, page, source, t, totalPages, visibleCount]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length || page < totalPages;

  const openMedia = useCallback(
    async (item: MediaItem) => {
      if (item.mediaType === "movie") {
        if (item.posterPath || item.backdropPath) {
          navigation.navigate("MovieDetail", { movieId: String(item.id) });
          return;
        }

        if (item.imdbId) {
          try {
            const resolvedTmdbId = await resolveTmdbMovieIdFromImdbId(item.imdbId);
            if (resolvedTmdbId) {
              navigation.navigate("MovieDetail", { movieId: resolvedTmdbId });
              return;
            }
          } catch {
            navigation.navigate("MovieDetail", { movieId: String(item.id) });
            return;
          }
        }

        navigation.navigate("MovieDetail", { movieId: String(item.id) });
        return;
      }

      if (item.imdbId) {
        if (item.posterPath || item.backdropPath) {
          navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
          return;
        }

        try {
          const resolvedTmdbId = await resolveTmdbTvIdFromImdbId(item.imdbId);
          if (resolvedTmdbId) {
            navigation.navigate("SeriesDetail", { seriesId: resolvedTmdbId });
            return;
          }
        } catch {
          navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
          return;
        }
      }

      navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w342");
      const rating = formatRating(item.rating);

      return (
        <CardPressable
          onPress={() => {
            void openMedia(item);
          }}
        >
          <PosterFrame>
            {posterUri ? (
              <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
            ) : (
              <NoImage>
                <NoImageText>{t("common.noImage")}</NoImageText>
              </NoImage>
            )}
            {rating !== "0.0" && (
              <RatingBadge>
                <Feather name="star" size={10} color="#FFD700" style={{ marginRight: 4 }} />
                <RatingValue>{rating}</RatingValue>
              </RatingBadge>
            )}
          </PosterFrame>
          <CardTitle numberOfLines={1}>{item.title}</CardTitle>
          <CardMeta>{typeof item.rank === "number" ? `${item.year} | #${item.rank}` : item.year}</CardMeta>
        </CardPressable>
      );
    },
    [openMedia, t]
  );

  if (isLoading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label={t("discover.loadingCollection")} />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Root>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </BackButton>
          <HeaderTextWrap>
            <HeaderTitle>{title}</HeaderTitle>
          </HeaderTextWrap>
        </Header>

        <FlashList
          data={visibleItems}
          numColumns={GRID_COLUMNS}
          keyExtractor={(item) => {
            return `${item.mediaType}-${item.id}`;
          }}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING - GRID_GAP / 2,
            paddingBottom: BOTTOM_PADDING
          }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          ListEmptyComponent={<EmptyText>{errorMessage ?? t("discover.noTitlesFound")}</EmptyText>}
          ListFooterComponent={
            hasMore ? (
              <FooterWrap>
                <LoadMoreButton onPress={loadMore}>
                  <LoadMoreText>{isLoadingMore ? t("common.loading") : t("discover.loadMore")}</LoadMoreText>
                </LoadMoreButton>
              </FooterWrap>
            ) : null
          }
        />
      </Root>
    </SafeContainer>
  );
}
