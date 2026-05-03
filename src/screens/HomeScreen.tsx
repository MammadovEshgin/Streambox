import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, ScrollView } from "react-native";
import styled from "styled-components/native";

import { MediaItem, getPopular, getTrending } from "../api/tmdb";
import { isValidMediaItemArray } from "../api/mediaFormatting";
import {
  FranchiseCollection,
  getFranchiseCollections,
  prefetchFranchiseEntries,
  refreshFranchiseCollections,
} from "../api/franchises";
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
import { FranchiseCollectionArtwork } from "../components/franchise/FranchiseCollectionArtwork";
import { useRuntimeCacheAutoRefresh } from "../hooks/useRuntimeCacheAutoRefresh";
import { HomeStackParamList } from "../navigation/types";
import { formatFranchiseCollectionTitle } from "../services/franchiseLocalization";
import { getTimeBucketFreshnessKey } from "../services/contentFreshness";
import {
  readPersistedRuntimeCache,
  readRuntimeCache,
  writePersistedRuntimeCache,
  writeRuntimeCache,
} from "../services/runtimeCache";
import { useAppSettings } from "../settings/AppSettingsContext";

const HOME_DISCOVERY_CACHE_KEY = "home-discovery-v1";
const HOME_DISCOVERY_CACHE_TTL_MS = 1000 * 60 * 10;

type HomeDiscoveryCache = {
  popularMovies: MediaItem[];
  trendingMovies: MediaItem[];
  trendingSeries: MediaItem[];
};

function isValidHomeDiscoveryCache(value: unknown): value is HomeDiscoveryCache {
  if (!value || typeof value !== "object") {
    return false;
  }

  const cache = value as Partial<HomeDiscoveryCache>;
  return (
    isValidMediaItemArray(cache.popularMovies)
    && isValidMediaItemArray(cache.trendingMovies)
    && isValidMediaItemArray(cache.trendingSeries)
  );
}

const Layout = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
  nestedScrollEnabled: true
})`
  flex: 1;
`;

const Content = styled.View`
  padding: 0 16px 24px;
`;

const HeroWrap = styled.View`
  margin-top: 8px;
  margin-bottom: 22px;
`;

const SectionHeader = styled.View`
  margin-top: 8px;
  margin-bottom: 14px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const SectionLinkButton = styled.Pressable`
  padding: 4px 2px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const SectionLink = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 13px;
  letter-spacing: 0;
`;

const RailWrap = styled.View`
  height: 282px;
`;

const RailCardWrap = styled.View`
  margin-right: 12px;
`;

const FranchiseCardRoot = styled.Pressable`
  width: 132px;
`;

const FranchiseArtworkFrame = styled.View`
  width: 132px;
  height: 198px;
  border-radius: 12px;
  overflow: hidden;
`;

const FranchiseCardTitle = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.BodySmall.fontFamily};
  font-size: 14px;
  line-height: 19px;
  letter-spacing: -0.15px;
`;

const FranchiseCardMeta = styled.Text`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.3px;
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
  data: MediaItem[];
  onPressItem?: (item: MediaItem) => void;
  onPressSeeAll?: () => void;
};

const DiscoveryRail = memo(function DiscoveryRail({ title, data, onPressItem, onPressSeeAll }: RailProps) {
  const { t } = useTranslation();
  const renderItem = useCallback(({ item }: ListRenderItemInfo<MediaItem>) => {
    return (
      <RailCardWrap>
        <MediaCard
          item={item}
          onPress={() => onPressItem?.(item)}
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
          <SectionLink>{t("common.seeAll")}</SectionLink>
        </SectionLinkButton>
      </SectionHeader>
      {data.length === 0 ? (
        <EmptyRail>
          <EmptyRailText>{t("search.noResultsFound")}</EmptyRailText>
        </EmptyRail>
      ) : (
        <RailWrap>
          <FlashList
            data={data}
            horizontal
            keyExtractor={(item) => {
              return `${item.mediaType}-${item.id}`;
            }}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
            removeClippedSubviews
          />
        </RailWrap>
      )}
    </>
  );
});

type HomeScreenProps = NativeStackScreenProps<HomeStackParamList, "HomeFeed">;

export function HomeScreen({ navigation }: HomeScreenProps) {
  const { t } = useTranslation();
  const { language } = useAppSettings();
  const localizedCacheKey = `${HOME_DISCOVERY_CACHE_KEY}:${language}`;
  const discoveryCacheEntry = readRuntimeCache<HomeDiscoveryCache>(localizedCacheKey);
  const cachedDiscovery = discoveryCacheEntry?.value;
  const getDiscoveryFreshnessVersion = useCallback(() => getTimeBucketFreshnessKey(6), []);
  const [query, setQuery] = useState("");
  const [popularMovies, setPopularMovies] = useState<MediaItem[]>(cachedDiscovery?.popularMovies ?? []);
  const [trendingMovies, setTrendingMovies] = useState<MediaItem[]>(cachedDiscovery?.trendingMovies ?? []);
  const [trendingSeries, setTrendingSeries] = useState<MediaItem[]>(cachedDiscovery?.trendingSeries ?? []);
  const [franchises, setFranchises] = useState<FranchiseCollection[]>([]);
  const [isLoading, setIsLoading] = useState(!cachedDiscovery);
  const [hasHydratedPersistentCache, setHasHydratedPersistentCache] = useState(Boolean(cachedDiscovery));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const hasDiscoveryData = popularMovies.length > 0 || trendingMovies.length > 0 || trendingSeries.length > 0;

  useEffect(() => {
    setPopularMovies(cachedDiscovery?.popularMovies ?? []);
    setTrendingMovies(cachedDiscovery?.trendingMovies ?? []);
    setTrendingSeries(cachedDiscovery?.trendingSeries ?? []);
    setErrorMessage(null);
    setIsLoading(!cachedDiscovery);
  }, [cachedDiscovery, language]);

  useEffect(() => {
    let active = true;

    if (cachedDiscovery) {
      setHasHydratedPersistentCache(true);
      return () => {
        active = false;
      };
    }

    void readPersistedRuntimeCache<HomeDiscoveryCache>(localizedCacheKey, { validate: isValidHomeDiscoveryCache })
      .then((entry) => {
        if (!active) {
          return;
        }

        if (entry?.value) {
          setPopularMovies(entry.value.popularMovies ?? []);
          setTrendingMovies(entry.value.trendingMovies ?? []);
          setTrendingSeries(entry.value.trendingSeries ?? []);
          setIsLoading(false);
        }

        setHasHydratedPersistentCache(true);
      })
      .catch(() => {
        if (active) {
          setHasHydratedPersistentCache(true);
        }
      });

    return () => {
      active = false;
    };
  }, [cachedDiscovery, localizedCacheKey]);

  const loadDiscovery = useCallback(async (background = false) => {
    if (!background && !hasDiscoveryData) {
      setIsLoading(true);
    }

    try {
      const [popular, movies, series] = await Promise.all([
        getPopular(),
        getTrending("movie"),
        getTrending("tv"),
      ]);

      const coreState: HomeDiscoveryCache = {
        popularMovies: popular,
        trendingMovies: movies,
        trendingSeries: series,
      };

      const freshnessVersion = getDiscoveryFreshnessVersion();
      writeRuntimeCache<HomeDiscoveryCache>(localizedCacheKey, coreState, { version: freshnessVersion });
      void writePersistedRuntimeCache<HomeDiscoveryCache>(localizedCacheKey, coreState, { version: freshnessVersion });

      startTransition(() => {
        setPopularMovies(popular);
        setTrendingMovies(movies);
        setTrendingSeries(series);
        setErrorMessage(null);
      });

      void getFranchiseCollections().catch(() => [] as FranchiseCollection[]).then((franchiseData) => {
        const nextState: HomeDiscoveryCache = {
          popularMovies: popular,
          trendingMovies: movies,
          trendingSeries: series,
        };

        const freshnessVersion = getDiscoveryFreshnessVersion();
        writeRuntimeCache<HomeDiscoveryCache>(localizedCacheKey, nextState, { version: freshnessVersion });
        void writePersistedRuntimeCache<HomeDiscoveryCache>(localizedCacheKey, nextState, { version: freshnessVersion });

        startTransition(() => {
          setFranchises(franchiseData);
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load discovery feed.";
      if (!hasDiscoveryData) {
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getDiscoveryFreshnessVersion, hasDiscoveryData, localizedCacheKey]);

  useEffect(() => {
    let active = true;

    void getFranchiseCollections()
      .then((cachedCollections) => {
        if (!active || cachedCollections.length === 0) {
          return;
        }

        setFranchises(cachedCollections);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useRuntimeCacheAutoRefresh({
    entry: discoveryCacheEntry,
    maxAgeMs: HOME_DISCOVERY_CACHE_TTL_MS,
    getExpectedVersion: getDiscoveryFreshnessVersion,
    enabled: hasHydratedPersistentCache,
    onRefresh: (hasCachedValue) => loadDiscovery(hasCachedValue),
  });

  useEffect(() => {
    let active = true;

    void refreshFranchiseCollections()
      .then((freshCollections) => {
        if (!active) return;
        setFranchises((currentCollections) => {
          const currentSignature = JSON.stringify(
            currentCollections.map((item) => [
              item.id,
              item.title,
              item.sortOrder,
              item.totalEntries,
              item.accentColor,
            ])
          );
          const freshSignature = JSON.stringify(
            freshCollections.map((item) => [
              item.id,
              item.title,
              item.sortOrder,
              item.totalEntries,
              item.accentColor,
            ])
          );
          return currentSignature === freshSignature ? currentCollections : freshCollections;
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const spotlightItems = useMemo(() => {
    const pool = popularMovies.length > 0 ? popularMovies : [...trendingMovies, ...trendingSeries];
    return pool.filter((i) => i.backdropPath).slice(0, 10);
  }, [popularMovies, trendingMovies, trendingSeries]);
  const handleOpenTrendingMovie = useCallback((item: MediaItem) => {
    navigation.navigate("MovieDetail", { movieId: String(item.id) });
  }, [navigation]);
  const handleOpenTrendingSeries = useCallback((item: MediaItem) => {
    navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
  }, [navigation]);
  const franchiseRailItems = useMemo(
    () =>
      franchises.map((item) => ({
        id: item.id as unknown as number,
        title: formatFranchiseCollectionTitle(item.title, language),
        posterPath: "",
        backdropPath: null,
        mediaType: "movie" as const,
        rating: 0,
        overview: item.description || "",
        year: t("franchise.titleCount", { count: item.totalEntries }),
        originalTitle: item.title,
        accentColor: item.accentColor,
      })),
    [franchises, language, t]
  );
  const renderFranchiseRailItem = useCallback(
    ({ item }: { item: (typeof franchiseRailItems)[number] }) => (
      <RailCardWrap>
        <FranchiseCardRoot
          onPress={() => {
            navigation.navigate("FranchiseTimeline", {
              franchiseId: String(item.id),
              franchiseTitle: item.originalTitle,
              accentColor: item.accentColor ?? undefined,
            });
          }}
          onPressIn={() => prefetchFranchiseEntries(String(item.id))}
          style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <FranchiseArtworkFrame>
            <FranchiseCollectionArtwork title={item.originalTitle} accentColor={item.accentColor} compact />
          </FranchiseArtworkFrame>
          <FranchiseCardTitle numberOfLines={1}>{item.title}</FranchiseCardTitle>
          <FranchiseCardMeta>{item.year}</FranchiseCardMeta>
        </FranchiseCardRoot>
      </RailCardWrap>
    ),
    [navigation]
  );

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
          <MovieLoader label={t("loaders.loadingReels")} />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Layout keyboardShouldPersistTaps="handled">
        <Content>
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
            title={t("home.trendingMovies")}
            data={trendingMovies}
            onPressItem={handleOpenTrendingMovie}
            onPressSeeAll={() => {
              navigation.navigate("DiscoverGrid", {
                source: "trending_movies",
                title: t("home.trendingMovies")
              });
            }}
          />
          <DiscoveryRail
            title={t("home.trendingSeries")}
            data={trendingSeries}
            onPressItem={handleOpenTrendingSeries}
            onPressSeeAll={() => {
              navigation.navigate("DiscoverGrid", {
                source: "trending_series",
                title: t("home.trendingSeries")
              });
            }}
          />
          {/* Cinematic Journeys - Franchise Roadmaps */}
          {franchises.length > 0 && (
            <>
              <SectionHeader>
                <SectionTitle>{t("home.cinematicJourneys")}</SectionTitle>
                <SectionLinkButton
                  onPress={() => navigation.navigate("FranchiseCatalog")}
                  style={({ pressed }: { pressed: boolean }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <SectionLink>{t("common.seeAll")}</SectionLink>
                </SectionLinkButton>
              </SectionHeader>
              <RailWrap>
                <FlatList
                  data={franchiseRailItems}
                  horizontal
                  initialNumToRender={4}
                  maxToRenderPerBatch={4}
                  windowSize={3}
                  removeClippedSubviews
                  keyExtractor={(item) => String(item.id)}
                  renderItem={renderFranchiseRailItem}
                  showsHorizontalScrollIndicator={false}
                />
              </RailWrap>
            </>
          )}

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
