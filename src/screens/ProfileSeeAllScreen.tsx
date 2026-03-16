import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  MediaItem,
  MediaType,
  getTmdbImageUrl,
  getMovieSummary,
  getSeriesSummary
} from "../api/tmdb";
import { SafeContainer } from "../components/common/SafeContainer";
import { MovieLoader } from "../components/common/MovieLoader";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useLikedSeries } from "../hooks/useLikedSeries";
import { useSeriesWatchlist } from "../hooks/useSeriesWatchlist";
import { useWatchHistory } from "../hooks/useWatchHistory";
import { useWatchlist } from "../hooks/useWatchlist";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "ProfileSeeAll">;

const NUM_COLUMNS = 3;
const HORIZONTAL_PADDING = 16;
const GAP = 10;
const screenWidth = Dimensions.get("window").width;
const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const cardHeight = cardWidth * 1.5;

// ---------------------------------------------------------------------------
// Styled Components
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

type Cache = Map<string, MediaItem>;

async function hydrateList(ids: number[], type: MediaType, cache: Cache): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  const fetcher = type === "movie" ? getMovieSummary : getSeriesSummary;

  await Promise.all(
    ids.map(async (id) => {
      const key = `${type}-${id}`;
      if (cache.has(key)) {
        items.push(cache.get(key)!);
        return;
      }
      try {
        const item = await fetcher(id);
        cache.set(key, item);
        items.push(item);
      } catch {
        // skip
      }
    })
  );

  return items;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ProfileSeeAllScreen({ route, navigation }: Props) {
  const { section, filter: initialFilter } = route.params;
  const currentTheme = useTheme();
  const isFocused = useIsFocused();

  const [filter, setFilter] = useState<"movie" | "tv">(initialFilter);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const cacheRef = useRef<Cache>(new Map());

  const { watchlist: movieWatchlist, reload: reloadWl } = useWatchlist();
  const { watchlist: seriesWatchlist, reload: reloadSwl } = useSeriesWatchlist();
  const { likedMovies, reload: reloadLm } = useLikedMovies();
  const { likedSeries, reload: reloadLs } = useLikedSeries();
  const { history: watchHistory, reload: reloadWh } = useWatchHistory();

  useEffect(() => {
    if (isFocused) {
      void reloadWl();
      void reloadSwl();
      void reloadLm();
      void reloadLs();
      void reloadWh();
    }
  }, [isFocused, reloadWl, reloadSwl, reloadLm, reloadLs, reloadWh]);

  const ids = useMemo(() => {
    if (section === "watched") return [];
    if (section === "watchlist") {
      return filter === "movie" ? movieWatchlist : seriesWatchlist;
    }
    return filter === "movie" ? likedMovies : likedSeries;
  }, [section, filter, movieWatchlist, seriesWatchlist, likedMovies, likedSeries]);

  useEffect(() => {
    if (section === "watched") {
      const mediaType: MediaType = filter === "tv" ? "tv" : "movie";
      const watchedItems: MediaItem[] = watchHistory
        .filter((e) => e.mediaType === mediaType)
        .map((e) => ({
          id: e.id,
          title: e.title,
          posterPath: e.posterPath,
          backdropPath: null,
          rating: e.voteAverage,
          overview: "",
          year: e.year,
          mediaType: e.mediaType,
        }));
      setItems(watchedItems);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    hydrateList(ids, filter === "movie" ? "movie" : "tv", cacheRef.current).then((result) => {
      if (!cancelled) {
        setItems(result);
        setIsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [ids, filter, section, watchHistory]);

  const handlePressItem = useCallback(
    (item: MediaItem) => {
      if (item.mediaType === "movie") {
        navigation.navigate("MovieDetail", { movieId: String(item.id) });
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.id) });
      }
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MediaItem>) => {
      const posterUri = getTmdbImageUrl(item.posterPath, "w342");
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
            <Badge>
              <Feather name="star" size={10} color="#FFD700" style={{ marginRight: 3 }} />
              <BadgeValue>{item.rating.toFixed(1)}</BadgeValue>
            </Badge>
          </PosterFrame>
          <Title numberOfLines={1}>{item.title}</Title>
          <Meta>{item.year}</Meta>
        </CardRoot>
      );
    },
    [handlePressItem]
  );

  const keyExtractor = useCallback((item: MediaItem) => `${item.mediaType}-${item.id}`, []);

  const title = section === "watchlist" ? "Watchlist" : section === "liked" ? "Liked" : "Watched";

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{title}</ScreenTitle>
      </HeaderRow>

      <ToggleRow>
        <ToggleChip $active={filter === "movie"} onPress={() => setFilter("movie")}>
          <ToggleLabel $active={filter === "movie"}>Movies</ToggleLabel>
        </ToggleChip>
        <ToggleChip $active={filter === "tv"} onPress={() => setFilter("tv")}>
          <ToggleLabel $active={filter === "tv"}>Series</ToggleLabel>
        </ToggleChip>
      </ToggleRow>

      {isLoading ? (
        <LoadingWrap>
          <MovieLoader size={44} label="Loading..." />
        </LoadingWrap>
      ) : items.length === 0 ? (
        <EmptyWrap>
          <Feather
            name={section === "watchlist" ? "bookmark" : section === "liked" ? "heart" : "play-circle"}
            size={32}
            color={currentTheme.colors.textSecondary}
          />
          <EmptyText>No {filter === "movie" ? "movies" : "series"} yet</EmptyText>
        </EmptyWrap>
      ) : (
        <GridWrap>
          <FlatList
            data={items}
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
