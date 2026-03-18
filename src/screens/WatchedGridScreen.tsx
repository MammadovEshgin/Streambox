import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dimensions, FlatList, ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../api/tmdb";
import { SafeContainer } from "../components/common/SafeContainer";
import { MovieLoader } from "../components/common/MovieLoader";
import { useWatchHistory, type WatchHistoryEntry } from "../hooks/useWatchHistory";
import type { StatsStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<StatsStackParamList, "WatchedGrid">;

const NUM_COLUMNS = 3;
const HORIZONTAL_PADDING = 16;
const GAP = 10;
const screenWidth = Dimensions.get("window").width;
const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const cardHeight = cardWidth * 1.5;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px 8px;
`;

const BackButton = styled.Pressable`
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`;

const ScreenTitle = styled.Text`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const ToggleRow = styled.View`
  flex-direction: row;
  padding: 0 16px 12px;
  gap: 8px;
`;

const ToggleChip = styled.Pressable<{ $active: boolean }>`
  padding: 8px 12px;
  border-radius: 4px;
  border-width: 1px;
  border-color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : "rgba(255,255,255,0.12)"};
  background-color: ${({ $active }) =>
    $active ? "rgba(255,77,0,0.14)" : "rgba(255,255,255,0.04)"};
`;

const ToggleLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) =>
    $active ? theme.colors.primary : theme.colors.textPrimary};
  font-size: 12px;
  line-height: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const GridWrap = styled.View`
  flex: 1;
  padding-horizontal: ${HORIZONTAL_PADDING}px;
`;

const CardRoot = styled.Pressable`
  width: ${cardWidth}px;
  margin-bottom: 16px;
`;

const PosterFrame = styled.View`
  width: ${cardWidth}px;
  height: ${cardHeight}px;
  border-radius: 8px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const PosterImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const NoImage = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const NoImageText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
`;

const Badge = styled.View`
  position: absolute;
  left: 6px;
  bottom: 6px;
  flex-direction: row;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  background-color: rgba(0, 0, 0, 0.68);
`;

const BadgeValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const Title = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 17px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const Meta = styled.Text`
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 14px;
  letter-spacing: 0.15px;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-top: 60px;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin-top: 10px;
`;

const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

export function WatchedGridScreen({ route, navigation }: Props) {
  const {
    filter: initialFilter,
    title: screenTitle,
    genre,
    genres,
    actorId,
    directorId,
    ratingMin,
    ratingMax,
    decadeMin,
    decadeMax,
    monthTimestamp,
    watchedAtMin,
    watchedAtMax,
    ids,
  } = route.params;
  const currentTheme = useTheme();
  const isFocused = useIsFocused();
  const hasExtraFilter = !!(genre || genres?.length || actorId || directorId || ratingMin != null || decadeMin != null || monthTimestamp || watchedAtMin != null || ids);
  const [filter, setFilter] = useState<"movie" | "tv">(initialFilter);
  const { history, isLoading, reload } = useWatchHistory();

  useEffect(() => {
    if (isFocused) void reload();
  }, [isFocused, reload]);

  const filtered = useMemo(() => {
    let items = history.filter((e) => e.mediaType === (filter === "tv" ? "tv" : "movie"));
    if (genres && genres.length > 0) {
      items = items.filter((e) => genres.every((requestedGenre) => e.genres.includes(requestedGenre)));
    } else if (genre) {
      items = items.filter((e) => e.genres.includes(genre));
    }
    if (actorId) items = items.filter((e) => e.castIds.includes(actorId));
    if (directorId) items = items.filter((e) => e.directorIds.includes(directorId));
    if (ratingMin != null && ratingMax != null)
      items = items.filter((e) => e.voteAverage >= ratingMin && (ratingMax >= 10 ? e.voteAverage <= ratingMax : e.voteAverage < ratingMax));
    if (decadeMin != null && decadeMax != null)
      items = items.filter((e) => {
        const yr = parseInt(e.year, 10);
        return !isNaN(yr) && yr >= decadeMin && yr <= decadeMax;
      });
    if (monthTimestamp) {
      const d = new Date(monthTimestamp);
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      items = items.filter((e) => e.watchedAt >= monthTimestamp && e.watchedAt < nextMonth);
    }
    if (watchedAtMin != null && watchedAtMax != null) {
      items = items.filter((e) => e.watchedAt >= watchedAtMin && e.watchedAt < watchedAtMax);
    }
    if (ids && ids.length > 0) {
      items = items.filter((e) => ids.includes(e.id));
    }
    return items;
  }, [history, filter, genre, genres, actorId, directorId, ratingMin, ratingMax, decadeMin, decadeMax, monthTimestamp, watchedAtMin, watchedAtMax, ids]);

  const handlePressItem = useCallback(
    (item: WatchHistoryEntry) => {
      if (item.mediaType === "movie") {
        if (typeof item.id === "string" && item.id.includes("-")) {
          navigation.navigate("AzClassicDetail", { movieId: item.id });
        } else {
          navigation.navigate("MovieDetail", { movieId: String(item.id) });
        }
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
      }
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WatchHistoryEntry>) => {
      const posterUri =
        item.posterPath?.startsWith("http")
          ? item.posterPath
          : item.posterPath
          ? getTmdbImageUrl(item.posterPath, "w342")
          : null;
      return (
        <CardRoot onPress={() => handlePressItem(item)}>
          <PosterFrame>
            {posterUri ? (
              <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
            ) : (
              <NoImage>
                <NoImageText>No Image</NoImageText>
              </NoImage>
            )}
            {typeof item.id !== "string" && (
              <Badge>
                <Feather name="star" size={10} color="#FFD700" style={{ marginRight: 3 }} />
                <BadgeValue>{item.voteAverage.toFixed(1)}</BadgeValue>
              </Badge>
            )}
          </PosterFrame>
          <Title numberOfLines={1}>{item.title}</Title>
          <Meta>{item.year}</Meta>
        </CardRoot>
      );
    },
    [handlePressItem]
  );

  const keyExtractor = useCallback((item: WatchHistoryEntry) => `${item.mediaType}-${item.id}`, []);

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{screenTitle ?? "Watched"}</ScreenTitle>
      </HeaderRow>

      {!hasExtraFilter && (
        <ToggleRow>
          <ToggleChip $active={filter === "movie"} onPress={() => setFilter("movie")}>
            <ToggleLabel $active={filter === "movie"}>Movies</ToggleLabel>
          </ToggleChip>
          <ToggleChip $active={filter === "tv"} onPress={() => setFilter("tv")}>
            <ToggleLabel $active={filter === "tv"}>Series</ToggleLabel>
          </ToggleChip>
        </ToggleRow>
      )}

      {isLoading ? (
        <LoadingWrap>
          <MovieLoader size={44} label="Loading..." />
        </LoadingWrap>
      ) : filtered.length === 0 ? (
        <EmptyWrap>
          <Feather name="play-circle" size={32} color={currentTheme.colors.textSecondary} />
          <EmptyText>No {filter === "movie" ? "movies" : "series"} watched yet</EmptyText>
        </EmptyWrap>
      ) : (
        <GridWrap>
          <FlatList
            data={filtered}
            numColumns={NUM_COLUMNS}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            columnWrapperStyle={{ gap: GAP }}
            showsVerticalScrollIndicator={false}
          />
        </GridWrap>
      )}
    </SafeContainer>
  );
}
