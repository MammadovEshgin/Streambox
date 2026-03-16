import { Feather } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import {
  ExternalRatings,
  MediaItem,
  MovieDetails,
  getMovieDetails,
  getMovieExternalRatings,
  getMovieTrailerUrl,
  getSmartSimilarMovies
} from "../api/tmdb";
import { CastList } from "../components/detail/CastList";
import { MovieLoader } from "../components/common/MovieLoader";
import { RatingServiceIcon } from "../components/common/RatingServiceIcon";
import { DetailHeader } from "../components/detail/DetailHeader";
import { MetaPill } from "../components/detail/MetaPill";
import {
  WatchedDateModal,
  formatWatchedDateLabel,
  normalizeWatchedDate
} from "../components/detail/WatchedDateModal";
import { MediaCard } from "../components/home/MediaCard";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useWatchlist } from "../hooks/useWatchlist";
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
  flex-direction: row;
  margin-top: 10px;
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
  justify-content: flex-start;
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

const TopWatchButton = styled(Pressable)`
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

const WatchedButton = styled(Pressable)<{ $active: boolean }>`
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
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.25px;
`;

const CastWrap = styled.View`
  height: 126px;
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

type MovieDetailProps = NativeStackScreenProps<HomeStackParamList, "MovieDetail">;

function formatReleaseDate(value: string): string {
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

function formatRuntime(minutes: number | null): string {
  if (!minutes || minutes <= 0) {
    return "N/A";
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours <= 0) {
    return `${remaining}min`;
  }

  return `${hours}h ${remaining}min`;
}

export function MovieDetailScreen({ route, navigation }: MovieDetailProps) {
  const currentTheme = useTheme();
  const { isInWatchlist, removeFromWatchlist, toggleWatchlist } = useWatchlist();
  const { isLiked, toggleLikedMovie } = useLikedMovies();
  const { getWatchHistoryEntry, saveMovieToWatchHistory, removeFromWatchHistory } = useWatchHistory();
  const [details, setDetails] = useState<MovieDetails | null>(null);
  const [externalRatings, setExternalRatings] = useState<ExternalRatings | null>(null);
  const [similarMovies, setSimilarMovies] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [isWatchedDateModalVisible, setIsWatchedDateModalVisible] = useState(false);
  const [selectedWatchedDate, setSelectedWatchedDate] = useState(() => new Date());
  const watchButtonScale = useSharedValue(1);
  const loveProgress = useSharedValue(0);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const detailResponse = await getMovieDetails(route.params.movieId);
      setDetails(detailResponse);

      const [ratingsResponse, similarResponse] = await Promise.all([
        getMovieExternalRatings(route.params.movieId, detailResponse.imdbId),
        getSmartSimilarMovies(route.params.movieId, detailResponse)
      ]);

      setExternalRatings(ratingsResponse);
      setSimilarMovies(
        similarResponse.filter((item) => String(item.id) !== route.params.movieId)
      );

      // Fetch trailer URL in background
      getMovieTrailerUrl(route.params.movieId).then((url) => setTrailerUrl(url));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load movie details.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [route.params.movieId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const watchButtonAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: watchButtonScale.value }]
    };
  });

  const synopsisText = useMemo(() => {
    const fullText = details?.overview || "No synopsis available.";
    if (isSynopsisExpanded || fullText.length <= 210) {
      return fullText;
    }

    return `${fullText.slice(0, 210).trimEnd()}...`;
  }, [details, isSynopsisExpanded]);

  const canExpandSynopsis = (details?.overview?.length ?? 0) > 210;
  const currentMovieId = details?.id ?? Number(route.params.movieId);
  const isCurrentMovieWatchlisted = Number.isFinite(currentMovieId) ? isInWatchlist(currentMovieId) : false;
  const isCurrentMovieLiked = Number.isFinite(currentMovieId) ? isLiked(currentMovieId) : false;
  const currentWatchedEntry = Number.isFinite(currentMovieId)
    ? getWatchHistoryEntry(currentMovieId, "movie")
    : null;
  const isCurrentMovieWatched = currentWatchedEntry !== null;

  useEffect(() => {
    loveProgress.value = withTiming(isCurrentMovieLiked ? 1 : 0, {
      duration: 230,
      easing: Easing.out(Easing.cubic)
    });
  }, [isCurrentMovieLiked, loveProgress]);

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

  useEffect(() => {
    if (!isWatchedDateModalVisible) {
      setSelectedWatchedDate(currentWatchedEntry ? new Date(currentWatchedEntry.watchedAt) : new Date());
    }
  }, [currentWatchedEntry, isWatchedDateModalVisible]);

  const displayRatings = externalRatings ?? {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null,
    letterboxd: null
  };
  const baseScore = Math.max(0, Math.min(details?.voteAverage ?? 0, 10));
  const imdbDisplayValue = displayRatings.imdb ?? `${baseScore.toFixed(1)}/10`;
  const rottenDisplayValue = displayRatings.rottenTomatoes ?? `${Math.round(baseScore * 10)}%`;
  const metacriticDisplayValue = displayRatings.metacritic ?? `${Math.round(baseScore * 10)}/100`;
  const letterboxdDisplayValue = displayRatings.letterboxd ?? `${(baseScore / 2).toFixed(1)}/5`;

  const renderSimilarItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      return (
        <SimilarCardWrap>
          <MediaCard
            item={item}
            onPress={() => {
              navigation.push("MovieDetail", { movieId: String(item.id) });
            }}
          />
        </SimilarCardWrap>
      );
    },
    [navigation]
  );

  const handleOpenWatchedDateModal = useCallback(() => {
    setSelectedWatchedDate(currentWatchedEntry ? new Date(currentWatchedEntry.watchedAt) : new Date());
    setIsWatchedDateModalVisible(true);
  }, [currentWatchedEntry]);

  const handleCloseWatchedDateModal = useCallback(() => {
    setIsWatchedDateModalVisible(false);
  }, []);

  const handleSaveWatchedDate = useCallback(async () => {
  if (!details) {
    return;
  }

  await saveMovieToWatchHistory(details, normalizeWatchedDate(selectedWatchedDate), {
    title: details.title,
    imdbId: details.imdbId,
    posterPath: details.posterPath,
    year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
  });
  await removeFromWatchlist(details.id, {
    title: details.title,
    imdbId: details.imdbId,
    posterPath: details.posterPath,
    year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
  });
  setIsWatchedDateModalVisible(false);
}, [details, removeFromWatchlist, saveMovieToWatchHistory, selectedWatchedDate]);

const handleRemoveWatchedDate = useCallback(async () => {
  if (!details) {
    return;
  }

  await removeFromWatchHistory(details.id, "movie", {
    title: details.title,
    imdbId: details.imdbId,
    posterPath: details.posterPath,
    year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
  });
  setIsWatchedDateModalVisible(false);
}, [details, removeFromWatchHistory]);

if (isLoading && !details) {
  return (
    <Root>
      <LoaderWrap>
        <MovieLoader label="Loading detail" />
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
        isInWatchlist={isCurrentMovieWatchlisted}
        onToggleWatchlist={() => {
          if (Number.isFinite(currentMovieId)) {
            void toggleWatchlist(currentMovieId);
          }
        }}
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
          isInWatchlist={isCurrentMovieWatchlisted}
          onToggleWatchlist={() => {
            if (Number.isFinite(currentMovieId)) {
              void toggleWatchlist(currentMovieId, details ? {
                title: details.title,
                imdbId: details.imdbId,
                posterPath: details.posterPath,
                year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
              } : undefined);
            }
          }}
          showTrailerAction={!!trailerUrl}
          onTrailer={() => {
            if (trailerUrl) {
              navigation.push("Player", {
                mediaType: "movie",
                tmdbId: String(details.id),
                imdbId: details.imdbId,
                title: `${details.title} - Trailer`,
                trailerUrl,
                year: details.releaseDate ? details.releaseDate.slice(0, 4) : null
              });
            }
          }}
        />

        <Body>
          <Animated.View entering={FadeInDown.duration(420).delay(70)}>
            <TopInfo>
              <DateText>{formatReleaseDate(details.releaseDate)}</DateText>
              <Title numberOfLines={2}>{details.title}</Title>

              <PillsRow>
                <MetaPill label={formatRuntime(details.runtimeMinutes)} />
                {details.genres.slice(0, 2).map((genre) => (
                  <MetaPill key={genre} label={genre} />
                ))}
                <MetaPill label={details.ageRating} />
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
                  <RatingDivider />
                  <RatingEntry>
                    <RatingServiceIcon service="letterboxd" size={14} />
                    <SourceValue>{letterboxdDisplayValue}</SourceValue>
                  </RatingEntry>
                </RatingsStrip>
                <LoveButtonPress
                  onPress={() => {
                    if (Number.isFinite(currentMovieId)) {
                      void toggleLikedMovie(currentMovieId, details ? {
                      title: details.title,
                      imdbId: details.imdbId,
                      posterPath: details.posterPath,
                      year: details.releaseDate ? details.releaseDate.slice(0, 4) : null,
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
                      <Animated.View style={watchButtonAnimatedStyle}>
                        <TopWatchButton
                          onPressIn={() => {
                            watchButtonScale.value = withSpring(0.97, { damping: 14, stiffness: 200 });
                          }}
                          onPressOut={() => {
                            watchButtonScale.value = withSpring(1, { damping: 14, stiffness: 200 });
                          }}
                          onPress={() => {
                            navigation.navigate("Player", {
                              mediaType: "movie",
                              tmdbId: String(details.id),
                              imdbId: details.imdbId,
                              title: details.title,
                              castNames: details.cast.slice(0, 4).map((c) => c.name),
                              year: details.releaseDate ? details.releaseDate.slice(0, 4) : null
                            });
                          }}
                        >
                          <Feather name="play-circle" size={20} color="#FFFFFF" />
                          <TopWatchButtonText>Watch Now</TopWatchButtonText>
                        </TopWatchButton>
                      </Animated.View>
                    </PrimaryActionWrap>
                    <WatchedButton $active={isCurrentMovieWatched} onPress={handleOpenWatchedDateModal}>
                      <MaterialCommunityIcons
                        name={isCurrentMovieWatched ? "eye-check" : "eye-plus-outline"}
                        size={22}
                        color={isCurrentMovieWatched ? currentTheme.colors.primary : currentTheme.colors.textPrimary}
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

          <Animated.View entering={FadeInDown.duration(420).delay(180)}>
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

          <Animated.View entering={FadeInDown.duration(420).delay(220)}>
            <SectionHeader>
              <SectionTitle>Cast</SectionTitle>
            </SectionHeader>
            <CastWrap>
              <CastList
                cast={details.cast}
                onPressItem={(member) => {
                  navigation.navigate("ActorDetail", { actorId: String(member.id) });
                }}
              />
            </CastWrap>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(420).delay(260)}>
            <SectionHeader>
              <SectionTitle>Similar Movies</SectionTitle>
            </SectionHeader>
            <SimilarWrap>
              <FlashList
                data={similarMovies}
                horizontal
                keyExtractor={(item) => String(item.id)}
                renderItem={renderSimilarItem}
                showsHorizontalScrollIndicator={false}
              />
            </SimilarWrap>
          </Animated.View>
        </Body>
      </ScrollView>
      <WatchedDateModal
        visible={isWatchedDateModalVisible}
        title={details.title}
        mediaLabel="movie"
        selectedDate={selectedWatchedDate}
        isWatched={isCurrentMovieWatched}
        onChangeDate={setSelectedWatchedDate}
        onClose={handleCloseWatchedDateModal}
        onSave={handleSaveWatchedDate}
        onRemove={isCurrentMovieWatched ? handleRemoveWatchedDate : undefined}
      />
    </Root>
  );
}













