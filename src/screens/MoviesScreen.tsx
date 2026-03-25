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
  getImdbTop250Page,
  getTmdbImageUrl,
  getTopNewMoviesPage,
  resolveTmdbMovieIdFromImdbId
} from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { MediaCard } from "../components/home/MediaCard";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { HomeStackParamList } from "../navigation/types";
import { getPersonalizedMovieOfTheDay } from "../services/movieOfDayService";
import { isRuntimeCacheFresh, readRuntimeCache, writeRuntimeCache } from "../services/runtimeCache";

const MOVIES_HUB_CACHE_KEY = "movies-hub-v1";
const MOVIES_HUB_CACHE_TTL_MS = 1000 * 60 * 20;

type MoviesHubCache = {
  movieOfDay: MediaItem | null;
  topNewMovies: MediaItem[];
  imdbTopMovies: MediaItem[];
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

type MoviesScreenProps = NativeStackScreenProps<HomeStackParamList, "MoviesFeed">;

type RailSectionProps = {
  title: string;
  items: MediaItem[];
  onPressItem: (item: MediaItem) => void;
  onPressSeeAll: () => void;
};

function mergeUnique(existing: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const keys = new Set<number | string>(existing.map((item) => item.id));
  const merged = existing.slice();

  incoming.forEach((item) => {
    if (!keys.has(item.id)) {
      keys.add(item.id);
      merged.push(item);
    }
  });

  return merged;
}

async function seedTopNewMovies(minimumCount: number, initialPage?: SeedPageResponse): Promise<MediaItem[]> {
  const firstPage = initialPage ?? await getTopNewMoviesPage(1);
  let pool = mergeUnique([], firstPage.items);

  if (pool.length >= minimumCount || firstPage.totalPages <= 1) {
    return pool;
  }

  const pagesToFetch = Array.from(
    { length: Math.min(firstPage.totalPages, 5) - 1 },
    (_, index) => index + 2
  );

  const responses = await Promise.all(pagesToFetch.map((page) => getTopNewMoviesPage(page)));
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

export function MoviesScreen({ navigation }: MoviesScreenProps) {
  const cacheRef = useRef(readRuntimeCache<MoviesHubCache>(MOVIES_HUB_CACHE_KEY));
  const cachedHub = cacheRef.current?.value;
  const currentTheme = useTheme();
  const { likedMovies, isLoading: isLikedMoviesLoading } = useLikedMovies();
  const [movieOfDay, setMovieOfDay] = useState<MediaItem | null>(cachedHub?.movieOfDay ?? null);
  const [topNewMovies, setTopNewMovies] = useState<MediaItem[]>(cachedHub?.topNewMovies ?? []);
  const [imdbTopMovies, setImdbTopMovies] = useState<MediaItem[]>(cachedHub?.imdbTopMovies ?? []);
  const [isLoading, setIsLoading] = useState(!cachedHub);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sweep = useSharedValue(0);

  const hasHubData = topNewMovies.length > 0 || imdbTopMovies.length > 0 || movieOfDay !== null;

  const applyHubState = useCallback((nextState: MoviesHubCache) => {
    writeRuntimeCache<MoviesHubCache>(MOVIES_HUB_CACHE_KEY, nextState);
    startTransition(() => {
      setMovieOfDay(nextState.movieOfDay);
      setTopNewMovies(nextState.topNewMovies);
      setImdbTopMovies(nextState.imdbTopMovies);
      setErrorMessage(null);
    });
  }, []);

  const loadMoviesData = useCallback(async (background = false) => {
    if (isLikedMoviesLoading) {
      return;
    }

    if (!background && !hasHubData) {
      setIsLoading(true);
    }

    try {
      const [featured, topNewFirstPage, imdbTop] = await Promise.all([
        getPersonalizedMovieOfTheDay(likedMovies.filter((id): id is number => typeof id === "number")),
        getTopNewMoviesPage(1),
        getImdbTop250Page(1)
      ]);

      const initialState: MoviesHubCache = {
        movieOfDay: featured,
        topNewMovies: topNewFirstPage.items.slice(0, 20),
        imdbTopMovies: imdbTop.items.slice(0, 20),
      };
      applyHubState(initialState);

      if (topNewFirstPage.items.length < 16 && topNewFirstPage.totalPages > 1) {
        const expandedTopNew = await seedTopNewMovies(16, topNewFirstPage);
        if (expandedTopNew.length > initialState.topNewMovies.length) {
          applyHubState({
            ...initialState,
            topNewMovies: expandedTopNew.slice(0, 20),
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load movie hub.";
      if (!hasHubData) {
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyHubState, hasHubData, isLikedMoviesLoading, likedMovies]);

  useEffect(() => {
    if (isLikedMoviesLoading) {
      return;
    }

    const isFresh = isRuntimeCacheFresh(cacheRef.current, MOVIES_HUB_CACHE_TTL_MS);
    if (isFresh) {
      return;
    }

    void loadMoviesData(Boolean(cachedHub));
  }, [cachedHub, isLikedMoviesLoading, loadMoviesData]);

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
    if (!movieOfDay) {
      return null;
    }
    return getTmdbImageUrl(movieOfDay.backdropPath ?? movieOfDay.posterPath, "w780");
  }, [movieOfDay]);

  const openMovieDetail = useCallback(
    async (item: MediaItem) => {
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
    },
    [navigation]
  );

  if ((isLoading || isLikedMoviesLoading) && !hasHubData) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="loading movies" />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <RootScroll>
        <Content>
          <Animated.View entering={FadeInUp.duration(460).delay(60)}>
            {movieOfDay ? (
              <HeroPress
                onPress={() => {
                  navigation.navigate("MovieDetail", { movieId: String(movieOfDay.id) });
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
                  <HeroKicker>Movie of the Day</HeroKicker>
                  <HeroTitle numberOfLines={2}>{movieOfDay.title}</HeroTitle>
                  <HeroMeta>
                    <HeroMetaText>{movieOfDay.year} | </HeroMetaText>
                    <Feather name="star" size={12} color="#FFD700" />
                    <HeroMetaText> {movieOfDay.rating.toFixed(1)}</HeroMetaText>
                  </HeroMeta>
                  {movieOfDay.overview ? (
                    <HeroDescription numberOfLines={2}>{movieOfDay.overview}</HeroDescription>
                  ) : null}
                  {movieOfDay.genreIds && movieOfDay.genreIds.length > 0 ? (
                    <HeroChipRow>
                      {movieOfDay.genreIds.slice(0, 3).map((id) => GENRE_ID_MAP[id]).filter(Boolean).map((name) => (
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
                <HeroEmptyText>No movie of the day</HeroEmptyText>
              </HeroEmpty>
            )}
          </Animated.View>

          {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}

          <Animated.View entering={FadeInDown.duration(420).delay(120)}>
            <RailSection
              title="Top New Movies"
              items={topNewMovies}
              onPressItem={(item) => {
                void openMovieDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "top_new_movies",
                  title: "Top New Movies"
                });
              }}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(170)}>
            <RailSection
              title="IMDb Top 250"
              items={imdbTopMovies}
              onPressItem={(item) => {
                void openMovieDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "imdb_top_250",
                  title: "IMDb Top 250"
                });
              }}
            />
          </Animated.View>
        </Content>
      </RootScroll>
    </SafeContainer>
  );
}
