import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import {
  GENRE_ID_MAP,
  MediaItem,
  getImdbTop250SeriesPage,
  getSeriesOfTheDay,
  getTmdbImageUrl,
  getTopNewSeriesPage,
  resolveTmdbTvIdFromImdbId
} from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { MediaCard } from "../components/home/MediaCard";
import { HomeStackParamList } from "../navigation/types";
import { isRuntimeCacheFresh, readRuntimeCache, writeRuntimeCache } from "../services/runtimeCache";

const SERIES_HUB_CACHE_KEY = "series-hub-v1";
const SERIES_HUB_CACHE_TTL_MS = 1000 * 60 * 20;

type SeriesHubCache = {
  seriesOfDay: MediaItem | null;
  topNewSeries: MediaItem[];
  imdbTopSeries: MediaItem[];
};

type SeedPageResponse = {
  items: MediaItem[];
  totalPages: number;
};

const RootScroll = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false
})`
  flex: 1;
`;

const Content = styled.View`
  padding: 2px 16px 28px;
`;

const HeroPress = styled.Pressable`
  position: relative;
  height: 280px;
  border-radius: 18px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const HeroBackdrop = styled.Image`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const HeroShade = styled(LinearGradient)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
`;

const HeroContent = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 18px;
`;

const HeroKicker = styled.Text`
  color: #ffd700;
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
`;

const HeroTitle = styled.Text`
  margin-top: 8px;
  margin-right: 62px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 30px;
  line-height: 34px;
  letter-spacing: -0.8px;
`;

const HeroMeta = styled.View`
  margin-top: 8px;
  flex-direction: row;
  align-items: center;
`;

const HeroMetaText = styled.Text`
  color: rgba(255, 255, 255, 0.9);
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 16px;
`;

const HeroDescription = styled.Text`
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 17px;
`;

const HeroChipRow = styled.View`
  margin-top: 10px;
  flex-direction: row;
  gap: 6px;
`;

const HeroGenreChip = styled.View`
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  padding: 3px 8px;
`;

const HeroChipText = styled.Text`
  color: rgba(255, 255, 255, 0.85);
  font-family: Outfit_500Medium;
  font-size: 10px;
  letter-spacing: 0.3px;
`;

const HeroGlow = styled(LinearGradient)`
  position: absolute;
  width: 120px;
  height: 120px;
  right: -28px;
  bottom: -28px;
  border-radius: 60px;
`;

const SweepLight = styled(Animated.View)`
  position: absolute;
  top: -70px;
  bottom: -70px;
  width: 220px;
  opacity: 0.72;
`;

const SweepGradient = styled(LinearGradient)`
  flex: 1;
`;

const HeroEmpty = styled.View`
  height: 280px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const HeroEmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const SectionHeader = styled.View`
  margin-top: 22px;
  margin-bottom: 12px;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 20px;
  line-height: 26px;
  letter-spacing: -0.4px;
`;

const SectionLink = styled.Pressable`
  padding: 4px 2px;
`;

const SectionLinkText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 15px;
  letter-spacing: 0.2px;
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
  font-size: 13px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const ErrorText = styled.Text`
  margin-top: 9px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  text-align: center;
`;

type SeriesScreenProps = NativeStackScreenProps<HomeStackParamList, "SeriesFeed">;

type RailSectionProps = {
  title: string;
  items: MediaItem[];
  onPressItem: (item: MediaItem) => void;
  onPressSeeAll: () => void;
};

function mergeUnique(existing: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const keys = new Set(existing.map((item) => item.id));
  const merged = existing.slice();

  incoming.forEach((item) => {
    if (!keys.has(item.id)) {
      keys.add(item.id);
      merged.push(item);
    }
  });

  return merged;
}

async function seedTopNewSeries(minimumCount: number, initialPage?: SeedPageResponse): Promise<MediaItem[]> {
  const firstPage = initialPage ?? await getTopNewSeriesPage(1);
  let pool = mergeUnique([], firstPage.items);

  if (pool.length >= minimumCount || firstPage.totalPages <= 1) {
    return pool;
  }

  const pagesToFetch = Array.from(
    { length: Math.min(firstPage.totalPages, 5) - 1 },
    (_, index) => index + 2
  );

  const responses = await Promise.all(pagesToFetch.map((page) => getTopNewSeriesPage(page)));
  for (const response of responses) {
    pool = mergeUnique(pool, response.items);
    if (pool.length >= minimumCount) {
      break;
    }
  }

  return pool;
}

function RailSection({ title, items, onPressItem, onPressSeeAll }: RailSectionProps) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      return (
        <RailCardWrap>
          <MediaCard item={item} onPress={() => onPressItem(item)} />
        </RailCardWrap>
      );
    },
    [onPressItem]
  );

  return (
    <>
      <SectionHeader>
        <SectionTitle>{title}</SectionTitle>
        <SectionLink onPress={onPressSeeAll}>
          <SectionLinkText>See all</SectionLinkText>
        </SectionLink>
      </SectionHeader>
      {items.length === 0 ? (
        <EmptyRail>
          <EmptyRailText>No results in this rail</EmptyRailText>
        </EmptyRail>
      ) : (
        <RailWrap>
          <FlashList
            data={items}
            horizontal
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
          />
        </RailWrap>
      )}
    </>
  );
}

export function SeriesScreen({ navigation }: SeriesScreenProps) {
  const cacheRef = useRef(readRuntimeCache<SeriesHubCache>(SERIES_HUB_CACHE_KEY));
  const cachedHub = cacheRef.current?.value;
  const currentTheme = useTheme();
  const [seriesOfDay, setSeriesOfDay] = useState<MediaItem | null>(cachedHub?.seriesOfDay ?? null);
  const [topNewSeries, setTopNewSeries] = useState<MediaItem[]>(cachedHub?.topNewSeries ?? []);
  const [imdbTopSeries, setImdbTopSeries] = useState<MediaItem[]>(cachedHub?.imdbTopSeries ?? []);
  const [isLoading, setIsLoading] = useState(!cachedHub);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sweep = useSharedValue(0);

  const hasHubData = topNewSeries.length > 0 || imdbTopSeries.length > 0 || seriesOfDay !== null;

  const applyHubState = useCallback((nextState: SeriesHubCache) => {
    writeRuntimeCache<SeriesHubCache>(SERIES_HUB_CACHE_KEY, nextState);
    startTransition(() => {
      setSeriesOfDay(nextState.seriesOfDay);
      setTopNewSeries(nextState.topNewSeries);
      setImdbTopSeries(nextState.imdbTopSeries);
      setErrorMessage(null);
    });
  }, []);

  const loadSeriesData = useCallback(async (background = false) => {
    if (!background && !hasHubData) {
      setIsLoading(true);
    }

    try {
      const [featured, topNewFirstPage, imdbTop] = await Promise.all([
        getSeriesOfTheDay(),
        getTopNewSeriesPage(1),
        getImdbTop250SeriesPage(1)
      ]);

      const initialState: SeriesHubCache = {
        seriesOfDay: featured,
        topNewSeries: topNewFirstPage.items.slice(0, 20),
        imdbTopSeries: imdbTop.items.slice(0, 20),
      };
      applyHubState(initialState);

      if (topNewFirstPage.items.length < 16 && topNewFirstPage.totalPages > 1) {
        const expandedTopNew = await seedTopNewSeries(16, topNewFirstPage);
        if (expandedTopNew.length > initialState.topNewSeries.length) {
          applyHubState({
            ...initialState,
            topNewSeries: expandedTopNew.slice(0, 20),
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load series hub.";
      if (!hasHubData) {
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyHubState, hasHubData]);

  useEffect(() => {
    const isFresh = isRuntimeCacheFresh(cacheRef.current, SERIES_HUB_CACHE_TTL_MS);
    if (isFresh) {
      return;
    }

    void loadSeriesData(Boolean(cachedHub));
  }, [cachedHub, loadSeriesData]);

  useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, {
        duration: 4200,
        easing: Easing.inOut(Easing.quad)
      }),
      -1,
      true
    );
  }, [sweep]);

  const sweepAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateX: interpolate(sweep.value, [0, 1], [-210, 210])
        },
        {
          rotate: "-16deg"
        }
      ]
    };
  });

  const heroBackdropUri = useMemo(() => {
    if (!seriesOfDay) {
      return null;
    }
    return getTmdbImageUrl(seriesOfDay.backdropPath ?? seriesOfDay.posterPath, "w780");
  }, [seriesOfDay]);

  const openSeriesDetail = useCallback(
    async (item: MediaItem) => {
      if (item.posterPath || item.backdropPath) {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
        return;
      }

      if (item.imdbId) {
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

  if (isLoading && !hasHubData) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="loading series" />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <RootScroll>
        <Content>
          <Animated.View entering={FadeInUp.duration(460).delay(60)}>
            {seriesOfDay ? (
              <HeroPress
                onPress={() => {
                  void openSeriesDetail(seriesOfDay);
                }}
              >
                {heroBackdropUri ? <HeroBackdrop source={{ uri: heroBackdropUri }} resizeMode="cover" /> : null}
                <HeroShade colors={["rgba(0,0,0,0.08)", "rgba(0,0,0,0.88)"]} />
                <SweepLight style={sweepAnimatedStyle}>
                  <SweepGradient
                    colors={["rgba(255,255,255,0.00)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0.00)"]}
                    locations={[0, 0.5, 1]}
                  />
                </SweepLight>
                <HeroGlow colors={[currentTheme.colors.primaryGlow, currentTheme.colors.primaryTransparent]} />

                <HeroContent>
                  <HeroKicker>Series of the Day</HeroKicker>
                  <HeroTitle numberOfLines={2}>{seriesOfDay.title}</HeroTitle>
                  <HeroMeta>
                    <HeroMetaText>{seriesOfDay.year} | </HeroMetaText>
                    <Feather name="star" size={12} color="#FFD700" />
                    <HeroMetaText> {seriesOfDay.rating.toFixed(1)}</HeroMetaText>
                  </HeroMeta>
                  {seriesOfDay.overview ? (
                    <HeroDescription numberOfLines={2}>{seriesOfDay.overview}</HeroDescription>
                  ) : null}
                  {seriesOfDay.genreIds && seriesOfDay.genreIds.length > 0 ? (
                    <HeroChipRow>
                      {seriesOfDay.genreIds.slice(0, 3).map((id) => GENRE_ID_MAP[id]).filter(Boolean).map((name) => (
                        <HeroGenreChip key={name}>
                          <HeroChipText>{name}</HeroChipText>
                        </HeroGenreChip>
                      ))}
                    </HeroChipRow>
                  ) : null}
                </HeroContent>
              </HeroPress>
            ) : (
              <HeroEmpty>
                <HeroEmptyText>No series of the day</HeroEmptyText>
              </HeroEmpty>
            )}
          </Animated.View>

          {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}

          <Animated.View entering={FadeInDown.duration(420).delay(120)}>
            <RailSection
              title="Top New Series"
              items={topNewSeries}
              onPressItem={(item) => {
                void openSeriesDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "top_new_series",
                  title: "Top New Series"
                });
              }}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(170)}>
            <RailSection
              title="IMDb Top 250 Series"
              items={imdbTopSeries}
              onPressItem={(item) => {
                void openSeriesDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "imdb_top_250_series",
                  title: "IMDb Top 250 Series"
                });
              }}
            />
          </Animated.View>
        </Content>
      </RootScroll>
    </SafeContainer>
  );
}
