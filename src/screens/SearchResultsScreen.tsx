import { Feather } from "@expo/vector-icons";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import {
  DiscoverFilters,
  MediaItem,
  MediaType,
  PaginatedMediaResponse,
  discoverWithFilters,
  getTmdbImageUrl,
  searchMulti
} from "../api/tmdb";
import { formatRating } from "../api/mediaFormatting";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";
import { useAppSettings } from "../settings/AppSettingsContext";

/* ------------------------------------------------------------------ */
/*  Styled Components                                                 */
/* ------------------------------------------------------------------ */

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 8px 16px 16px;
`;

const BackButton = styled(Pressable)`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: ${({ theme }) => theme.colors.surface};
  align-items: center;
  justify-content: center;
  margin-right: 12px;
`;

const HeaderTitle = styled.Text`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  font-weight: 700;
`;

const ResultCount = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const ListContainer = styled.View`
  flex: 1;
  padding: 0 16px;
`;

/* Result Card */
const CardContainer = styled(Animated.View)`
  margin-bottom: 12px;
`;

const Card = styled(Pressable)`
  flex-direction: row;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: 14px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  overflow: hidden;
`;

const CardPoster = styled(Image)`
  width: 100px;
  height: 150px;
`;

const CardPosterPlaceholder = styled.View`
  width: 100px;
  height: 150px;
  background-color: ${({ theme }) => theme.colors.border};
  align-items: center;
  justify-content: center;
`;

const CardContent = styled.View`
  flex: 1;
  padding: 14px;
  justify-content: center;
`;

const CardTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
  line-height: 22px;
`;

const CardYear = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin-top: 4px;
`;

const CardMeta = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 8px;
  gap: 12px;
`;

const RatingBadge = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  background-color: ${({ theme }) => theme.colors.primary}18;
  padding: 4px 10px;
  border-radius: 6px;
`;

const RatingText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 700;
`;

const TypeBadge = styled.View`
  padding: 4px 10px;
  border-radius: 6px;
  background-color: ${({ theme }) => theme.colors.border};
`;

const TypeText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
`;

const CardOverview = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 18px;
  margin-top: 8px;
`;

/* Empty / Not Found State */
const EmptyContainer = styled(Animated.View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
`;

const EmptyIconCircle = styled.View`
  width: 80px;
  height: 80px;
  border-radius: 40px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;

const EmptyTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
  text-align: center;
`;

const EmptySubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
  text-align: center;
  margin-top: 8px;
  line-height: 22px;
`;

const SuggestionWrap = styled.View`
  margin-top: 28px;
  width: 100%;
  gap: 10px;
`;

const SuggestionRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 0 8px;
`;

const SuggestionText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin-left: 10px;
`;

/* Loading */
const LoadingContainer = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const LoadingFooter = styled.View`
  padding: 16px;
  align-items: center;
`;

/* Found state header */
const FoundHeader = styled(Animated.View)`
  align-items: center;
  padding: 16px 16px 24px;
`;

const FoundTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 22px;
  font-weight: 700;
  text-align: center;
`;

const FoundSubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  text-align: center;
  margin-top: 4px;
`;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

type SearchResultsScreenProps = NativeStackScreenProps<HomeStackParamList, "SearchResults">;

export function SearchResultsScreen({ navigation, route }: SearchResultsScreenProps) {
  const { query, filters } = route.params;
  const currentTheme = useTheme();
  const { t } = useTranslation();
  const { language } = useAppSettings();

  const [results, setResults] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const fetchResults = useCallback(
    async (page: number) => {
      let response: PaginatedMediaResponse;

      if (query) {
        response = await searchMulti(query, page);
      } else if (filters) {
        response = await discoverWithFilters(
          {
            mediaType: filters.mediaType as MediaType,
            genreIds: filters.genreIds,
            yearFrom: filters.yearFrom ? parseInt(filters.yearFrom, 10) : undefined,
            yearTo: filters.yearTo ? parseInt(filters.yearTo, 10) : undefined,
            ratingMin: filters.ratingMin ?? undefined,
            sortBy: filters.sortBy as DiscoverFilters["sortBy"]
          },
          page
        );
      } else {
        return { items: [], page: 1, totalPages: 0 };
      }

      return response;
    },
    [query, filters]
  );

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const response = await fetchResults(1);
        setResults(response.items);
        setCurrentPage(response.page);
        setTotalPages(response.totalPages);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchResults, language]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || currentPage >= totalPages) return;

    setIsLoadingMore(true);
    try {
      const response = await fetchResults(currentPage + 1);
      setResults((prev) => [...prev, ...response.items]);
      setCurrentPage(response.page);
    } catch {
      // silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, currentPage, totalPages, fetchResults]);

  const navigateToDetail = useCallback(
    (item: MediaItem) => {
      if (item.mediaType === "movie") {
        navigation.navigate("MovieDetail", { movieId: String(item.id) });
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
      }
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MediaItem>) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w342");

      return (
        <CardContainer entering={FadeInDown.delay(index * 40).duration(300)}>
          <Card onPress={() => navigateToDetail(item)}>
            {posterUri ? (
              <CardPoster source={{ uri: posterUri }} resizeMode="cover" />
            ) : (
              <CardPosterPlaceholder>
                <Feather name="film" size={24} color={currentTheme.colors.textSecondary} />
              </CardPosterPlaceholder>
            )}
            <CardContent>
              <CardTitle numberOfLines={2}>{item.title}</CardTitle>
              <CardYear>{item.year !== "----" ? item.year : t("common.unknownYear")}</CardYear>
              <CardMeta>
                {typeof item.rating === "number" && item.rating > 0 && (
                  <RatingBadge>
                    <Feather name="star" size={12} color={currentTheme.colors.primary} />
                    <RatingText>{formatRating(item.rating)}</RatingText>
                  </RatingBadge>
                )}
                <TypeBadge>
                  <TypeText>{item.mediaType === "movie" ? t("common.movie") : t("common.series")}</TypeText>
                </TypeBadge>
              </CardMeta>
              {item.overview ? (
                <CardOverview numberOfLines={2}>{item.overview}</CardOverview>
              ) : null}
            </CardContent>
          </Card>
        </CardContainer>
      );
    },
    [navigateToDetail, currentTheme]
  );

  const displayTitle = query
    ? `"${query}"`
    : t("search.filteredResults");

  if (isLoading) {
    return (
      <SafeContainer>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={20} color={currentTheme.colors.textPrimary} />
          </BackButton>
          <HeaderTitle>{t("common.searching")}</HeaderTitle>
        </Header>
        <LoadingContainer>
          <ActivityIndicator color={currentTheme.colors.primary} size="large" />
        </LoadingContainer>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Header>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <HeaderTitle numberOfLines={1}>{displayTitle}</HeaderTitle>
        <ResultCount>
          {results.length > 0 ? t("search.resultsCount", { count: results.length }) : ""}
        </ResultCount>
      </Header>

      {results.length === 0 ? (
        <EmptyContainer entering={FadeIn.duration(400)}>
          <EmptyIconCircle>
            <Feather name="film" size={32} color={currentTheme.colors.textSecondary} />
          </EmptyIconCircle>
          <EmptyTitle>{t("search.noResultsFound")}</EmptyTitle>
          <EmptySubtitle>
            {t("search.couldNotFindMatch")}{"\n"}
            {query ? `"${query}"` : t("search.yourFilters")}
          </EmptySubtitle>
          <SuggestionWrap>
            <SuggestionRow>
              <Feather name="check-circle" size={16} color={currentTheme.colors.primary} />
              <SuggestionText>{t("search.suggestionCheckSpelling")}</SuggestionText>
            </SuggestionRow>
            <SuggestionRow>
              <Feather name="check-circle" size={16} color={currentTheme.colors.primary} />
              <SuggestionText>{t("search.suggestionUseShorterTerms")}</SuggestionText>
            </SuggestionRow>
            <SuggestionRow>
              <Feather name="check-circle" size={16} color={currentTheme.colors.primary} />
              <SuggestionText>{t("search.suggestionAdjustFilters")}</SuggestionText>
            </SuggestionRow>
          </SuggestionWrap>
        </EmptyContainer>
      ) : (
        <ListContainer>
          {query && (
            <FoundHeader entering={FadeIn.duration(300)}>
              <FoundTitle>{t("search.resultsFor", { query })}</FoundTitle>
              <FoundSubtitle>
                {t("search.foundMatchingTitles", { count: results.length })}
              </FoundSubtitle>
            </FoundHeader>
          )}
          <FlashList
            data={results}
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isLoadingMore ? (
                <LoadingFooter>
                  <ActivityIndicator color={currentTheme.colors.primary} size="small" />
                </LoadingFooter>
              ) : (
                <View style={{ height: 24 }} />
              )
            }
          />
        </ListContainer>
      )}
    </SafeContainer>
  );
}
