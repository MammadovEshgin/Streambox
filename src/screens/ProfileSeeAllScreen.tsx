import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, FlatList, ListRenderItemInfo, Modal, Pressable, TouchableWithoutFeedback } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import {
  GENRE_ID_MAP,
  MediaItem,
  MediaType,
  getTmdbImageUrl,
  getMovieSummary,
  getSeriesSummary
} from "../api/tmdb";
import { formatRating } from "../api/mediaFormatting";
import { SafeContainer } from "../components/common/SafeContainer";
import { MovieLoader } from "../components/common/MovieLoader";
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useLikedSeries } from "../hooks/useLikedSeries";
import { useSeriesWatchlist } from "../hooks/useSeriesWatchlist";
import { useWatchHistory, type WatchHistoryEntry } from "../hooks/useWatchHistory";
import { useWatchlist } from "../hooks/useWatchlist";
import { normalizeAppLanguage, type AppLanguage } from "../localization/types";
import type { ProfileStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "ProfileSeeAll">;
type ProfileShelfSort = "recent" | "rating" | "year" | "title";
type ProfileShelfFilters = {
  sortBy: ProfileShelfSort;
  genre: string | null;
};
type ProfileShelfRecord = {
  item: MediaItem;
  order: number;
  watchedAt?: number;
  genres: string[];
};

const DEFAULT_SHELF_FILTERS: ProfileShelfFilters = {
  sortBy: "recent",
  genre: null,
};

const PROFILE_SHELF_SORT_OPTIONS: readonly ProfileShelfSort[] = ["recent", "rating", "year", "title"];

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
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 12px;
`;

const ToggleGroup = styled.View`
  flex-direction: row;
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

const FilterIconButton = styled.Pressable<{ $active: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? `${theme.colors.primary}40` : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised)};
  align-items: center;
  justify-content: center;
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

const FilterSheetOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.74);
  justify-content: flex-end;
`;

const FilterSheet = styled.View`
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-top-width: 1px;
  border-left-width: 1px;
  border-right-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: 12px 18px 18px;
`;

const FilterSheetHandle = styled.View`
  width: 42px;
  height: 4px;
  border-radius: 999px;
  align-self: center;
  background-color: rgba(255, 255, 255, 0.16);
`;

const FilterSheetTitle = styled.Text`
  margin-top: 18px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.35px;
`;

const FilterSheetSubtitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
`;

const FilterSection = styled.View`
  margin-top: 22px;
`;

const FilterSectionLabel = styled.Text`
  margin-bottom: 12px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const FilterChipWrap = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`;

const FilterChip = styled.Pressable<{ $active: boolean }>`
  padding: 8px 12px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? `${theme.colors.primary}4D` : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised)};
`;

const FilterChipText = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textSecondary)};
  font-size: 12px;
  line-height: 15px;
  font-weight: 500;
`;

const FilterSheetEmpty = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 17px;
`;

const FilterSheetFooter = styled.View`
  margin-top: 24px;
  flex-direction: row;
  gap: 10px;
`;

const FilterFooterButton = styled.Pressable<{ $primary?: boolean }>`
  flex: 1;
  min-height: 46px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $primary, theme }) => ($primary ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised)};
`;

const FilterFooterLabel = styled.Text<{ $primary?: boolean }>`
  color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.textPrimary)};
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
`;

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

type Cache = Map<string, MediaItem>;

async function hydrateList(
  ids: (number | string)[],
  type: MediaType,
  cache: Cache,
  language: AppLanguage
): Promise<MediaItem[]> {
  const fetcher = type === "movie" ? getMovieSummary : getSeriesSummary;

  const items = await Promise.all(
    ids.map(async (id) => {
      const key = `${language}:${type}-${id}`;
      if (cache.has(key)) {
        return cache.get(key) ?? null;
      }
      try {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) {
          return null;
        }
        const item = await fetcher(numericId);

        if (item) {
          cache.set(key, item);
        }
        return item;
      } catch {
        return null;
      }
    })
  );

  return items.filter((item): item is MediaItem => item !== null);
}

function deriveGenresFromMediaItem(item: MediaItem): string[] {
  return (item.genreIds ?? [])
    .map((genreId) => GENRE_ID_MAP[genreId])
    .filter((genreName): genreName is string => typeof genreName === "string" && genreName.length > 0);
}

function buildHydratedShelfRecords(items: MediaItem[]): ProfileShelfRecord[] {
  return items.map((item, index) => ({
    item,
    order: index,
    genres: deriveGenresFromMediaItem(item),
  }));
}

function getWatchHistoryMediaId(entry: WatchHistoryEntry) {
  const sourceId = entry.sourceTmdbId ?? entry.id;
  const numericId = Number(sourceId);

  if (!Number.isFinite(numericId)) {
    return null;
  }

  return sourceId;
}

function getAvailableGenres(records: ProfileShelfRecord[]) {
  return Array.from(new Set(records.flatMap((record) => record.genres))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function applyShelfFilters(records: ProfileShelfRecord[], filters: ProfileShelfFilters): MediaItem[] {
  let next = filters.genre
    ? records.filter((record) => record.genres.includes(filters.genre ?? ""))
    : records.slice();

  switch (filters.sortBy) {
    case "rating":
      next.sort((left, right) => (right.item.rating ?? 0) - (left.item.rating ?? 0));
      break;
    case "year":
      next.sort((left, right) => Number(right.item.year || 0) - Number(left.item.year || 0));
      break;
    case "title":
      next.sort((left, right) => left.item.title.localeCompare(right.item.title));
      break;
    case "recent":
    default:
      next.sort((left, right) => {
        if (typeof left.watchedAt === "number" || typeof right.watchedAt === "number") {
          return (right.watchedAt ?? 0) - (left.watchedAt ?? 0);
        }
        return left.order - right.order;
      });
      break;
  }

  return next.map((record) => record.item);
}

function isShelfFilterActive(filters: ProfileShelfFilters) {
  return filters.sortBy !== DEFAULT_SHELF_FILTERS.sortBy || filters.genre !== DEFAULT_SHELF_FILTERS.genre;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ProfileSeeAllScreen({ route, navigation }: Props) {
  const { section, filter: initialFilter } = route.params;
  const { t, i18n: translationI18n } = useTranslation();
  const currentTheme = useTheme();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const resolvedContentLanguage = useMemo(
    () => normalizeAppLanguage(translationI18n.resolvedLanguage ?? translationI18n.language),
    [translationI18n.language, translationI18n.resolvedLanguage]
  );

  const [filter, setFilter] = useState<"movie" | "tv">(initialFilter);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<ProfileShelfFilters>(DEFAULT_SHELF_FILTERS);
  const [draftFilters, setDraftFilters] = useState<ProfileShelfFilters>(DEFAULT_SHELF_FILTERS);
  const [filterVisible, setFilterVisible] = useState(false);

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

  useEffect(() => {
    setFilters(DEFAULT_SHELF_FILTERS);
    setDraftFilters(DEFAULT_SHELF_FILTERS);
  }, [filter, section]);

  const ids = useMemo(() => {
    if (section === "watched") return [];
    if (section === "watchlist") {
      return filter === "movie" ? movieWatchlist : seriesWatchlist;
    }
    return filter === "movie" ? likedMovies : likedSeries;
  }, [section, filter, movieWatchlist, seriesWatchlist, likedMovies, likedSeries]);

  useEffect(() => {
    let cancelled = false;

    if (section === "watched") {
      const mediaType: MediaType = filter === "tv" ? "tv" : "movie";
      const watchedEntries = watchHistory.filter((entry) => entry.mediaType === mediaType);
      const watchedIds = Array.from(
        new Set(
          watchedEntries
            .map(getWatchHistoryMediaId)
            .filter((id): id is number | string => id !== null)
        )
      );

      setIsLoading(true);
      hydrateList(watchedIds, mediaType, cacheRef.current, resolvedContentLanguage).then((localizedItems) => {
        if (cancelled) {
          return;
        }

        const localizedById = new Map(localizedItems.map((item) => [String(item.id), item]));
        const watchedItems: MediaItem[] = watchedEntries.map((entry) => {
          const sourceId = getWatchHistoryMediaId(entry);
          const localizedItem = sourceId === null ? null : localizedById.get(String(sourceId)) ?? null;

          return {
            id: sourceId ?? entry.id,
            title: localizedItem?.title ?? entry.title,
            posterPath: localizedItem?.posterPath ?? entry.posterPath,
            backdropPath: localizedItem?.backdropPath ?? null,
            rating: localizedItem?.rating ?? entry.voteAverage,
            overview: localizedItem?.overview ?? "",
            year: localizedItem?.year ?? entry.year,
            mediaType: entry.mediaType,
            genreIds: localizedItem?.genreIds,
          };
        });

        setItems(watchedItems);
        setIsLoading(false);
      });

      return () => { cancelled = true; };
    }

    if (ids.length === 0) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    hydrateList(ids, filter === "movie" ? "movie" : "tv", cacheRef.current, resolvedContentLanguage).then((result) => {
      if (!cancelled) {
        setItems(result);
        setIsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [ids, filter, resolvedContentLanguage, section, watchHistory]);

  const shelfRecords = useMemo<ProfileShelfRecord[]>(() => {
    if (section === "watched") {
      const watchedEntries = watchHistory.filter((entry) => entry.mediaType === (filter === "tv" ? "tv" : "movie"));
      const watchedMeta = new Map(
        watchedEntries.map((entry) => [String(getWatchHistoryMediaId(entry) ?? entry.id), entry])
      );

      return items.map((item, index) => {
        const entry = watchedMeta.get(String(item.id));
        return {
          item,
          order: index,
          watchedAt: entry?.watchedAt,
          genres: deriveGenresFromMediaItem(item),
        };
      });
    }

    return buildHydratedShelfRecords(items);
  }, [filter, items, section, watchHistory]);

  const genreOptions = useMemo(() => getAvailableGenres(shelfRecords), [shelfRecords]);

  useEffect(() => {
    if (filters.genre && !genreOptions.includes(filters.genre)) {
      setFilters((current) => ({ ...current, genre: null }));
    }
  }, [filters.genre, genreOptions]);

  useEffect(() => {
    if (draftFilters.genre && !genreOptions.includes(draftFilters.genre)) {
      setDraftFilters((current) => ({ ...current, genre: null }));
    }
  }, [draftFilters.genre, genreOptions]);

  const filteredItems = useMemo(() => applyShelfFilters(shelfRecords, filters), [filters, shelfRecords]);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters(filters);
    setFilterVisible(true);
  }, [filters]);

  const handleCloseFilters = useCallback(() => {
    setFilterVisible(false);
    setDraftFilters(filters);
  }, [filters]);

  const handleApplyFilters = useCallback(() => {
    setFilters(draftFilters);
    setFilterVisible(false);
  }, [draftFilters]);

  const handleResetFilters = useCallback(() => {
    setDraftFilters(DEFAULT_SHELF_FILTERS);
    setFilters(DEFAULT_SHELF_FILTERS);
    setFilterVisible(false);
  }, []);

  const getSortLabel = useCallback(
    (sortOption: ProfileShelfSort) => {
      switch (sortOption) {
        case "rating":
          return t("profile.sortHighestRated");
        case "year":
          return t("profile.sortNewestYear");
        case "title":
          return t("profile.sortTitleAZ");
        case "recent":
        default:
          return t("profile.sortRecentlyAdded");
      }
    },
    [t]
  );

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
      const posterUri =
        item.posterPath?.startsWith("http")
          ? item.posterPath
          : getTmdbImageUrl(item.posterPath, "w342");
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
                <BadgeValue>{formatRating(item.rating)}</BadgeValue>
              </Badge>
            )}
          </PosterFrame>
          <Title numberOfLines={1}>{item.title}</Title>
          <Meta>{item.year}</Meta>
        </CardRoot>
      );
    },
    [handlePressItem, t]
  );

  const keyExtractor = useCallback((item: MediaItem) => `${item.mediaType}-${item.id}`, []);

  const title = section === "watchlist" ? t("profile.watchlist") : section === "liked" ? t("profile.liked") : t("profile.watched");
  const emptyText = section === "watchlist"
    ? (filter === "movie" ? t("profile.noMoviesInWatchlist") : t("profile.noSeriesInWatchlist"))
    : section === "liked"
      ? (filter === "movie" ? t("profile.noMoviesLikedYet") : t("profile.noSeriesLikedYet"))
      : (filter === "movie" ? t("profile.noMoviesWatchedYet") : t("profile.noSeriesWatchedYet"));

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{title}</ScreenTitle>
      </HeaderRow>

      <ToggleRow>
        <ToggleGroup>
          <ToggleChip $active={filter === "movie"} onPress={() => setFilter("movie")}>
            <ToggleLabel $active={filter === "movie"}>{t("common.movies")}</ToggleLabel>
          </ToggleChip>
          <ToggleChip $active={filter === "tv"} onPress={() => setFilter("tv")}>
            <ToggleLabel $active={filter === "tv"}>{t("common.series")}</ToggleLabel>
          </ToggleChip>
        </ToggleGroup>
        <FilterIconButton $active={isShelfFilterActive(filters)} onPress={handleOpenFilters}>
          <Feather
            name="sliders"
            size={15}
            color={isShelfFilterActive(filters) ? currentTheme.colors.primary : currentTheme.colors.textSecondary}
          />
        </FilterIconButton>
      </ToggleRow>

      {isLoading ? (
        <LoadingWrap>
          <MovieLoader size={44} label={t("common.loading")} />
        </LoadingWrap>
      ) : filteredItems.length === 0 ? (
        <EmptyWrap>
          <Feather
            name={section === "watchlist" ? "bookmark" : section === "liked" ? "heart" : "play-circle"}
            size={32}
            color={currentTheme.colors.textSecondary}
          />
          <EmptyText>{emptyText}</EmptyText>
        </EmptyWrap>
      ) : (
        <GridWrap>
          <FlatList
            data={filteredItems}
            numColumns={NUM_COLUMNS}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            columnWrapperStyle={{ gap: GAP }}
            showsVerticalScrollIndicator={false}
          />
        </GridWrap>
      )}

      <Modal visible={filterVisible} transparent animationType="fade" statusBarTranslucent>
        <TouchableWithoutFeedback onPress={handleCloseFilters}>
          <FilterSheetOverlay>
            <TouchableWithoutFeedback onPress={() => undefined}>
              <FilterSheet style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
                <FilterSheetHandle />
                <FilterSheetTitle>{t("profile.filterSheetTitle")}</FilterSheetTitle>
                <FilterSheetSubtitle>
                  {section === "watched"
                    ? t("profile.filterWatchedDescription")
                    : section === "watchlist"
                      ? t("profile.filterWatchlistDescription")
                      : t("profile.filterLikedDescription")}
                </FilterSheetSubtitle>

                <FilterSection>
                  <FilterSectionLabel>{t("profile.sortBy")}</FilterSectionLabel>
                  <FilterChipWrap>
                    {PROFILE_SHELF_SORT_OPTIONS.map((sortOption) => (
                      <FilterChip
                        key={sortOption}
                        $active={draftFilters.sortBy === sortOption}
                        onPress={() => setDraftFilters((current) => ({ ...current, sortBy: sortOption }))}
                      >
                        <FilterChipText $active={draftFilters.sortBy === sortOption}>
                          {getSortLabel(sortOption)}
                        </FilterChipText>
                      </FilterChip>
                    ))}
                  </FilterChipWrap>
                </FilterSection>

                <FilterSection>
                  <FilterSectionLabel>{t("profile.genreFilterTitle")}</FilterSectionLabel>
                  {genreOptions.length > 0 ? (
                    <FilterChipWrap>
                      <FilterChip
                        $active={draftFilters.genre === null}
                        onPress={() => setDraftFilters((current) => ({ ...current, genre: null }))}
                      >
                        <FilterChipText $active={draftFilters.genre === null}>
                          {t("profile.allGenres")}
                        </FilterChipText>
                      </FilterChip>
                      {genreOptions.map((genre) => (
                        <FilterChip
                          key={genre}
                          $active={draftFilters.genre === genre}
                          onPress={() => setDraftFilters((current) => ({ ...current, genre }))}
                        >
                          <FilterChipText $active={draftFilters.genre === genre}>{genre}</FilterChipText>
                        </FilterChip>
                      ))}
                    </FilterChipWrap>
                  ) : (
                    <FilterSheetEmpty>{t("profile.noGenreFiltersAvailable")}</FilterSheetEmpty>
                  )}
                </FilterSection>

                <FilterSheetFooter>
                  <FilterFooterButton onPress={handleResetFilters}>
                    <FilterFooterLabel>{t("profile.resetFilters")}</FilterFooterLabel>
                  </FilterFooterButton>
                  <FilterFooterButton $primary={true} onPress={handleApplyFilters}>
                    <FilterFooterLabel $primary={true}>{t("profile.applyFilters")}</FilterFooterLabel>
                  </FilterFooterButton>
                </FilterSheetFooter>
              </FilterSheet>
            </TouchableWithoutFeedback>
          </FilterSheetOverlay>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeContainer>
  );
}
