import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, memo, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  getImdbTop250Page,
  getPopular,
  getTmdbImageUrl,
  getTrending,
  type MediaItem,
} from "../../api/tmdb";
import {
  getFranchiseCollections,
  prefetchFranchiseEntries,
  refreshFranchiseCollections,
  type FranchiseCollection,
} from "../../api/franchises";
import { TVMediaTile } from "../../components/tv/TVMediaTile";
import { franchiseCardBackgroundImage } from "../../constants/imageAssets";
import { useAuth } from "../../context/AuthContext";
import type { TVStackParamList } from "../../navigation/TVNavigation";
import { formatFranchiseCollectionTitle } from "../../services/franchiseLocalization";
import {
  readRuntimeCache,
  writePersistedRuntimeCache,
  writeRuntimeCache,
} from "../../services/runtimeCache";
import { useAppSettings } from "../../settings/AppSettingsContext";

type TVHomeScreenProps = NativeStackScreenProps<TVStackParamList, "TVHome">;

type TVHomeCache = {
  hero: MediaItem[];
  movies: MediaItem[];
  series: MediaItem[];
  imdb: MediaItem[];
};

const TV_HOME_CACHE_KEY = "tv-home-v1";

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Header = styled.View`
  position: absolute;
  top: 34px;
  left: 56px;
  right: 56px;
  z-index: 5;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const Brand = styled.View`
  flex-direction: row;
  align-items: center;
`;

const BrandIcon = styled.Image`
  width: 42px;
  height: 42px;
  margin-right: 12px;
`;

const BrandText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 28px;
  letter-spacing: -0.6px;
`;

const SearchButton = styled.Pressable<{ $focused: boolean }>`
  min-width: 260px;
  height: 54px;
  border-radius: 18px;
  flex-direction: row;
  align-items: center;
  padding: 0 20px;
  gap: 10px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: ${({ $focused }) => ($focused ? 3 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const SearchText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: 18px;
`;

const Body = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
})`
  flex: 1;
`;

const Hero = styled.Pressable<{ $focused: boolean }>`
  height: 430px;
  margin-bottom: 26px;
  overflow: hidden;
  border-bottom-width: 1px;
  border-color: ${({ theme }) => theme.colors.borderSoft};
`;

const HeroImage = styled.Image`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

const HeroShade = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const HeroContent = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 0 72px 52px;
`;

const HeroBadge = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_700Bold;
  font-size: 14px;
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const HeroTitle = styled.Text`
  margin-top: 10px;
  max-width: 620px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 56px;
  line-height: 62px;
  letter-spacing: -1.2px;
`;

const HeroOverview = styled.Text`
  margin-top: 14px;
  max-width: 700px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 20px;
  line-height: 30px;
`;

const HeroCta = styled.View<{ $focused: boolean }>`
  margin-top: 24px;
  width: 190px;
  height: 58px;
  border-radius: 17px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 9px;
  background-color: ${({ theme }) => theme.colors.primary};
  border-width: ${({ $focused }) => ($focused ? 3 : 0)}px;
  border-color: rgba(255, 255, 255, 0.85);
`;

const HeroCtaText = styled.Text`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 20px;
`;

const Section = styled.View`
  margin-bottom: 34px;
`;

const SectionTitle = styled.Text`
  margin: 0 0 16px 72px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 32px;
  line-height: 38px;
  letter-spacing: -0.7px;
`;

const RowList = styled.View`
  height: 270px;
  padding-left: 72px;
`;

const FranchiseImage = styled.ImageBackground`
  width: 100%;
  height: 100%;
`;

const FranchiseOverlay = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 18px;
  background-color: rgba(0, 0, 0, 0.28);
`;

const FranchiseTitle = styled.Text`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 22px;
`;

const FranchiseMeta = styled.Text`
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.72);
  font-family: Outfit_500Medium;
  font-size: 15px;
`;

const FranchiseTile = styled.Pressable<{ $focused: boolean }>`
  width: 320px;
  height: 180px;
  margin-right: 22px;
  border-radius: 22px;
  overflow: hidden;
  border-width: ${({ $focused }) => ($focused ? 4 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const LoadingPanel = styled.View`
  height: 260px;
  align-items: center;
  justify-content: center;
`;

const LoadingText = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 18px;
`;

const ErrorPanel = styled.View`
  margin: 92px 72px 0;
  padding: 28px;
  border-radius: 24px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const ErrorText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 20px;
`;

const RetryButton = styled.Pressable<{ $focused: boolean }>`
  margin-top: 18px;
  width: 150px;
  height: 52px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
  border-width: ${({ $focused }) => ($focused ? 3 : 0)}px;
  border-color: rgba(255, 255, 255, 0.85);
`;

const RetryText = styled.Text`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 18px;
`;

function openItem(navigation: TVHomeScreenProps["navigation"], item: MediaItem) {
  navigation.navigate("TVDetail", {
    mediaType: item.mediaType,
    id: String(item.id),
  });
}

type TVFranchiseTileProps = {
  item: FranchiseCollection & { localizedTitle: string };
  onPress: () => void;
};

const TVFranchiseTile = memo(function TVFranchiseTile({ item, onPress }: TVFranchiseTileProps) {
  const [focused, setFocused] = useState(false);

  return (
    <FranchiseTile
      focusable
      $focused={focused}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
    >
      <FranchiseImage source={franchiseCardBackgroundImage} resizeMode="cover">
        <FranchiseOverlay>
          <FranchiseTitle numberOfLines={1}>{item.localizedTitle}</FranchiseTitle>
          <FranchiseMeta>{item.totalEntries} titles</FranchiseMeta>
        </FranchiseOverlay>
      </FranchiseImage>
    </FranchiseTile>
  );
});

export function TVHomeScreen({ navigation }: TVHomeScreenProps) {
  const theme = useTheme();
  const { language } = useAppSettings();
  const { user } = useAuth();
  const cacheKey = `${TV_HOME_CACHE_KEY}:${language}`;
  const cached = readRuntimeCache<TVHomeCache>(cacheKey)?.value;
  const [searchFocused, setSearchFocused] = useState(false);
  const [heroFocused, setHeroFocused] = useState(false);
  const [retryFocused, setRetryFocused] = useState(false);
  const [hero, setHero] = useState<MediaItem[]>(cached?.hero ?? []);
  const [movies, setMovies] = useState<MediaItem[]>(cached?.movies ?? []);
  const [series, setSeries] = useState<MediaItem[]>(cached?.series ?? []);
  const [imdb, setImdb] = useState<MediaItem[]>(cached?.imdb ?? []);
  const [franchises, setFranchises] = useState<FranchiseCollection[]>([]);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const selectedHero = hero[0] ?? movies[0] ?? series[0] ?? null;
  const selectedHeroImage = getTmdbImageUrl(selectedHero?.backdropPath ?? selectedHero?.posterPath ?? null, "original");

  const load = useCallback(async () => {
    setError(null);
    if (!movies.length && !series.length) {
      setLoading(true);
    }

    try {
      const [popular, trendingMovies, trendingSeries, imdbPage, franchiseList] = await Promise.all([
        getPopular(),
        getTrending("movie"),
        getTrending("tv"),
        getImdbTop250Page(1).then((page) => page.items),
        refreshFranchiseCollections().catch(() => getFranchiseCollections()),
      ]);

      const nextCache = {
        hero: popular.filter((item) => item.backdropPath).slice(0, 8),
        movies: trendingMovies.filter((item) => item.backdropPath || item.posterPath).slice(0, 20),
        series: trendingSeries.filter((item) => item.backdropPath || item.posterPath).slice(0, 20),
        imdb: imdbPage.filter((item) => item.backdropPath || item.posterPath).slice(0, 20),
      };

      writeRuntimeCache(cacheKey, nextCache);
      void writePersistedRuntimeCache(cacheKey, nextCache);
      setHero(nextCache.hero);
      setMovies(nextCache.movies);
      setSeries(nextCache.series);
      setImdb(nextCache.imdb);
      setFranchises(franchiseList.slice(0, 16));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load TV home.");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, movies.length, series.length]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      franchises.slice(0, 6).forEach((item) => prefetchFranchiseEntries(item.id, user?.id));
    }, 1200);

    return () => clearTimeout(timer);
  }, [franchises, user?.id]);

  const renderMedia = useCallback(
    ({ item, index }: ListRenderItemInfo<MediaItem>) => (
      <TVMediaTile
        item={item}
        preferredFocus={index === 0 && !selectedHero}
        onPress={() => openItem(navigation, item)}
      />
    ),
    [navigation, selectedHero]
  );

  const franchiseItems = useMemo(
    () =>
      franchises.map((item) => ({
        ...item,
        localizedTitle: formatFranchiseCollectionTitle(item.title, language),
      })),
    [franchises, language]
  );

  const renderFranchise = useCallback(
    ({ item }: ListRenderItemInfo<(typeof franchiseItems)[number]>) => {
      return (
        <TVFranchiseTile
          item={item}
          onPress={() => {
            navigation.navigate("FranchiseTimeline", {
              franchiseId: item.id,
              franchiseTitle: item.title,
              accentColor: item.accentColor ?? undefined,
            });
          }}
        />
      );
    },
    [navigation]
  );

  return (
    <Root>
      <Header>
        <Brand>
          <BrandIcon source={require("../../../assets/app-icons/adaptive-foreground.png")} resizeMode="contain" />
          <BrandText>StreamBox TV</BrandText>
        </Brand>
        <SearchButton
          focusable
          $focused={searchFocused}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onPress={() => navigation.navigate("TVSearch")}
        >
          <Feather name="search" size={21} color={searchFocused ? theme.colors.primary : theme.colors.textSecondary} />
          <SearchText>Search movies & series</SearchText>
        </SearchButton>
      </Header>

      <Body>
        {selectedHero ? (
          <Hero
            focusable
            hasTVPreferredFocus
            $focused={heroFocused}
            onFocus={() => setHeroFocused(true)}
            onBlur={() => setHeroFocused(false)}
            onPress={() => openItem(navigation, selectedHero)}
          >
            {selectedHeroImage ? <HeroImage source={{ uri: selectedHeroImage }} resizeMode="cover" /> : null}
            <HeroShade colors={["rgba(13,16,15,0.20)", "rgba(13,16,15,0.72)", "#0D100F"]} />
            <HeroContent>
              <HeroBadge>Featured tonight</HeroBadge>
              <HeroTitle numberOfLines={2}>{selectedHero.title}</HeroTitle>
              <HeroOverview numberOfLines={2}>{selectedHero.overview}</HeroOverview>
              <HeroCta $focused={heroFocused}>
                <Feather name="play" size={22} color="#FFFFFF" />
                <HeroCtaText>Open</HeroCtaText>
              </HeroCta>
            </HeroContent>
          </Hero>
        ) : null}

        {loading && !selectedHero ? (
          <LoadingPanel>
            <ActivityIndicator color={theme.colors.primary} size="large" />
            <LoadingText>Loading StreamBox TV</LoadingText>
          </LoadingPanel>
        ) : null}

        {error && !movies.length && !series.length ? (
          <ErrorPanel>
            <ErrorText>{error}</ErrorText>
            <RetryButton
              focusable
              $focused={retryFocused}
              onFocus={() => setRetryFocused(true)}
              onBlur={() => setRetryFocused(false)}
              onPress={() => void load()}
            >
              <RetryText>Retry</RetryText>
            </RetryButton>
          </ErrorPanel>
        ) : null}

        {movies.length > 0 ? (
          <Section>
            <SectionTitle>Trending movies</SectionTitle>
            <RowList>
              <FlashList
                horizontal
                data={movies}
                keyExtractor={(item) => `movie-${item.id}`}
                renderItem={renderMedia}
                showsHorizontalScrollIndicator={false}
              />
            </RowList>
          </Section>
        ) : null}

        {series.length > 0 ? (
          <Section>
            <SectionTitle>Trending series</SectionTitle>
            <RowList>
              <FlashList
                horizontal
                data={series}
                keyExtractor={(item) => `tv-${item.id}`}
                renderItem={renderMedia}
                showsHorizontalScrollIndicator={false}
              />
            </RowList>
          </Section>
        ) : null}

        {imdb.length > 0 ? (
          <Section>
            <SectionTitle>IMDb Top 250</SectionTitle>
            <RowList>
              <FlashList
                horizontal
                data={imdb}
                keyExtractor={(item) => `imdb-${item.id}`}
                renderItem={renderMedia}
                showsHorizontalScrollIndicator={false}
              />
            </RowList>
          </Section>
        ) : null}

        {franchiseItems.length > 0 ? (
          <Section>
            <SectionTitle>Cinematic journeys</SectionTitle>
            <RowList>
              <FlashList
                horizontal
                data={franchiseItems}
                keyExtractor={(item) => item.id}
                renderItem={renderFranchise}
                showsHorizontalScrollIndicator={false}
              />
            </RowList>
          </Section>
        ) : null}
      </Body>
    </Root>
  );
}
