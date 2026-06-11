import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  getMovieDetails,
  getQuickSimilarMovies,
  getQuickSimilarSeries,
  getSeriesDetails,
  getSeriesSeasonEpisodes,
  getTmdbImageUrl,
  type CastMember,
  type MediaItem,
  type MovieDetails,
  type SeriesDetails,
  type SeriesEpisode,
  type SeriesSeason,
} from "../../api/tmdb";
import { TVMediaTile } from "../../components/tv/TVMediaTile";
import type { TVStackParamList } from "../../navigation/TVNavigation";

type TVDetailScreenProps = NativeStackScreenProps<TVStackParamList, "TVDetail">;

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Hero = styled.View`
  min-height: 470px;
`;

const Backdrop = styled.Image`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

const HeroShade = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const Header = styled.View`
  position: absolute;
  top: 36px;
  left: 56px;
  right: 56px;
  z-index: 4;
`;

const BackButton = styled.Pressable<{ $focused: boolean }>`
  width: 58px;
  height: 58px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background-color: rgba(15, 18, 16, 0.74);
  border-width: ${({ $focused }) => ($focused ? 3 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const HeroContent = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 112px 72px 42px;
`;

const TypeLabel = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_700Bold;
  font-size: 14px;
  letter-spacing: 2px;
  text-transform: uppercase;
`;

const Title = styled.Text`
  margin-top: 10px;
  max-width: 720px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 58px;
  line-height: 64px;
  letter-spacing: -1.2px;
`;

const Meta = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: 19px;
`;

const Overview = styled.Text`
  margin-top: 16px;
  max-width: 820px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 20px;
  line-height: 30px;
`;

const Actions = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 14px;
  margin-top: 26px;
`;

const PrimaryButton = styled.Pressable<{ $focused: boolean }>`
  min-width: 190px;
  height: 62px;
  padding: 0 22px;
  border-radius: 18px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background-color: ${({ theme }) => theme.colors.primary};
  border-width: ${({ $focused }) => ($focused ? 3 : 0)}px;
  border-color: rgba(255, 255, 255, 0.86);
`;

const ButtonText = styled.Text`
  color: #ffffff;
  font-family: Outfit_700Bold;
  font-size: 21px;
`;

const Content = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
})`
  flex: 1;
`;

const Section = styled.View`
  margin: 0 0 34px;
`;

const SectionTitle = styled.Text`
  margin: 0 0 16px 72px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 30px;
  letter-spacing: -0.6px;
`;

const Row = styled.View`
  height: 256px;
  padding-left: 72px;
`;

const ChipRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 72px;
`;

const SeasonChip = styled.Pressable<{ $active: boolean; $focused: boolean }>`
  min-width: 150px;
  height: 54px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.surfaceRaised)};
  border-width: ${({ $focused }) => ($focused ? 3 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? "#FFFFFF" : theme.colors.glassBorder)};
`;

const ChipText = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? "#FFFFFF" : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 18px;
`;

const EpisodeTile = styled.Pressable<{ $focused: boolean }>`
  width: 310px;
  margin-right: 22px;
`;

const EpisodeArt = styled.View<{ $focused: boolean }>`
  width: 310px;
  height: 174px;
  border-radius: 21px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: ${({ $focused }) => ($focused ? 4 : 1)}px;
  border-color: ${({ $focused, theme }) => ($focused ? theme.colors.primary : theme.colors.glassBorder)};
`;

const EpisodeImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const EpisodeFallback = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EpisodeTitle = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 19px;
`;

const EpisodeMeta = styled.Text`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 15px;
`;

const CastText = styled.Text`
  margin: 0 72px 26px;
  max-width: 900px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 20px;
  line-height: 30px;
`;

const Loading = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const LoadingText = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 18px;
`;

const ErrorText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: 20px;
`;

type DetailState =
  | { type: "movie"; details: MovieDetails }
  | { type: "tv"; details: SeriesDetails };

type SeasonChipButtonProps = {
  season: SeriesSeason;
  active: boolean;
  onPress: () => void;
};

function SeasonChipButton({ season, active, onPress }: SeasonChipButtonProps) {
  const [focused, setFocused] = useState(false);

  return (
    <SeasonChip
      focusable
      $active={active}
      $focused={focused}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{ transform: [{ scale: focused ? 1.04 : 1 }] }}
    >
      <ChipText $active={active}>{season.name || `Season ${season.seasonNumber}`}</ChipText>
    </SeasonChip>
  );
}

type EpisodeCardProps = {
  episode: SeriesEpisode;
  imageBase: string | null;
  onPress: () => void;
};

function EpisodeCard({ episode, imageBase, onPress }: EpisodeCardProps) {
  const [focused, setFocused] = useState(false);
  const imageUrl = getTmdbImageUrl(episode.stillPath, "w500") ?? imageBase;

  return (
    <EpisodeTile
      focusable
      $focused={focused}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
    >
      <EpisodeArt $focused={focused}>
        {imageUrl ? (
          <EpisodeImage source={{ uri: imageUrl }} resizeMode="cover" />
        ) : (
          <EpisodeFallback>
            <Feather name="play" size={30} color="rgba(255,255,255,0.55)" />
          </EpisodeFallback>
        )}
      </EpisodeArt>
      <EpisodeTitle numberOfLines={1}>{episode.name || `Episode ${episode.episodeNumber}`}</EpisodeTitle>
      <EpisodeMeta>{`S${episode.seasonNumber}:E${episode.episodeNumber}`}</EpisodeMeta>
    </EpisodeTile>
  );
}

function formatMovieMeta(details: MovieDetails) {
  const year = details.releaseDate?.slice(0, 4);
  const runtime = details.runtimeMinutes ? `${details.runtimeMinutes} min` : null;
  return [year, details.ageRating, runtime, details.genres.slice(0, 3).join(" / ")].filter(Boolean).join("  ·  ");
}

function formatSeriesMeta(details: SeriesDetails) {
  const year = details.firstAirDate?.slice(0, 4);
  const seasons = `${details.numberOfSeasons} season${details.numberOfSeasons === 1 ? "" : "s"}`;
  return [year, seasons, details.genres.slice(0, 3).join(" / ")].filter(Boolean).join("  ·  ");
}

function getCastLine(cast: CastMember[]) {
  return cast.slice(0, 8).map((member) => member.name).join(", ");
}

export function TVDetailScreen({ navigation, route }: TVDetailScreenProps) {
  const theme = useTheme();
  const params = route.params as TVStackParamList["TVDetail"];
  const [backFocused, setBackFocused] = useState(false);
  const [playFocused, setPlayFocused] = useState(false);
  const [state, setState] = useState<DetailState | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const [similar, setSimilar] = useState<MediaItem[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setEpisodes([]);
    setSimilar([]);

    async function load() {
      if (params.mediaType === "movie") {
        const details = await getMovieDetails(params.id);
        const quickSimilar = await getQuickSimilarMovies(params.id, details).catch(() => []);
        if (!active) return;
        setState({ type: "movie", details });
        setSimilar(quickSimilar);
      } else {
        const details = await getSeriesDetails(params.id);
        const firstSeason = details.seasons.find((season) => season.seasonNumber > 0) ?? details.seasons[0] ?? null;
        const [seasonEpisodes, quickSimilar] = await Promise.all([
          firstSeason ? getSeriesSeasonEpisodes(params.id, firstSeason.seasonNumber).catch(() => []) : Promise.resolve([]),
          getQuickSimilarSeries(params.id, details).catch(() => []),
        ]);
        if (!active) return;
        setState({ type: "tv", details });
        setSelectedSeason(firstSeason?.seasonNumber ?? null);
        setEpisodes(seasonEpisodes);
        setSimilar(quickSimilar);
      }
    }

    void load()
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load title.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [params.id, params.mediaType]);

  const detail = state?.details;
  const backdropUrl = getTmdbImageUrl(detail?.backdropPath ?? detail?.posterPath ?? null, "original");
  const title = detail?.title ?? "";
  const castLine = detail ? getCastLine(detail.cast) : "";
  const metadata = state?.type === "movie"
    ? formatMovieMeta(state.details)
    : state?.type === "tv"
      ? formatSeriesMeta(state.details)
      : "";

  const playMovie = useCallback(() => {
    if (!state || state.type !== "movie") return;
    const details = state.details;
    navigation.navigate("Player", {
      mediaType: "movie",
      tmdbId: String(details.id),
      title: details.title,
      originalTitle: details.originalTitle,
      imdbId: details.imdbId,
      castNames: details.cast.slice(0, 8).map((member) => member.name),
      year: details.releaseDate?.slice(0, 4) ?? null,
    });
  }, [navigation, state]);

  const playEpisode = useCallback(
    (episode: SeriesEpisode) => {
      if (!state || state.type !== "tv") return;
      const details = state.details;
      navigation.navigate("Player", {
        mediaType: "tv",
        tmdbId: String(details.id),
        title: details.title,
        originalTitle: details.originalTitle,
        imdbId: details.imdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        castNames: details.cast.slice(0, 8).map((member) => member.name),
        year: details.firstAirDate?.slice(0, 4) ?? null,
      });
    },
    [navigation, state]
  );

  const handleSeasonPress = useCallback(
    async (seasonNumber: number) => {
      if (!state || state.type !== "tv") return;
      setSelectedSeason(seasonNumber);
      const nextEpisodes = await getSeriesSeasonEpisodes(String(state.details.id), seasonNumber).catch(() => []);
      setEpisodes(nextEpisodes);
    },
    [state]
  );

  const renderEpisode = useCallback(
    ({ item }: ListRenderItemInfo<SeriesEpisode>) => (
      <EpisodeCard episode={item} imageBase={backdropUrl} onPress={() => playEpisode(item)} />
    ),
    [backdropUrl, playEpisode]
  );

  const renderSimilar = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => (
      <TVMediaTile
        item={item}
        width={300}
        onPress={() => navigation.push("TVDetail", { mediaType: item.mediaType, id: String(item.id) })}
      />
    ),
    [navigation]
  );

  const availableSeasons = useMemo(
    () => (state?.type === "tv" ? state.details.seasons.filter((season) => season.seasonNumber > 0 || season.episodeCount > 0) : []),
    [state]
  );

  if (loading) {
    return (
      <Root>
        <Loading>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <LoadingText>Loading title</LoadingText>
        </Loading>
      </Root>
    );
  }

  if (!state || error) {
    return (
      <Root>
        <Header>
          <BackButton
            focusable
            hasTVPreferredFocus
            $focused={backFocused}
            onFocus={() => setBackFocused(true)}
            onBlur={() => setBackFocused(false)}
            onPress={() => navigation.goBack()}
          >
            <Feather name="arrow-left" size={27} color={theme.colors.textPrimary} />
          </BackButton>
        </Header>
        <Loading>
          <ErrorText>{error ?? "Title not found."}</ErrorText>
        </Loading>
      </Root>
    );
  }

  return (
    <Root>
      <Content>
        <Hero>
          {backdropUrl ? <Backdrop source={{ uri: backdropUrl }} resizeMode="cover" /> : null}
          <HeroShade colors={["rgba(13,16,15,0.14)", "rgba(13,16,15,0.70)", "#0D100F"]} />
          <Header>
            <BackButton
              focusable
              $focused={backFocused}
              onFocus={() => setBackFocused(true)}
              onBlur={() => setBackFocused(false)}
              onPress={() => navigation.goBack()}
            >
              <Feather name="arrow-left" size={27} color={backFocused ? theme.colors.primary : theme.colors.textPrimary} />
            </BackButton>
          </Header>
          <HeroContent>
            <TypeLabel>{state.type === "movie" ? "Movie" : "Series"}</TypeLabel>
            <Title numberOfLines={2}>{title}</Title>
            <Meta>{metadata}</Meta>
            <Overview numberOfLines={3}>{state.details.overview}</Overview>
            {state.type === "movie" ? (
              <Actions>
                <PrimaryButton
                  focusable
                  hasTVPreferredFocus
                  $focused={playFocused}
                  onFocus={() => setPlayFocused(true)}
                  onBlur={() => setPlayFocused(false)}
                  onPress={playMovie}
                >
                  <Feather name="play" size={22} color="#FFFFFF" />
                  <ButtonText>Watch now</ButtonText>
                </PrimaryButton>
              </Actions>
            ) : null}
          </HeroContent>
        </Hero>

        {castLine ? (
          <Section>
            <SectionTitle>Cast</SectionTitle>
            <CastText>{castLine}</CastText>
          </Section>
        ) : null}

        {state.type === "tv" && availableSeasons.length > 0 ? (
          <Section>
            <SectionTitle>Seasons</SectionTitle>
            <ChipRow>
              {availableSeasons.map((season) => (
                <SeasonChipButton
                  key={season.id}
                  season={season}
                  active={selectedSeason === season.seasonNumber}
                  onPress={() => void handleSeasonPress(season.seasonNumber)}
                />
              ))}
            </ChipRow>
          </Section>
        ) : null}

        {state.type === "tv" && episodes.length > 0 ? (
          <Section>
            <SectionTitle>Episodes</SectionTitle>
            <Row>
              <FlashList
                horizontal
                data={episodes}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderEpisode}
                showsHorizontalScrollIndicator={false}
              />
            </Row>
          </Section>
        ) : null}

        {similar.length > 0 ? (
          <Section>
            <SectionTitle>More like this</SectionTitle>
            <Row>
              <FlashList
                horizontal
                data={similar}
                keyExtractor={(item) => `${item.mediaType}-${item.id}`}
                renderItem={renderSimilar}
                showsHorizontalScrollIndicator={false}
              />
            </Row>
          </Section>
        ) : null}
      </Content>
    </Root>
  );
}
