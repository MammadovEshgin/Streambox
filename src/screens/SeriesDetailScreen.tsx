import { Feather } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeInRight,
  FadeOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  interpolateColor,
  runOnJS
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { View } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  MediaItem,
  SeriesDetails,
  SeriesEpisode,
  SeriesExternalRatings,
  getSeriesDetails,
  getSeriesEpisodeFallbackImagesWithImdb,
  getSeriesExternalRatings,
  getSeriesSeasonEpisodes,
  getSeriesTrailerUrl,
  getSmartSimilarSeries,
  getTmdbSeasonEpisodeFallbackImages,
  getTmdbImageUrl
} from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { RatingServiceIcon } from "../components/common/RatingServiceIcon";
import { CastCrewSection } from "../components/detail/CastCrewSection";
import { DetailHeader } from "../components/detail/DetailHeader";
import { MetaPill } from "../components/detail/MetaPill";
import { SeriesWatchedModal } from "../components/detail/SeriesWatchedModal";
import {
  formatWatchedDateLabel,
  normalizeWatchedDate
} from "../components/detail/WatchedDateModal";
import { MediaCard } from "../components/home/MediaCard";
import { useLikedSeries } from "../hooks/useLikedSeries";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useWatchedEpisodes } from "../hooks/useWatchedEpisodes";
import { useSeriesWatchlist } from "../hooks/useSeriesWatchlist";
import { HomeStackParamList } from "../navigation/types";

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const LoaderWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Body = styled.View`
  margin-top: -22px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  background-color: #000000;
  padding: 14px 16px 28px;
`;

const TopInfo = styled.View``;

const DateText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.2px;
`;

const Title = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 25px;
  line-height: 30px;
  font-weight: 800;
  letter-spacing: -0.4px;
`;

const PillsRow = styled.View`
  margin-top: 10px;
  flex-direction: row;
`;

const RatingsRow = styled.View`
  margin-top: 14px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const RatingsStrip = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 4px 0;
`;

const RatingEntry = styled.View`
  flex-direction: row;
  align-items: center;
`;

const RatingDivider = styled.View`
  width: 1px;
  height: 18px;
  margin: 0 10px;
  background-color: rgba(255, 255, 255, 0.14);
`;

const SourceValue = styled.Text`
  margin-left: 6px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.1px;
`;

const LoveButtonPress = styled.Pressable`
  margin-left: 4px;
`;

const LoveButtonBody = styled(Animated.View)`
  width: 22px;
  height: 22px;
  border-radius: 11px;
  align-items: center;
  justify-content: center;
`;

const WatchNowWrap = styled.View`
  margin-top: 14px;
`;

const ActionRow = styled.View`
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
`;

const PrimaryActionWrap = styled.View`
  flex: 1;
`;

const TopWatchButton = styled.Pressable`
  height: 50px;
  border-radius: 3px;
  background-color: ${({ theme }) => theme.colors.primary};
  flex-direction: row;
  align-items: center;
  justify-content: center;
`;

const TopWatchButtonText = styled.Text`
  margin-left: 8px;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.2px;
`;

const WatchedButton = styled.Pressable<{ $active: boolean }>`
  width: 50px;
  height: 50px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoft : theme.colors.surfaceRaised)};
  align-items: center;
  justify-content: center;
`;

const WatchedMetaText = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.15px;
`;

const SectionHeader = styled.View`
  margin-top: 22px;
  margin-bottom: 9px;
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 17px;
  line-height: 21px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const SynopsisText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
  line-height: 23px;
  text-align: justify;
`;

const ReadMoreButton = styled.Pressable`
  margin-top: 8px;
  align-self: flex-start;
`;

const ReadMoreText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
`;

const SeasonSelector = styled.ScrollView.attrs({
  horizontal: true,
  showsHorizontalScrollIndicator: false
})``;

const SeasonChip = styled.Pressable<{ $active: boolean }>`
  margin-right: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : "rgba(255,255,255,0.12)")};
  background-color: ${({ $active }) => ($active ? "rgba(255,77,0,0.14)" : "rgba(255,255,255,0.04)")};
`;

const SeasonChipText = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-size: 12px;
  line-height: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const EpisodesWrap = styled.View`
  margin-top: 10px;
`;

const EpisodeCard = styled.View`
  height: 112px;
  border-radius: 10px;
  padding: 0;
  margin-bottom: 10px;
  background-color: rgba(255, 255, 255, 0.04);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.07);
  overflow: hidden;
`;

const EpisodeWatchButton = styled.Pressable`
  flex: 1;
`;

const EpisodeRow = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: stretch;
`;

const EpisodeStillWrap = styled.View`
  width: 136px;
  align-self: stretch;
  background-color: rgba(255, 255, 255, 0.05);
  border-right-width: 1px;
  border-right-color: rgba(255, 255, 255, 0.08);
`;

const EpisodeStill = styled.Image`
  width: 100%;
  height: 100%;
`;

const EpisodeStillPlaceholder = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EpisodeStillPlaceholderText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 9px;
  letter-spacing: 0.25px;
  text-transform: uppercase;
`;

const EpisodeContent = styled.View`
  flex: 1;
  padding: 10px 12px 10px 12px;
  justify-content: flex-start;
`;

const EpisodeHead = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const EpisodeName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-weight: 700;
  letter-spacing: -0.1px;
  flex: 1;
  margin-right: 8px;
`;

const EpisodeMeta = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  line-height: 13px;
`;

const EpisodeOverview = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 16px;
`;

const EmptyEpisodes = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const CastWrap = styled.View`
  height: 200px;
`;

const SimilarWrap = styled.View`
  height: 278px;
`;

const SimilarCardWrap = styled.View`
  margin-right: 12px;
`;

const ErrorText = styled.Text`
  margin-top: 12px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

type SeriesDetailProps = NativeStackScreenProps<HomeStackParamList, "SeriesDetail">;

const StampImage = styled.Image`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  opacity: 0.85;
`;

const SwipeBackground = styled(Animated.View)`
  position: absolute;
  top: 0;
  bottom: 10px;
  left: 0;
  right: 0;
  border-radius: 10px;
  flex-direction: row;
  align-items: center;
  padding-left: 20px;
`;

interface SwipeableEpisodeCardProps {
  episode: SeriesEpisode;
  stillUri: string | null;
  isWatched: boolean;
  onToggleWatched: () => void;
  onPress: () => void;
}

function SwipeableEpisodeCard({ episode, stillUri, isWatched, onToggleWatched, onPress }: SwipeableEpisodeCardProps) {
  const currentTheme = useTheme();
  const translateX = useSharedValue(0);
  const isSwiping = useSharedValue(false);

  const SWIPE_THRESHOLD = 60;
  const MAX_SWIPE = 100;

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onStart(() => {
      isSwiping.value = true;
    })
    .onUpdate((event) => {
      // Only allow swiping to the right
      translateX.value = Math.max(0, Math.min(event.translationX, MAX_SWIPE));
    })
    .onEnd(() => {
      // If we swiped far enough to the right, trigger the toggle action
      if (translateX.value > SWIPE_THRESHOLD) {
        runOnJS(onToggleWatched)();
      }

      // Spring back to 0
      translateX.value = withSpring(0, {
        stiffness: 200,
        damping: 20
      });
      isSwiping.value = false;
    });

  const rStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }]
    };
  });

  const rBackgroundStyle = useAnimatedStyle(() => {
    // Reveal a background layer matching theme primary soft
    const opacity = translateX.value / SWIPE_THRESHOLD;
    const color = interpolateColor(
      Math.min(1, opacity),
      [0, 1],
      ["transparent", currentTheme.colors.primarySoftStrong || "rgba(255, 77, 0, 0.2)"]
    );
    return {
      backgroundColor: color
    };
  });

  const rIconStyle = useAnimatedStyle(() => {
    // Scale up the checkmark as the user pulls
    const scale = Math.max(0, Math.min(1, translateX.value / SWIPE_THRESHOLD));
    return {
      transform: [{ scale }]
    };
  });

  return (
    <View style={{ marginBottom: 10, overflow: "visible" }}>
      {/* Background layer revealed while swiping */}
      <SwipeBackground style={rBackgroundStyle}>
        <Animated.View style={rIconStyle}>
          <MaterialCommunityIcons
            name={isWatched ? "eye-off-outline" : "movie-open-outline"}
            size={32}
            color={currentTheme.colors.primary}
          />
        </Animated.View>
      </SwipeBackground>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[rStyle]}>
          <EpisodeCard style={{ marginBottom: 0 }}>
            <EpisodeWatchButton
              style={{ height: 112, borderRadius: 10, backgroundColor: "transparent" }}
              onPress={onPress}
            >
              <EpisodeRow>
                <EpisodeStillWrap>
                  {stillUri ? (
                    <EpisodeStill source={{ uri: stillUri }} resizeMode="cover" />
                  ) : (
                    <EpisodeStillPlaceholder>
                      <EpisodeStillPlaceholderText>No Still</EpisodeStillPlaceholderText>
                    </EpisodeStillPlaceholder>
                  )}
                  {/* Watched Stamp Overlay */}
                  {isWatched && (
                    <StampImage
                      source={require("../../src/assets/watched_stamp.png")}
                      resizeMode="cover"
                    />
                  )}
                </EpisodeStillWrap>
                <EpisodeContent>
                  <EpisodeHead>
                    <EpisodeName numberOfLines={1}>
                      E{episode.episodeNumber} | {episode.name}
                    </EpisodeName>
                    <EpisodeMeta>{formatEpisodeMeta(episode)}</EpisodeMeta>
                  </EpisodeHead>
                  {episode.overview ? (
                    <EpisodeOverview numberOfLines={4}>{episode.overview}</EpisodeOverview>
                  ) : null}
                </EpisodeContent>
              </EpisodeRow>
            </EpisodeWatchButton>
          </EpisodeCard>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function formatDate(value: string): string {
  if (!value) {
    return "Unknown release date";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatEpisodeMeta(item: SeriesEpisode): string {
  const segments: string[] = [];
  if (item.runtimeMinutes && item.runtimeMinutes > 0) {
    segments.push(`${item.runtimeMinutes}m`);
  }
  if (item.airDate) {
    const year = item.airDate.split("-")[0];
    if (year) {
      segments.push(year);
    }
  }
  return segments.join(" | ");
}

export function SeriesDetailScreen({ route, navigation }: SeriesDetailProps) {
  const currentTheme = useTheme();
  const { isEpisodeWatched, toggleEpisodeWatched, markSeasonWatched, unmarkSeasonWatched } = useWatchedEpisodes();
  const { isInWatchlist, removeFromWatchlist, toggleWatchlist } = useSeriesWatchlist();
  const { isLiked, toggleLikedSeries } = useLikedSeries();
  const { getWatchHistoryEntry, saveSeriesToWatchHistory, removeFromWatchHistory } = useWatchHistory();
  const [details, setDetails] = useState<SeriesDetails | null>(null);
  const [ratings, setRatings] = useState<SeriesExternalRatings | null>(null);
  const [similarSeries, setSimilarSeries] = useState<MediaItem[]>([]);
  const [episodeFallbackImages, setEpisodeFallbackImages] = useState<Record<string, string>>({});
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isWatchedDateModalVisible, setIsWatchedDateModalVisible] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const loveProgress = useSharedValue(0);

  const loadSeries = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const detailResponse = await getSeriesDetails(route.params.seriesId);

      setDetails(detailResponse);
      setSelectedSeasonNumber(detailResponse.seasons[0]?.seasonNumber ?? null);

      const [ratingsResult, similarResult, fallbackResult] = await Promise.allSettled([
        getSeriesExternalRatings(route.params.seriesId, detailResponse.imdbId),
        getSmartSimilarSeries(route.params.seriesId, detailResponse),
        getSeriesEpisodeFallbackImagesWithImdb(detailResponse.title, detailResponse.imdbId)
      ]);

      if (ratingsResult.status === "fulfilled") {
        setRatings(ratingsResult.value);
      } else {
        setRatings({
          imdb: null,
          rottenTomatoes: null,
          metacritic: null
        });
      }

      if (similarResult.status === "fulfilled") {
        setSimilarSeries(
          similarResult.value.filter((item) => String(item.id) !== route.params.seriesId).slice(0, 12)
        );
      } else {
        setSimilarSeries([]);
      }

      if (fallbackResult.status === "fulfilled") {
        setEpisodeFallbackImages(fallbackResult.value);
      } else {
        setEpisodeFallbackImages({});
      }

      getSeriesTrailerUrl(route.params.seriesId).then((url) => setTrailerUrl(url));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load series details.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [route.params.seriesId]);

  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  useEffect(() => {
    if (!details || selectedSeasonNumber === null) {
      setEpisodes([]);
      return;
    }

    let isCancelled = false;
    const run = async () => {
      setIsEpisodesLoading(true);
      try {
        const response = await getSeriesSeasonEpisodes(String(details.id), selectedSeasonNumber);
        if (!isCancelled) {
          setEpisodes(response);
        }

        const missingEpisodeNumbers = response
          .filter((episode) => !episode.stillPath)
          .map((episode) => episode.episodeNumber);

        if (missingEpisodeNumbers.length > 0) {
          const seasonFallback = await getTmdbSeasonEpisodeFallbackImages(
            String(details.id),
            selectedSeasonNumber,
            missingEpisodeNumbers
          );

          if (!isCancelled && Object.keys(seasonFallback).length > 0) {
            setEpisodeFallbackImages((previous) => ({
              ...previous,
              ...seasonFallback
            }));
          }
        }
      } catch {
        if (!isCancelled) {
          setEpisodes([]);
        }
      } finally {
        if (!isCancelled) {
          setIsEpisodesLoading(false);
        }
      }
    };

    void run();
    return () => {
      isCancelled = true;
    };
  }, [details, selectedSeasonNumber]);

  const synopsisText = useMemo(() => {
    const fullText = details?.overview || "No synopsis available.";
    if (isSynopsisExpanded || fullText.length <= 220) {
      return fullText;
    }
    return `${fullText.slice(0, 220).trimEnd()}...`;
  }, [details, isSynopsisExpanded]);

  const canExpandSynopsis = (details?.overview?.length ?? 0) > 220;
  const displayRatings = ratings ?? {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null
  };
  const baseScore = Math.max(0, Math.min(details?.voteAverage ?? 0, 10));
  const imdbDisplayValue = displayRatings.imdb ?? `${baseScore.toFixed(1)}/10`;
  const rottenDisplayValue = displayRatings.rottenTomatoes ?? `${Math.round(baseScore * 10)}%`;
  const metacriticDisplayValue = displayRatings.metacritic ?? `${Math.round(baseScore * 10)}/100`;
  const currentSeriesId = details?.id ?? Number(route.params.seriesId);
  const isCurrentSeriesWatchlisted = Number.isFinite(currentSeriesId) ? isInWatchlist(currentSeriesId) : false;
  const isCurrentSeriesLiked = Number.isFinite(currentSeriesId) ? isLiked(currentSeriesId) : false;
  const currentWatchedEntry = Number.isFinite(currentSeriesId)
    ? getWatchHistoryEntry(currentSeriesId, "tv")
    : null;
  const isCurrentSeriesWatched = currentWatchedEntry !== null;

  const nextEpisode = useMemo(() => {
    if (!details?.seasons?.length) return null;
    const sortedSeasons = [...details.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
    for (const season of sortedSeasons) {
      for (let ep = 1; ep <= season.episodeCount; ep++) {
        if (!isEpisodeWatched(details.id, season.seasonNumber, ep)) {
          return { season: season.seasonNumber, episode: ep };
        }
      }
    }
    // All episodes watched — default to S1 E1
    return { season: sortedSeasons[0].seasonNumber, episode: 1 };
  }, [details, isEpisodeWatched]);

  useEffect(() => {
    loveProgress.value = withTiming(isCurrentSeriesLiked ? 1 : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic)
    });
  }, [isCurrentSeriesLiked, loveProgress]);

  const loveOutlineStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: 1 - loveProgress.value
    };
  });

  const loveFilledStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      opacity: loveProgress.value
    };
  });

  const renderSimilarItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      return (
        <SimilarCardWrap>
          <MediaCard
            item={item}
            onPress={() => {
              navigation.push("SeriesDetail", { seriesId: String(item.id) });
            }}
          />
        </SimilarCardWrap>
      );
    },
    [navigation]
  );

  const handleOpenWatchedDateModal = useCallback(() => {
    setIsWatchedDateModalVisible(true);
  }, []);

  const handleCloseWatchedDateModal = useCallback(() => {
    setIsWatchedDateModalVisible(false);
  }, []);

  const handleMarkAllWatched = useCallback(async (date: Date) => {
    if (!details) {
      return;
    }

    await saveSeriesToWatchHistory(details, normalizeWatchedDate(date), {
      title: details.title,
      imdbId: details.imdbId,
      posterPath: details.posterPath,
      year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
    });
    await removeFromWatchlist(details.id, {
      title: details.title,
      imdbId: details.imdbId,
      posterPath: details.posterPath,
      year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
    });

    for (const season of details.seasons) {
      const episodeNumbers = Array.from({ length: season.episodeCount }, (_, i) => i + 1);
      await markSeasonWatched(details.id, season.seasonNumber, episodeNumbers);
    }

    setIsWatchedDateModalVisible(false);
  }, [details, markSeasonWatched, removeFromWatchlist, saveSeriesToWatchHistory]);

  const handleRemoveWatchedDate = useCallback(async () => {
    if (!details) {
      return;
    }

    await removeFromWatchHistory(details.id, "tv", {
      title: details.title,
      imdbId: details.imdbId,
      posterPath: details.posterPath,
      year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
    });
    setIsWatchedDateModalVisible(false);
  }, [details, removeFromWatchHistory]);

  if (isLoading && !details) {
    return (
      <Root>
        <LoaderWrap>
          <MovieLoader label="Loading series" />
        </LoaderWrap>
      </Root>
    );
  }

  if (!details) {
    return (
      <Root>
        <DetailHeader
          posterPath={null}
          backdropPath={null}
          onBack={() => navigation.goBack()}
          showWatchlistAction={false}
          showLikeAction={false}
        />
        <Body>
          <ErrorText>{errorMessage ?? "No detail data available."}</ErrorText>
        </Body>
      </Root>
    );
  }

  return (
    <Root>
      <ScrollView showsVerticalScrollIndicator={false}>
        <DetailHeader
          posterPath={details.posterPath}
          backdropPath={details.backdropPath}
          onBack={() => navigation.goBack()}
          isInWatchlist={isCurrentSeriesWatchlisted}
          onToggleWatchlist={() => {
            if (Number.isFinite(currentSeriesId)) {
              void toggleWatchlist(currentSeriesId, details ? {
                title: details.title,
                imdbId: details.imdbId,
                posterPath: details.posterPath,
                year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
              } : undefined);
            }
          }}
          showLikeAction={false}
          showTrailerAction={!!trailerUrl}
          onTrailer={() => {
            navigation.navigate("Player", {
              mediaType: "tv",
              tmdbId: String(details.id),
              title: `${details.title} - Trailer`,
              trailerUrl: trailerUrl!,
              year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
            });
          }}
        />

        <Body>
          <Animated.View entering={FadeInDown.duration(420).delay(70)}>
            <TopInfo>
              <DateText>{formatDate(details.firstAirDate)}</DateText>
              <Title numberOfLines={2}>{details.title}</Title>

              <PillsRow>
                <MetaPill label={`${details.numberOfSeasons} Seasons`} />
                <MetaPill label={`${details.numberOfEpisodes} Episodes`} />
                {details.genres.slice(0, 2).map((genre) => (
                  <MetaPill key={genre} label={genre} />
                ))}
              </PillsRow>

              <RatingsRow>
                <RatingsStrip>
                  <RatingEntry>
                    <RatingServiceIcon service="imdb" size={14} />
                    <SourceValue>{imdbDisplayValue}</SourceValue>
                  </RatingEntry>
                  <RatingDivider />
                  <RatingEntry>
                    <RatingServiceIcon service="rottentomatoes" size={14} />
                    <SourceValue>{rottenDisplayValue}</SourceValue>
                  </RatingEntry>
                  <RatingDivider />
                  <RatingEntry>
                    <RatingServiceIcon service="metacritic" size={14} />
                    <SourceValue>{metacriticDisplayValue}</SourceValue>
                  </RatingEntry>
                </RatingsStrip>
                <LoveButtonPress
                  onPress={() => {
                    if (Number.isFinite(currentSeriesId)) {
                      void toggleLikedSeries(currentSeriesId, details ? {
                        title: details.title,
                        imdbId: details.imdbId,
                        posterPath: details.posterPath,
                        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
                      } : undefined);
                    }
                  }}
                >
                  <LoveButtonBody>
                    <Animated.View style={loveOutlineStyle}>
                      <MaterialCommunityIcons name="heart-outline" size={18} color="#FFFFFF" />
                    </Animated.View>
                    <Animated.View style={loveFilledStyle}>
                      <MaterialCommunityIcons name="heart" size={18} color="#E50914" />
                    </Animated.View>
                  </LoveButtonBody>
                </LoveButtonPress>
              </RatingsRow>

              <Animated.View entering={FadeInDown.duration(420).delay(130)}>
                <WatchNowWrap>
                  <ActionRow>
                    <PrimaryActionWrap>
                      <TopWatchButton
                        onPress={() => {
                          navigation.navigate("Player", {
                            mediaType: "tv",
                            tmdbId: String(details.id),
                            imdbId: details.imdbId,
                            title: details.title,
                            seasonNumber: nextEpisode?.season,
                            episodeNumber: nextEpisode?.episode,
                            year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null
                          });
                        }}
                      >
                        <Feather name="play-circle" size={20} color="#FFFFFF" />
                        <TopWatchButtonText>
                          {nextEpisode ? `Watch S${nextEpisode.season} E${nextEpisode.episode}` : "Watch Now"}
                        </TopWatchButtonText>
                      </TopWatchButton>
                    </PrimaryActionWrap>
                    <WatchedButton $active={isCurrentSeriesWatched} onPress={handleOpenWatchedDateModal}>
                      <MaterialCommunityIcons
                        name={isCurrentSeriesWatched ? "eye-check" : "eye-plus-outline"}
                        size={22}
                        color={isCurrentSeriesWatched ? currentTheme.colors.primary : currentTheme.colors.textPrimary}
                      />
                    </WatchedButton>
                  </ActionRow>
                  {currentWatchedEntry ? (
                    <WatchedMetaText>Watched on {formatWatchedDateLabel(currentWatchedEntry.watchedAt)}</WatchedMetaText>
                  ) : null}
                </WatchNowWrap>
              </Animated.View>
            </TopInfo>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(130)}>
            <SectionHeader>
              <SectionTitle>Synopsis</SectionTitle>
            </SectionHeader>
            <SynopsisText>{synopsisText}</SynopsisText>
            {canExpandSynopsis ? (
              <ReadMoreButton
                onPress={() => {
                  setIsSynopsisExpanded((previous) => !previous);
                }}
              >
                <ReadMoreText>{isSynopsisExpanded ? "Read less" : "Read more"}</ReadMoreText>
              </ReadMoreButton>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(170)}>
            <SectionHeader>
              <SectionTitle>Seasons & Episodes</SectionTitle>
            </SectionHeader>
            <SeasonSelector>
              {details.seasons.map((season) => {
                const isActive = season.seasonNumber === selectedSeasonNumber;
                return (
                  <SeasonChip
                    key={season.id}
                    $active={isActive}
                    onPress={() => {
                      setSelectedSeasonNumber(season.seasonNumber);
                    }}
                  >
                    <SeasonChipText $active={isActive}>
                      {season.name || `Season ${season.seasonNumber}`}
                    </SeasonChipText>
                  </SeasonChip>
                );
              })}
            </SeasonSelector>

            <EpisodesWrap>
              <Animated.View
                key={`season-${selectedSeasonNumber ?? "none"}`}
                entering={FadeInRight.duration(260)}
                exiting={FadeOutLeft.duration(180)}
              >
                {isEpisodesLoading ? (
                  <MovieLoader size={28} />
                ) : episodes.length === 0 ? (
                  <EmptyEpisodes>No episodes available for this season.</EmptyEpisodes>
                ) : (
                  (() => {
                    const selectedSeason = details.seasons.find(
                      (season) => season.seasonNumber === selectedSeasonNumber
                    );
                    const seasonPosterFallback = getTmdbImageUrl(selectedSeason?.posterPath ?? null, "w342");
                    const seriesBackdropFallback = getTmdbImageUrl(details.backdropPath, "w342");

                    return episodes.map((episode) => {
                      const tmdbStill = getTmdbImageUrl(episode.stillPath, "w342");
                      const fallbackStill =
                        episodeFallbackImages[`${episode.seasonNumber}:${episode.episodeNumber}`] ?? null;
                      const stillUri = tmdbStill ?? fallbackStill ?? seasonPosterFallback ?? seriesBackdropFallback;

                      return (
                        <SwipeableEpisodeCard
                          key={episode.id}
                          episode={episode}
                          stillUri={stillUri}
                          isWatched={isEpisodeWatched(details.id, episode.seasonNumber, episode.episodeNumber)}
                          onToggleWatched={() => {
                            toggleEpisodeWatched(details.id, episode.seasonNumber, episode.episodeNumber);
                          }}
                          onPress={() => {
                            navigation.navigate("Player", {
                              mediaType: "tv",
                              tmdbId: String(details.id),
                              imdbId: details.imdbId,
                              title: details.title,
                              seasonNumber: episode.seasonNumber,
                              episodeNumber: episode.episodeNumber,
                              year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null
                            });
                          }}
                        />
                      );
                    });
                  })()
                )}
              </Animated.View>
            </EpisodesWrap>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(210)}>
            <SectionHeader>
              <SectionTitle>Cast & Crew</SectionTitle>
            </SectionHeader>
            <CastWrap>
              <CastCrewSection
                cast={details.cast}
                crew={details.crew}
                onPressCastItem={(member) => {
                  navigation.navigate("ActorDetail", { actorId: String(member.id) });
                }}
                onPressCrewItem={(member) => {
                  navigation.navigate("ActorDetail", { actorId: String(member.id) });
                }}
              />
            </CastWrap>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(250)}>
            <SectionHeader>
              <SectionTitle>Similar Series</SectionTitle>
            </SectionHeader>
            <SimilarWrap>
              <FlashList
                data={similarSeries}
                horizontal
                keyExtractor={(item) => String(item.id)}
                renderItem={renderSimilarItem}
                showsHorizontalScrollIndicator={false}
              />
            </SimilarWrap>
          </Animated.View>
        </Body>
      </ScrollView>
      <SeriesWatchedModal
        visible={isWatchedDateModalVisible}
        seriesTitle={details.title}
        seasons={details.seasons}
        seriesId={details.id}
        isWatched={isCurrentSeriesWatched}
        watchedAt={currentWatchedEntry?.watchedAt ?? null}
        isEpisodeWatched={isEpisodeWatched}
        markSeasonWatched={markSeasonWatched}
        unmarkSeasonWatched={unmarkSeasonWatched}
        onMarkAllWatched={handleMarkAllWatched}
        onRemoveFromHistory={handleRemoveWatchedDate}
        onClose={handleCloseWatchedDateModal}
      />
    </Root>
  );
}









