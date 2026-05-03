import { Feather } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, FlatList, ListRenderItemInfo } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl, type MediaItem } from "../api/tmdb";
import { formatRating } from "../api/mediaFormatting";
import { SafeContainer } from "../components/common/SafeContainer";
import { MovieLoader } from "../components/common/MovieLoader";
import { useWatchHistory, type WatchHistoryEntry } from "../hooks/useWatchHistory";
import { normalizeAppLanguage, type AppLanguage } from "../localization/types";
import type { StatsStackParamList } from "../navigation/types";
import { getSharedHydratedMediaCache, hydrateMediaIds } from "../services/mediaHydration";

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

function getHydrationSourceId(item: WatchHistoryEntry) {
  const sourceId = item.sourceTmdbId ?? item.id;
  const numericId = Number(sourceId);

  if (!Number.isFinite(numericId)) {
    return null;
  }

  return sourceId;
}

function getHydrationKey(language: AppLanguage, mediaType: WatchHistoryEntry["mediaType"], id: number | string) {
  return `${language}:${mediaType}-${id}`;
}

export function WatchedGridScreen({ route, navigation }: Props) {
  const { t, i18n: translationI18n } = useTranslation();
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
  const [hydratedItems, setHydratedItems] = useState<Map<string, MediaItem>>(new Map());
  const { history, rawHistory, activityHistory, isLoading, reload } = useWatchHistory();
  const hydratedCache = useMemo(() => getSharedHydratedMediaCache(), []);
  const resolvedContentLanguage = useMemo(
    () => normalizeAppLanguage(translationI18n.resolvedLanguage ?? translationI18n.language),
    [translationI18n.language, translationI18n.resolvedLanguage]
  );

  useEffect(() => {
    if (isFocused) void reload();
  }, [isFocused, reload]);

  const filtered = useMemo(() => {
    const sourceHistory =
      ids && ids.length > 0 ? rawHistory : monthTimestamp ? activityHistory : history;
    let items = sourceHistory.filter((e) => e.mediaType === (filter === "tv" ? "tv" : "movie"));
    if (genres && genres.length > 0) {
      items = items.filter((e) => genres.every((requestedGenre: string) => e.genres.includes(requestedGenre)));
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
  }, [activityHistory, rawHistory, history, filter, genre, genres, actorId, directorId, ratingMin, ratingMax, decadeMin, decadeMax, monthTimestamp, watchedAtMin, watchedAtMax, ids]);

  useEffect(() => {
    let cancelled = false;
    const movieIds = new Set<number | string>();
    const seriesIds = new Set<number | string>();
    const cachedItems = new Map<string, MediaItem>();

    for (const item of filtered) {
      const sourceId = getHydrationSourceId(item);
      if (sourceId === null) {
        continue;
      }

      const key = getHydrationKey(resolvedContentLanguage, item.mediaType, sourceId);
      const cached = hydratedCache.get(key);
      if (cached) {
        cachedItems.set(key, cached);
      }

      if (item.mediaType === "movie") {
        movieIds.add(sourceId);
      } else {
        seriesIds.add(sourceId);
      }
    }

    setHydratedItems(cachedItems);

    if (movieIds.size === 0 && seriesIds.size === 0) {
      return;
    }

    async function hydrateCurrentLanguage() {
      const hydrated = await hydrateMediaIds([...movieIds], [...seriesIds], hydratedCache);
      if (cancelled) {
        return;
      }

      const nextItems = new Map(cachedItems);
      for (const item of hydrated) {
        nextItems.set(getHydrationKey(resolvedContentLanguage, item.mediaType, item.id), item);
      }
      setHydratedItems(nextItems);
    }

    void hydrateCurrentLanguage();

    return () => {
      cancelled = true;
    };
  }, [filtered, hydratedCache, resolvedContentLanguage]);

  const handlePressItem = useCallback(
    (item: WatchHistoryEntry) => {
      if (item.mediaType === "movie") {
        const movieId = item.sourceTmdbId ?? item.id;
        if (!Number.isFinite(Number(movieId))) {
          return;
        }
        navigation.navigate("MovieDetail", { movieId: String(movieId) });
      } else {
        navigation.navigate("SeriesDetail", { seriesId: String(item.sourceTmdbId ?? item.id) });
      }
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<WatchHistoryEntry>) => {
      const sourceId = getHydrationSourceId(item);
      const hydrated =
        sourceId === null
          ? null
          : hydratedItems.get(getHydrationKey(resolvedContentLanguage, item.mediaType, sourceId)) ?? null;
      const displayPosterPath = hydrated?.posterPath ?? item.posterPath;
      const displayTitle =
        hydrated && item.historyKind === "season" && item.seasonNumber != null
          ? `${hydrated.title} - ${t("detail.seasonLabel", { number: item.seasonNumber })}`
          : hydrated?.title ?? item.title;
      const displayYear = hydrated?.year ?? item.year;
      const displayRating = hydrated?.rating ?? item.voteAverage;
      const posterUri =
        displayPosterPath?.startsWith("http")
          ? displayPosterPath
          : displayPosterPath
          ? getTmdbImageUrl(displayPosterPath, "w342")
          : null;
      return (
        <CardRoot onPress={() => handlePressItem(item)}>
          <PosterFrame>
            {posterUri ? (
              <PosterImage source={{ uri: posterUri }} resizeMode="cover" />
            ) : (
              <NoImage>
                <NoImageText>{t("common.noImage")}</NoImageText>
              </NoImage>
            )}
            {typeof item.id !== "string" && (
              <Badge>
                <Feather name="star" size={10} color="#FFD700" style={{ marginRight: 3 }} />
                <BadgeValue>{formatRating(displayRating)}</BadgeValue>
              </Badge>
            )}
          </PosterFrame>
          <Title numberOfLines={1}>{displayTitle}</Title>
          <Meta>{displayYear}</Meta>
        </CardRoot>
      );
    },
    [handlePressItem, hydratedItems, resolvedContentLanguage, t]
  );

  const keyExtractor = useCallback((item: WatchHistoryEntry) => `${item.mediaType}-${item.id}`, []);

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{screenTitle ?? t("profile.watched")}</ScreenTitle>
      </HeaderRow>

      {!hasExtraFilter && (
        <ToggleRow>
          <ToggleChip $active={filter === "movie"} onPress={() => setFilter("movie")}>
            <ToggleLabel $active={filter === "movie"}>{t("common.movies")}</ToggleLabel>
          </ToggleChip>
          <ToggleChip $active={filter === "tv"} onPress={() => setFilter("tv")}>
            <ToggleLabel $active={filter === "tv"}>{t("common.series")}</ToggleLabel>
          </ToggleChip>
        </ToggleRow>
      )}

      {isLoading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : filtered.length === 0 ? (
        <EmptyWrap>
          <Feather name="play-circle" size={32} color={currentTheme.colors.textSecondary} />
          <EmptyText>{filter === "movie" ? t("profile.noMoviesWatchedYet") : t("profile.noSeriesWatchedYet")}</EmptyText>
        </EmptyWrap>
      ) : (
        <GridWrap>
          <FlatList
            data={filtered}
            numColumns={NUM_COLUMNS}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
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
