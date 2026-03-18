import { Feather } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { FlashList, ListRenderItemInfo } from "@shopify/flash-list";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { CastCrewSection } from "../components/detail/CastCrewSection";
import { MovieLoader } from "../components/common/MovieLoader";
import { DetailHeader } from "../components/detail/DetailHeader";
import {
  WatchedDateModal,
  formatWatchedDateLabel,
  normalizeWatchedDate
} from "../components/detail/WatchedDateModal";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useWatchlist } from "../hooks/useWatchlist";
import { HomeStackParamList } from "../navigation/types";
import { CastMember, CrewMember } from "../api/tmdb";
import { AzClassicMovie, AzClassicMovieDetails, AzClassicCastMember, AzClassicCrewMember, getAzClassicMovieDetails, getSimilarAzClassicMovies } from "../api/azClassics";

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

const YearText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 18px;
  letter-spacing: 0.2px;
  font-weight: 500;
`;

const Title = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 26px;
  line-height: 32px;
  font-weight: 800;
  letter-spacing: -0.4px;
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
  margin-top: 24px;
  margin-bottom: 12px;
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 19px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const CastWrap = styled.View`
  height: 200px;
`;

const SynopsisSection = styled.View`
  margin-top: 16px;
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
  height: 180px;
`;

const SimilarCardWrap = styled(Pressable)`
  margin-right: 12px;
  width: 110px;
`;

const SimilarPoster = styled.Image`
  width: 110px;
  height: 145px;
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const SimilarTitle = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
`;

const ErrorText = styled.Text`
  margin-top: 12px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

type AzClassicDetailProps = NativeStackScreenProps<HomeStackParamList, "AzClassicDetail">;

export function AzClassicDetailScreen({ route, navigation }: AzClassicDetailProps) {
  const currentTheme = useTheme();
  const { isLiked, toggleLikedMovie } = useLikedMovies();
  const { isInWatchlist, toggleWatchlist } = useWatchlist();
  const { getWatchHistoryEntry, saveAzClassicToWatchHistory, removeFromWatchHistory } = useWatchHistory();
  const [details, setDetails] = useState<AzClassicMovieDetails | null>(null);
  const [similarMovies, setSimilarMovies] = useState<AzClassicMovie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const watchButtonScale = useSharedValue(1);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const detailResponse = await getAzClassicMovieDetails(route.params.movieId);
      setDetails(detailResponse);

      // Fetch similar movies
      const similar = await getSimilarAzClassicMovies(
        route.params.movieId,
        detailResponse.genre || undefined,
        detailResponse.cast.slice(0, 3).map(c => c.name),
        detailResponse.crew.slice(0, 2).map(c => c.name)
      );
      setSimilarMovies(similar);
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
    const fullText = details?.synopsis || "No synopsis available.";
    if (isSynopsisExpanded || fullText.length <= 210) {
      return fullText;
    }

    return `${fullText.slice(0, 210).trimEnd()}...`;
  }, [details, isSynopsisExpanded]);

  const canExpandSynopsis = (details?.synopsis?.length ?? 0) > 210;
  const currentMovieId = details?.id ?? route.params.movieId;
  const isCurrentMovieLiked = isLiked(currentMovieId);
  const isCurrentMovieWatchlisted = isInWatchlist(currentMovieId);
  const currentWatchedEntry = getWatchHistoryEntry(currentMovieId, "movie");
  const isCurrentMovieWatched = currentWatchedEntry !== null;

  const [isWatchedDateModalVisible, setIsWatchedDateModalVisible] = useState(false);
  const [selectedWatchedDate, setSelectedWatchedDate] = useState(() => new Date());

  useEffect(() => {
    if (!isWatchedDateModalVisible) {
      setSelectedWatchedDate(currentWatchedEntry ? new Date(currentWatchedEntry.watchedAt) : new Date());
    }
  }, [currentWatchedEntry, isWatchedDateModalVisible]);

  const handleOpenWatchedDateModal = useCallback(() => {
    setSelectedWatchedDate(currentWatchedEntry ? new Date(currentWatchedEntry.watchedAt) : new Date());
    setIsWatchedDateModalVisible(true);
  }, [currentWatchedEntry]);

  const handleCloseWatchedDateModal = useCallback(() => {
    setIsWatchedDateModalVisible(false);
  }, []);

  const handleSaveWatchedDate = useCallback(async () => {
    if (!details) return;

    await saveAzClassicToWatchHistory(details, normalizeWatchedDate(selectedWatchedDate), {
      title: details.title,
      posterPath: details.posterUrl,
      year: String(details.year),
    });
    setIsWatchedDateModalVisible(false);
  }, [details, saveAzClassicToWatchHistory, selectedWatchedDate]);

  const handleRemoveWatchedDate = useCallback(async () => {
    if (!details) return;

    await removeFromWatchHistory(details.id, "movie", {
      title: details.title,
      posterPath: details.posterUrl,
      year: String(details.year),
    });
    setIsWatchedDateModalVisible(false);
  }, [details, removeFromWatchHistory]);

  const adaptedCast = useMemo<CastMember[]>(() =>
    (details?.cast ?? []).map((m: AzClassicCastMember) => ({
      id: m.id as unknown as number,
      name: m.name,
      character: m.character ?? "",
      profilePath: m.cachedPhotoUrl ?? m.photoUrl,
      gender: null,
    })), [details?.cast]);

  const adaptedCrew = useMemo<CrewMember[]>(() =>
    (details?.crew ?? []).map((m: AzClassicCrewMember) => ({
      id: m.id as unknown as number,
      name: m.name,
      job: m.role,
      department: "",
      profilePath: m.cachedPhotoUrl ?? m.photoUrl,
    })), [details?.crew]);

  const renderSimilarItem = useCallback(
    ({ item }: ListRenderItemInfo<AzClassicMovie>) => {
      const posterUri = item.cachedPosterUrl ?? item.posterUrl;
      return (
        <SimilarCardWrap onPress={() => navigation.push("AzClassicDetail", { movieId: String(item.id) })}>
          <SimilarPoster source={{ uri: posterUri || undefined }} resizeMode="cover" />
          <SimilarTitle numberOfLines={2}>{item.title}</SimilarTitle>
        </SimilarCardWrap>
      );
    },
    [navigation]
  );

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
          posterPath={details.cachedPosterUrl ?? details.posterUrl}
          backdropPath={null}
          onBack={() => navigation.goBack()}
          isInWatchlist={isCurrentMovieWatchlisted}
          onToggleWatchlist={() => {
            void toggleWatchlist(currentMovieId, {
              title: details.title,
              posterPath: details.posterUrl,
              year: String(details.year),
            });
          }}
          isLiked={isCurrentMovieLiked}
          onToggleLike={() => {
            void toggleLikedMovie(currentMovieId, {
              title: details.title,
              posterPath: details.posterUrl,
              year: String(details.year),
            });
          }}
        />

        <Body>
          <Animated.View entering={FadeInDown.duration(420).delay(70)}>
            <TopInfo>
              <YearText>{details.year}</YearText>
              <Title numberOfLines={2}>{details.title}</Title>

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
                              title: details.title,
                              castNames: details.cast.slice(0, 4).map((c) => c.name),
                              year: String(details.year),
                              videoId: details.videoId,
                              isAzClassic: true
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
                  {isCurrentMovieWatched ? (
                    <WatchedMetaText>Watched on {formatWatchedDateLabel(currentWatchedEntry.watchedAt)}</WatchedMetaText>
                  ) : null}
                </WatchNowWrap>
              </Animated.View>

              <SynopsisSection>
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
              </SynopsisSection>
            </TopInfo>
          </Animated.View>

          {(adaptedCast.length > 0 || adaptedCrew.length > 0) ? (
            <Animated.View entering={FadeInDown.duration(420).delay(180)}>
              <SectionHeader>
                <SectionTitle>Cast & Crew</SectionTitle>
              </SectionHeader>
              <CastWrap>
                <CastCrewSection cast={adaptedCast} crew={adaptedCrew} />
              </CastWrap>
            </Animated.View>
          ) : null}

          {similarMovies.length > 0 && (
            <Animated.View entering={FadeInDown.duration(420).delay(210)}>
              <SectionHeader>
                <SectionTitle>Similar Movies</SectionTitle>
              </SectionHeader>
              <SimilarWrap>
                <FlashList
                  data={similarMovies}
                  horizontal
                  keyExtractor={(item) => item.id}
                  renderItem={renderSimilarItem}
                  showsHorizontalScrollIndicator={false}
                />
              </SimilarWrap>
            </Animated.View>
          )}
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
