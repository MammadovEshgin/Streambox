import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
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
import { formatRating, isValidMediaItem, isValidMediaItemArray } from "../api/mediaFormatting";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { MediaCard } from "../components/home/MediaCard";
import { useRuntimeCacheAutoRefresh } from "../hooks/useRuntimeCacheAutoRefresh";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { HomeStackParamList } from "../navigation/types";
import { useAuth } from "../context/AuthContext";
import { getLocalDateFreshnessKey } from "../services/contentFreshness";
import { getPersonalizedMovieOfTheDay } from "../services/movieOfDayService";
import {
  readPersistedRuntimeCache,
  readRuntimeCache,
  writePersistedRuntimeCache,
  writeRuntimeCache,
} from "../services/runtimeCache";
import { useAppSettings } from "../settings/AppSettingsContext";

const MOVIES_HUB_CACHE_KEY = "movies-hub-v1";
const MOVIES_HUB_CACHE_TTL_MS = 1000 * 60 * 20;

type MoviesHubCache = {
  movieOfDay: MediaItem | null;
  topNewMovies: MediaItem[];
  imdbTopMovies: MediaItem[];
};

function isValidMoviesHubCache(value: unknown): value is MoviesHubCache {
  if (!value || typeof value !== "object") {
    return false;
  }

  const cache = value as Partial<MoviesHubCache>;
  return (
    (cache.movieOfDay === null || isValidMediaItem(cache.movieOfDay))
    && isValidMediaItemArray(cache.topNewMovies)
    && isValidMediaItemArray(cache.imdbTopMovies)
  );
}

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
  margin-top: 28px;
  margin-bottom: 14px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const SectionLink = styled.Pressable`
  padding: 4px 2px;
`;

const SectionLinkText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
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

const RailSection = memo(function RailSection({ title, items, onPressItem, onPressSeeAll }: RailSectionProps) {
  const { t } = useTranslation();
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
          <SectionLinkText>{t("common.seeAll")}</SectionLinkText>
        </SectionLink>
      </SectionHeader>
      {items.length === 0 ? (
        <EmptyRail>
          <EmptyRailText>{t("discover.noTitlesFound")}</EmptyRailText>
        </EmptyRail>
      ) : (
        <RailWrap>
          <FlashList
            data={items}
            horizontal
            keyExtractor={(item) => `${item.mediaType}-${item.id}`}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
            removeClippedSubviews
          />
        </RailWrap>
      )}
    </>
  );
});

export function MoviesScreen({ navigation }: MoviesScreenProps) {
  const { language } = useAppSettings();
  const localizedCacheKey = `${MOVIES_HUB_CACHE_KEY}:${language}`;
  const hubCacheEntry = readRuntimeCache<MoviesHubCache>(localizedCacheKey);
  const cachedHub = hubCacheEntry?.value;
  const currentTheme = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { likedMovies, isLoading: isLikedMoviesLoading } = useLikedMovies();
  const { history, isLoading: isWatchHistoryLoading } = useWatchHistory();
  const [movieOfDay, setMovieOfDay] = useState<MediaItem | null>(cachedHub?.movieOfDay ?? null);
  const [topNewMovies, setTopNewMovies] = useState<MediaItem[]>(cachedHub?.topNewMovies ?? []);
  const [imdbTopMovies, setImdbTopMovies] = useState<MediaItem[]>(cachedHub?.imdbTopMovies ?? []);
  const [isLoading, setIsLoading] = useState(!cachedHub);
  const [hasHydratedPersistentCache, setHasHydratedPersistentCache] = useState(Boolean(cachedHub));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const watchedMovieIds = useMemo(
    () =>
      history
        .filter((entry) => entry.mediaType === "movie")
        .map((entry) => entry.id)
        .filter((id): id is number => typeof id === "number"),
    [history]
  );
  const dailyPersonalizationVersion = useMemo(
    () =>
      [
        getLocalDateFreshnessKey(),
        user?.id ?? "anonymous",
        likedMovies.filter((id): id is number => typeof id === "number").join(","),
        watchedMovieIds.join(","),
      ].join("|"),
    [likedMovies, user?.id, watchedMovieIds]
  );
  const getMoviesHubFreshnessVersion = useCallback(() => dailyPersonalizationVersion, [dailyPersonalizationVersion]);

  const hasHubData = topNewMovies.length > 0 || imdbTopMovies.length > 0 || movieOfDay !== null;

  useEffect(() => {
    setMovieOfDay(cachedHub?.movieOfDay ?? null);
    setTopNewMovies(cachedHub?.topNewMovies ?? []);
    setImdbTopMovies(cachedHub?.imdbTopMovies ?? []);
    setErrorMessage(null);
    setIsLoading(!cachedHub);
  }, [cachedHub, language]);

  useEffect(() => {
    let active = true;

    if (cachedHub) {
      setHasHydratedPersistentCache(true);
      return () => {
        active = false;
      };
    }

    void readPersistedRuntimeCache<MoviesHubCache>(localizedCacheKey, { validate: isValidMoviesHubCache })
      .then((entry) => {
        if (!active) {
          return;
        }

        if (entry?.value) {
          setMovieOfDay(entry.value.movieOfDay ?? null);
          setTopNewMovies(entry.value.topNewMovies ?? []);
          setImdbTopMovies(entry.value.imdbTopMovies ?? []);
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
  }, [cachedHub, localizedCacheKey]);

  const applyHubState = useCallback((nextState: MoviesHubCache) => {
    const freshnessVersion = getMoviesHubFreshnessVersion();
    writeRuntimeCache<MoviesHubCache>(localizedCacheKey, nextState, { version: freshnessVersion });
    void writePersistedRuntimeCache<MoviesHubCache>(localizedCacheKey, nextState, { version: freshnessVersion });
    startTransition(() => {
      setMovieOfDay(nextState.movieOfDay);
      setTopNewMovies(nextState.topNewMovies);
      setImdbTopMovies(nextState.imdbTopMovies);
      setErrorMessage(null);
    });
  }, [getMoviesHubFreshnessVersion, localizedCacheKey]);

  const loadMoviesData = useCallback(async (background = false) => {
    if (isLikedMoviesLoading || isWatchHistoryLoading) {
      return;
    }

    if (!background && !hasHubData) {
      setIsLoading(true);
    }

    try {
      const [featured, topNewFirstPage, imdbTop] = await Promise.all([
        getPersonalizedMovieOfTheDay({
          userId: user?.id,
          likedIds: likedMovies,
          watchedIds: watchedMovieIds,
        }),
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
  }, [applyHubState, hasHubData, isLikedMoviesLoading, isWatchHistoryLoading, likedMovies, user?.id, watchedMovieIds]);

  useRuntimeCacheAutoRefresh({
    entry: hubCacheEntry,
    maxAgeMs: MOVIES_HUB_CACHE_TTL_MS,
    getExpectedVersion: getMoviesHubFreshnessVersion,
    enabled: hasHydratedPersistentCache && !isLikedMoviesLoading && !isWatchHistoryLoading,
    onRefresh: (hasCachedValue) => loadMoviesData(hasCachedValue),
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

  if ((isLoading || isLikedMoviesLoading || isWatchHistoryLoading) && !hasHubData) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label={t("loaders.loadingMovies")} />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <RootScroll>
        <Content>
          <Animated.View entering={FadeInUp.duration(220)}>
            {movieOfDay ? (
              <HeroPress
                onPress={() => {
                  navigation.navigate("MovieDetail", { movieId: String(movieOfDay.id) });
                }}
              >
                {heroBackdropUri ? <HeroBackdrop source={{ uri: heroBackdropUri }} resizeMode="cover" /> : null}
                <HeroShade colors={["rgba(0,0,0,0.08)", "rgba(0,0,0,0.88)"]} />
                <HeroGlow colors={[currentTheme.colors.primaryGlow, currentTheme.colors.primaryTransparent]} />

                <HeroContent>
                  <HeroKicker>{t("movies.movieOfDay")}</HeroKicker>
                  <HeroTitle numberOfLines={2}>{movieOfDay.title}</HeroTitle>
                  <HeroMeta>
                    <HeroMetaText>{movieOfDay.year} | </HeroMetaText>
                    <Feather name="star" size={12} color="#FFD700" />
                    <HeroMetaText> {formatRating(movieOfDay.rating)}</HeroMetaText>
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
                <HeroEmptyText>{t("movies.noMovieOfDay")}</HeroEmptyText>
              </HeroEmpty>
            )}
          </Animated.View>

          {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}

          <Animated.View entering={FadeInDown.duration(200)}>
            <RailSection
              title={t("movies.topNewMovies")}
              items={topNewMovies}
              onPressItem={(item) => {
                void openMovieDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "top_new_movies",
                  title: t("movies.topNewMovies")
                });
              }}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(200)}>
            <RailSection
              title={t("movies.imdbTop250")}
              items={imdbTopMovies}
              onPressItem={(item) => {
                void openMovieDetail(item);
              }}
              onPressSeeAll={() => {
                navigation.navigate("DiscoverGrid", {
                  source: "imdb_top_250",
                  title: t("movies.imdbTop250")
                });
              }}
            />
          </Animated.View>
        </Content>
      </RootScroll>
    </SafeContainer>
  );
}
