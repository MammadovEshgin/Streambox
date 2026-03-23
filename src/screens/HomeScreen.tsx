import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView } from "react-native";
import styled from "styled-components/native";

import { MediaItem, getPopular, getTrending } from "../api/tmdb";
import { getAzClassicMovies, AzClassicMovie } from "../api/azClassics";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import {
  DEFAULT_FILTERS,
  FilterModal,
  FilterState,
  hasActiveFilters as checkActiveFilters
} from "../components/home/FilterModal";
import { SpotlightCarousel } from "../components/home/SpotlightCarousel";
import { HomeHeader } from "../components/home/HomeHeader";
import { MediaCard } from "../components/home/MediaCard";
import { HomeStackParamList } from "../navigation/types";
import { isRuntimeCacheFresh, readRuntimeCache, writeRuntimeCache } from "../services/runtimeCache";

const HOME_DISCOVERY_CACHE_KEY = "home-discovery-v1";
const HOME_DISCOVERY_CACHE_TTL_MS = 1000 * 60 * 10;

type HomeDiscoveryCache = {
  popularMovies: MediaItem[];
  trendingMovies: MediaItem[];
  trendingSeries: MediaItem[];
  azClassics?: AzClassicMovie[];
};

const Layout = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
  nestedScrollEnabled: true
})`
  flex: 1;
`;

const Content = styled.View`
  padding: 0 16px 24px;
`;

const ScreenTitle = styled.Text`
  margin-top: 2px;
  margin-bottom: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 23px;
  line-height: 28px;
  font-weight: 700;
  letter-spacing: -0.35px;
`;

const HeroWrap = styled.View`
  margin-top: 8px;
  margin-bottom: 22px;
`;

const SectionHeader = styled.View`
  margin-bottom: 12px;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
`;

const SectionLinkButton = styled.Pressable`
  padding: 4px 2px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.TitleMedium.fontFamily};
  font-size: 20px;
  line-height: 26px;
  font-weight: 700;
  letter-spacing: -0.4px;
`;

const SectionLink = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 14px;
  letter-spacing: 0.25px;
`;

const RailWrap = styled.View`
  height: 282px;
`;

const RailCardWrap = styled.View`
  margin-right: 12px;
`;

const EmptyRail = styled.View`
  height: 220px;
  border-radius: 16px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

const EmptyRailText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.BodyMedium.fontFamily};
  font-size: 14px;
  letter-spacing: 0.25px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const ErrorText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.BodySmall.fontFamily};
  font-size: 14px;
  text-align: center;
  margin-top: 12px;
`;

type RailProps = {
  title: string;
  data: (MediaItem | AzClassicMovie)[];
  onPressItem?: (item: MediaItem | AzClassicMovie) => void;
  onPressSeeAll?: () => void;
};

function DiscoveryRail({ title, data, onPressItem, onPressSeeAll }: RailProps) {
  const renderItem = useCallback(({ item }: ListRenderItemInfo<MediaItem | AzClassicMovie>) => {
    const isAzClassic = "posterUrl" in item && !("mediaType" in item);
    const displayItem: MediaItem = isAzClassic
      ? {
          id: (item as AzClassicMovie).id as unknown as number,
          title: (item as AzClassicMovie).title,
          posterPath: "",
          backdropPath: null,
          mediaType: "movie" as const,
          rating: 0,
          overview: (item as AzClassicMovie).synopsis || "",
          year: String((item as AzClassicMovie).year)
        }
      : (item as MediaItem);

    return (
      <RailCardWrap>
        <MediaCard
          item={displayItem}
          onPress={() => onPressItem?.(item)}
          posterUri={isAzClassic ? ((item as AzClassicMovie).cachedPosterUrl ?? (item as AzClassicMovie).posterUrl ?? undefined) : undefined}
          hideRating={isAzClassic}
        />
      </RailCardWrap>
    );
  }, [onPressItem]);

  return (
    <>
      <SectionHeader>
        <SectionTitle>{title}</SectionTitle>
        <SectionLinkButton 
          onPress={onPressSeeAll}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <SectionLink>See all</SectionLink>
        </SectionLinkButton>
      </SectionHeader>
      {data.length === 0 ? (
        <EmptyRail>
          <EmptyRailText>No results in this rail</EmptyRailText>
        </EmptyRail>
      ) : (
        <RailWrap>
          <FlashList
            data={data}
            horizontal
            keyExtractor={(item) => {
              const isAzClassic = "posterUrl" in item && !("mediaType" in item);
              return isAzClassic ? `az-${item.id}` : `${(item as MediaItem).mediaType}-${item.id}`;
            }}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
          />
        </RailWrap>
      )}
    </>
  );
}

type HomeScreenProps = NativeStackScreenProps<HomeStackParamList, "HomeFeed">;

export function HomeScreen({ navigation }: HomeScreenProps) {
  const cacheRef = useRef(readRuntimeCache<HomeDiscoveryCache>(HOME_DISCOVERY_CACHE_KEY));
  const cachedDiscovery = cacheRef.current?.value;
  const [query, setQuery] = useState("");
  const [popularMovies, setPopularMovies] = useState<MediaItem[]>(cachedDiscovery?.popularMovies ?? []);
  const [trendingMovies, setTrendingMovies] = useState<MediaItem[]>(cachedDiscovery?.trendingMovies ?? []);
  const [trendingSeries, setTrendingSeries] = useState<MediaItem[]>(cachedDiscovery?.trendingSeries ?? []);
  const [azClassics, setAzClassics] = useState<AzClassicMovie[]>(cachedDiscovery?.azClassics ?? []);
  const [isLoading, setIsLoading] = useState(!cachedDiscovery);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const hasDiscoveryData = popularMovies.length > 0 || trendingMovies.length > 0 || trendingSeries.length > 0 || azClassics.length > 0;

  const loadDiscovery = useCallback(async (background = false) => {
    if (!background && !hasDiscoveryData) {
      setIsLoading(true);
    }

    try {
      const [popular, movies, series, classics] = await Promise.all([
        getPopular(),
        getTrending("movie"),
        getTrending("tv"),
        getAzClassicMovies()
      ]);

      writeRuntimeCache<HomeDiscoveryCache>(HOME_DISCOVERY_CACHE_KEY, {
        popularMovies: popular,
        trendingMovies: movies,
        trendingSeries: series,
        azClassics: classics
      });

      startTransition(() => {
        setPopularMovies(popular);
        setTrendingMovies(movies);
        setTrendingSeries(series);
        setAzClassics(classics);
        setErrorMessage(null);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load discovery feed.";
      if (!hasDiscoveryData) {
        setErrorMessage(message);
      }
      // Still set az classics to empty array if they fail to load
      setAzClassics([]);
    } finally {
      setIsLoading(false);
    }
  }, [hasDiscoveryData]);

  useEffect(() => {
    const isFresh = isRuntimeCacheFresh(cacheRef.current, HOME_DISCOVERY_CACHE_TTL_MS);
    if (isFresh) {
      return;
    }

    void loadDiscovery(Boolean(cachedDiscovery));
  }, [cachedDiscovery, loadDiscovery]);

  const spotlightItems = useMemo(() => {
    const pool = popularMovies.length > 0 ? popularMovies : [...trendingMovies, ...trendingSeries];
    return pool.filter((i) => i.backdropPath).slice(0, 5);
  }, [popularMovies, trendingMovies, trendingSeries]);

  const handleSearchSubmit = useCallback(
    (searchQuery: string) => {
      navigation.navigate("SearchResults", { query: searchQuery });
    },
    [navigation]
  );

  const handleSelectItem = useCallback(
    (item: MediaItem) => {
      if (item.mediaType === "movie") {
        navigation.navigate("MovieDetail", { movieId: String(item.id) });
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
      }
    },
    [navigation]
  );

  const handleApplyFilters = useCallback(
    (newFilters: FilterState) => {
      setFilters(newFilters);
      navigation.navigate("SearchResults", {
        filters: {
          mediaType: newFilters.mediaType,
          genreIds: newFilters.genreIds,
          yearFrom: newFilters.yearFrom,
          yearTo: newFilters.yearTo,
          ratingMin: newFilters.ratingMin,
          sortBy: newFilters.sortBy
        }
      });
    },
    [navigation]
  );

  if (isLoading && !hasDiscoveryData) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="Loading reels" />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Layout keyboardShouldPersistTaps="handled">
        <Content>
          <ScreenTitle>Discover</ScreenTitle>
          <HomeHeader
            query={query}
            onChangeQuery={setQuery}
            onOpenFilter={() => setFilterVisible(true)}
            onSearchSubmit={handleSearchSubmit}
            onSelectItem={handleSelectItem}
            hasActiveFilters={checkActiveFilters(filters)}
          />

          <HeroWrap>
            <SpotlightCarousel
              items={spotlightItems}
              onPressItem={handleSelectItem}
            />
            {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
          </HeroWrap>

          <DiscoveryRail
            title="Trending Movies"
            data={trendingMovies}
            onPressItem={(item) => {
              navigation.navigate("MovieDetail", { movieId: String(item.id) });
            }}
            onPressSeeAll={() => {
              navigation.navigate("DiscoverGrid", {
                source: "trending_movies",
                title: "Trending Movies"
              });
            }}
          />
          <DiscoveryRail
            title="Trending Series"
            data={trendingSeries}
            onPressItem={(item) => {
              navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
            }}
            onPressSeeAll={() => {
              navigation.navigate("DiscoverGrid", {
                source: "trending_series",
                title: "Trending Series"
              });
            }}
          />
          <DiscoveryRail
            title="Azerbaijan Classics"
            data={azClassics}
            onPressItem={(item) => {
              if ("posterUrl" in item) {
                navigation.navigate("AzClassicDetail", { movieId: item.id });
              }
            }}
            onPressSeeAll={() => {
              navigation.navigate("DiscoverGrid", {
                source: "az_classics" as any,
                title: "Azerbaijan Classics"
              });
            }}
          />
        </Content>
      </Layout>

      <FilterModal
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        filters={filters}
        onApply={handleApplyFilters}
      />
    </SafeContainer>
  );
}
