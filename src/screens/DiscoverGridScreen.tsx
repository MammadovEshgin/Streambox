import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, useWindowDimensions } from "react-native";
import styled from "styled-components/native";

import {
  MediaItem,
  getDiscoverCollectionPage,
  getTmdbImageUrl,
  resolveTmdbMovieIdFromImdbId,
  resolveTmdbTvIdFromImdbId
} from "../api/tmdb";
import { getAzClassicMovies, AzClassicMovie } from "../api/azClassics";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";

const GRID_COLUMNS = 3;
const GRID_GAP = 10;
const HORIZONTAL_PADDING = 16;
const BOTTOM_PADDING = 24;
const INITIAL_BATCH = 9;
const BATCH_SIZE = 9;
const QUOTE_CAROUSEL_SIDE_PADDING = 16;
const QUOTE_CAROUSEL_GAP = 12;

const AZ_CLASSIC_QUOTES = [
  {
    quote: "Bu kino ki var, bu çox qəliz məsələdi. Həm qəlizdi həmdəki vacib.",
    movieTitle: "Əhməd haradadır",
  },
  {
    quote: "Abbasqulu bəyin nazı ilə çox oynayırıq ha Kərbəlayi!",
    movieTitle: "Axırıncı aşırım",
  },
  {
    quote: "Adını “Qurd Cəbrayıl” qoymusan, amma arvad kimi uşaq arxasında gizlənirsən!",
    movieTitle: "Arxadan vurulan zərbə",
  },
  {
    quote: "Bu dünyada bircə gün azad yaşamaq, 40 il boyunduruq altında sürünməkdən daha üstündür.",
    movieTitle: "Babək",
  },
  {
    quote: "Arvad dediyin ki var, ağır yükdü. Piyada adamın ona gücü çatmaz.",
    movieTitle: "Babamızın babasının babası",
  },
  {
    quote: "Mən sabun bişirməyəcəm!",
    movieTitle: "Bizim Cəbiş müəllim",
  },
  {
    quote: "Oğlumu axtarırdım, dostumu tapdım.",
    movieTitle: "Əhməd haradadır?",
  },
  {
    quote: "Bəs necə? Yaraşmırdım axı sənə! Tərbiyəm yox, savadım yox, ata-anasız!",
    movieTitle: "Park",
  },
  {
    quote: "Kişinin qoluna da qandalı gərək, kişi vursun.",
    movieTitle: "Qanlı zəmi",
  },
  {
    quote: "Fikirləşmək hələ heç kimə həyatda mane olmayıb.",
    movieTitle: "Yay günlərində xəzan yarpaqları",
  },
] as const;

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
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const QuoteCarouselWrap = styled.View`
  margin-bottom: 4px;
`;

const QuoteSlide = styled.View`
  justify-content: flex-start;
`;

const QuotePanel = styled.View`
  padding: 14px 16px 14px;
  border-radius: 18px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  background-color: rgba(255, 255, 255, 0.035);
  overflow: hidden;
`;

const QuoteCarousel = styled.FlatList``;

const QuoteBodyRow = styled.View`
  margin-top: 2px;
  margin-left: 10px;
  margin-right: 26px;
`;

const QuoteText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  line-height: 21px;
  font-weight: 400;
  font-style: italic;
  letter-spacing: 0.1px;
`;

const QuoteMovieTitle = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 14px;
  line-height: 21px;
  font-weight: 400;
  font-style: italic;
  letter-spacing: 0.1px;
`;

const QuoteDotsRow = styled.View`
  margin: 0 16px 12px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const QuoteDot = styled.View<{ $active: boolean }>`
  width: ${({ $active }) => ($active ? 18 : 6)}px;
  height: 6px;
  border-radius: 999px;
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : "rgba(255, 255, 255, 0.18)"};
`;

const QuoteMark = styled.Text`
  position: absolute;
  right: 14px;
  top: -12px;
  color: rgba(255, 255, 255, 0.07);
  font-size: 72px;
  line-height: 84px;
  font-weight: 700;
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
  font-weight: 600;
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
  font-weight: 600;
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
  font-weight: 600;
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
  const { width: viewportWidth } = useWindowDimensions();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [azClassicsData, setAzClassicsData] = useState<Record<string, { posterUri: string | null; movieId: string }>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
  const isAzClassicsScreen = source === "az_classics";

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (source === "az_classics") {
        // Load Azerbaijan Classics
        const classics = await getAzClassicMovies();
        const classicsDataMap: Record<string, { posterUri: string | null; movieId: string }> = {};
        const convertedItems: MediaItem[] = classics.map((movie: AzClassicMovie) => {
          classicsDataMap[`az-${movie.id}`] = {
            posterUri: movie.cachedPosterUrl ?? movie.posterUrl,
            movieId: movie.id
          };
          return {
            id: movie.id,
            title: movie.title,
            posterPath: "",
            backdropPath: null,
            mediaType: "movie" as const,
            rating: 0,
            overview: movie.synopsis || "",
            year: String(movie.year),
            imdbId: `az-${movie.id}` // Keep original UUID in imdbId for detail navigation logic
          };
        });
        setAzClassicsData(classicsDataMap);
        setItems(convertedItems);
        setPage(1);
        setTotalPages(1);
        setVisibleCount(Math.min(INITIAL_BATCH, convertedItems.length));
      } else {
        const response = await getDiscoverCollectionPage(source, 1);
        setItems(response.items);
        setPage(response.page);
        setTotalPages(response.totalPages);
        setVisibleCount(Math.min(INITIAL_BATCH, response.items.length));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load this list.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

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
      const message = error instanceof Error ? error.message : "Unable to load more titles.";
      setErrorMessage(message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, items.length, page, source, totalPages, visibleCount]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length || page < totalPages;
  const quoteCardWidth = useMemo(
    () => Math.min(360, viewportWidth - (QUOTE_CAROUSEL_SIDE_PADDING * 2)),
    [viewportWidth]
  );

  const handleQuoteScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset } = event.nativeEvent;
    const slideWidth = quoteCardWidth + QUOTE_CAROUSEL_GAP;
    const nextIndex = Math.round(contentOffset.x / slideWidth);
    setActiveQuoteIndex(Math.max(0, Math.min(AZ_CLASSIC_QUOTES.length - 1, nextIndex)));
  }, [quoteCardWidth]);

  const openMedia = useCallback(
    async (item: MediaItem) => {
      if (item.mediaType === "movie") {
        // Check if this is an Azerbaijan Classic
        if (item.imdbId && item.imdbId.startsWith("az-")) {
          const classicData = azClassicsData[item.imdbId];
          if (classicData) {
            navigation.navigate("AzClassicDetail", { movieId: classicData.movieId });
            return;
          }
        }

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
    [navigation, azClassicsData]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      let posterUri: string | null = null;

      // Check if it's an Azerbaijan Classic
      if (item.imdbId && item.imdbId.startsWith("az-")) {
        const classicData = azClassicsData[item.imdbId];
        if (classicData?.posterUri) {
          posterUri = classicData.posterUri;
        }
      } else {
        // Regular TMDB movie
        posterUri = getTmdbImageUrl(item.posterPath, "w342");
      }

      const rating = item.rating.toFixed(1);

      const isAzClassic = !!(typeof item.id === "string" || (item.imdbId && item.imdbId.startsWith("az-")));

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
                <NoImageText>No Image</NoImageText>
              </NoImage>
            )}
            {!isAzClassic && rating !== "0.0" && (
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
    [openMedia, azClassicsData]
  );

  if (isLoading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="Loading collection" />
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

        {isAzClassicsScreen ? (
          <>
            <QuoteCarouselWrap>
              <FlatList
                data={AZ_CLASSIC_QUOTES}
                horizontal
                pagingEnabled={false}
                decelerationRate="fast"
                snapToAlignment="start"
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item, index) => `${item.movieTitle}-${index}`}
                snapToInterval={quoteCardWidth + QUOTE_CAROUSEL_GAP}
                contentContainerStyle={{
                  paddingHorizontal: QUOTE_CAROUSEL_SIDE_PADDING,
                  paddingVertical: 0,
                  alignItems: "flex-start",
                }}
                style={{ flexGrow: 0 }}
                onMomentumScrollEnd={handleQuoteScrollEnd}
                onScrollEndDrag={handleQuoteScrollEnd}
                renderItem={({ item, index }) => (
                  <QuoteSlide
                    style={{
                      width: quoteCardWidth,
                      marginRight: index === AZ_CLASSIC_QUOTES.length - 1 ? 0 : QUOTE_CAROUSEL_GAP,
                    }}
                  >
                    <QuotePanel>
                      <QuoteMark>"</QuoteMark>
                      <QuoteBodyRow>
                        <QuoteText>
                           {`"${item.quote}" - `}
                           <QuoteMovieTitle>{item.movieTitle}</QuoteMovieTitle>
                        </QuoteText>
                      </QuoteBodyRow>
                    </QuotePanel>
                  </QuoteSlide>
                )}
              />
            </QuoteCarouselWrap>
            <QuoteDotsRow>
              {AZ_CLASSIC_QUOTES.map((item, index) => (
                <QuoteDot key={`${item.movieTitle}-${index}`} $active={index === activeQuoteIndex} />
              ))}
            </QuoteDotsRow>
          </>
        ) : null}

        <FlashList
          data={visibleItems}
          numColumns={GRID_COLUMNS}
          keyExtractor={(item) => {
            // Use imdbId for az_classics (contains original UUID), id for regular movies
            if (item.imdbId && item.imdbId.startsWith("az-")) {
              return item.imdbId;
            }
            return `${item.mediaType}-${item.id}`;
          }}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING - GRID_GAP / 2,
            paddingBottom: BOTTOM_PADDING
          }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyText>{errorMessage ?? "No titles found."}</EmptyText>}
          ListFooterComponent={
            hasMore ? (
              <FooterWrap>
                <LoadMoreButton onPress={loadMore}>
                  <LoadMoreText>{isLoadingMore ? "Loading..." : "Load more"}</LoadMoreText>
                </LoadMoreButton>
              </FooterWrap>
            ) : null
          }
        />
      </Root>
    </SafeContainer>
  );
}
