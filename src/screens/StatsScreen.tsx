import { Feather } from "@expo/vector-icons";
import { Fragment } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { getMovieGenres, getTvGenres, type MediaItem } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { ActivityChart } from "../components/stats/ActivityChart";
import { DecadeBreakdown } from "../components/stats/DecadeBreakdown";
import { GenreBreakdown } from "../components/stats/GenreBreakdown";
import { GenreRadar } from "../components/stats/GenreRadar";
import { RatingDistribution } from "../components/stats/RatingDistribution";
import { RuntimeExtremes } from "../components/stats/RuntimeExtremes";
import { StatsOverviewHero } from "../components/stats/StatsOverviewHero";
import { TasteTimeline } from "../components/stats/TasteTimeline";
import { TopActors } from "../components/stats/TopActors";
import { ViewerPersona } from "../components/stats/ViewerPersona";
import { useWatchHistory, type WatchHistoryEntry } from "../hooks/useWatchHistory";
import { normalizeAppLanguage, type AppLanguage } from "../localization/types";
import type { StatsStackParamList } from "../navigation/types";
import { getSharedHydratedMediaCache, hydrateMediaIds } from "../services/mediaHydration";

type Props = NativeStackScreenProps<StatsStackParamList, "StatsFeed">;

const EmptyWrap = styled(Animated.View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-horizontal: 32px;
`;

const EmptyText = styled.Text`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: 12px;
  line-height: 22px;
`;

const LoadWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const BottomSpacer = styled.View`
  height: 40px;
`;

/** Spacing between section groups — varies for visual rhythm */
const SectionGap = styled.View<{ $size?: number }>`
  height: ${({ $size }) => $size ?? 16}px;
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

function buildGenreMap(genres: { id: number; name: string }[]) {
  return new Map(genres.map((genre) => [genre.id, genre.name]));
}

export function StatsScreen({ navigation }: Props) {
  const { t, i18n: translationI18n } = useTranslation();
  const theme = useTheme();
  const { history, activityHistory, isLoading } = useWatchHistory();
  const [filter, setFilter] = useState<"movie" | "tv">("movie");
  const [hydratedItems, setHydratedItems] = useState<Map<string, MediaItem>>(new Map());
  const [movieGenreNames, setMovieGenreNames] = useState<Map<number, string>>(new Map());
  const [tvGenreNames, setTvGenreNames] = useState<Map<number, string>>(new Map());
  const hydratedCache = useMemo(() => getSharedHydratedMediaCache(), []);
  const resolvedContentLanguage = useMemo(
    () => normalizeAppLanguage(translationI18n.resolvedLanguage ?? translationI18n.language),
    [translationI18n.language, translationI18n.resolvedLanguage]
  );

  useEffect(() => {
    let cancelled = false;
    const movieIds = new Set<number | string>();
    const seriesIds = new Set<number | string>();
    const cachedItems = new Map<string, MediaItem>();

    for (const entry of [...history, ...activityHistory]) {
      const sourceId = getHydrationSourceId(entry);
      if (sourceId === null) {
        continue;
      }

      const key = getHydrationKey(resolvedContentLanguage, entry.mediaType, sourceId);
      const cached = hydratedCache.get(key);
      if (cached) {
        cachedItems.set(key, cached);
      }

      if (entry.mediaType === "movie") {
        movieIds.add(sourceId);
      } else {
        seriesIds.add(sourceId);
      }
    }

    setHydratedItems(cachedItems);

    if (movieIds.size === 0 && seriesIds.size === 0) {
      setMovieGenreNames(new Map());
      setTvGenreNames(new Map());
      return;
    }

    async function hydrateStatsContent() {
      const [hydrated, movieGenres, tvGenres] = await Promise.all([
        hydrateMediaIds([...movieIds], [...seriesIds], hydratedCache).catch(() => []),
        getMovieGenres().catch(() => []),
        getTvGenres().catch(() => []),
      ]);

      if (cancelled) {
        return;
      }

      const nextItems = new Map(cachedItems);
      for (const item of hydrated) {
        nextItems.set(getHydrationKey(resolvedContentLanguage, item.mediaType, item.id), item);
      }

      setHydratedItems(nextItems);
      setMovieGenreNames(buildGenreMap(movieGenres));
      setTvGenreNames(buildGenreMap(tvGenres));
    }

    void hydrateStatsContent();

    return () => {
      cancelled = true;
    };
  }, [activityHistory, history, hydratedCache, resolvedContentLanguage]);

  const localizeEntry = useMemo(
    () => (entry: WatchHistoryEntry): WatchHistoryEntry => {
      const sourceId = getHydrationSourceId(entry);
      const localized =
        sourceId === null
          ? null
          : hydratedItems.get(getHydrationKey(resolvedContentLanguage, entry.mediaType, sourceId)) ?? null;
      const genreNames = entry.mediaType === "movie" ? movieGenreNames : tvGenreNames;
      const localizedGenres = (localized?.genreIds ?? [])
        .map((genreId) => genreNames.get(genreId))
        .filter((genreName): genreName is string => typeof genreName === "string" && genreName.length > 0);

      return {
        ...entry,
        title: localized?.title ?? entry.title,
        posterPath: localized?.posterPath ?? entry.posterPath,
        genres: localizedGenres.length > 0 ? localizedGenres : entry.genres,
        voteAverage: localized?.rating ?? entry.voteAverage,
        year: localized?.year ?? entry.year,
      };
    },
    [hydratedItems, movieGenreNames, resolvedContentLanguage, tvGenreNames]
  );

  const localizedHistory = useMemo(() => history.map(localizeEntry), [history, localizeEntry]);
  const localizedActivityHistory = useMemo(
    () => activityHistory.map(localizeEntry),
    [activityHistory, localizeEntry]
  );

  const filtered = useMemo(() => localizedHistory.filter((entry) => entry.mediaType === filter), [localizedHistory, filter]);
  const filteredActivity = useMemo(
    () => localizedActivityHistory.filter((entry) => entry.mediaType === filter),
    [localizedActivityHistory, filter]
  );
  const totalMinutes = filtered.reduce((sum, entry) => sum + (entry.runtimeMinutes ?? 0), 0);
  const totalHours = Math.round(totalMinutes / 60);
  const totalEpisodes = filtered.reduce((sum, entry) => sum + (entry.episodeCount ?? 0), 0);
  const avgRating = filtered.length > 0 ? Math.round((filtered.reduce((sum, entry) => sum + entry.voteAverage, 0) / filtered.length) * 10) / 10 : 0;
  const itemLabels = filter === "movie"
    ? { singular: t("common.movie").toLowerCase(), plural: t("common.movies").toLowerCase() }
    : { singular: t("common.series").toLowerCase(), plural: t("common.series").toLowerCase() };

  const handleActorPress = (actorId: number, actorName: string) => {
    navigation.navigate("WatchedGrid", { filter, title: actorName, actorId });
  };

  const handleGenrePress = (genre: string) => {
    const ids = filtered
      .filter((entry) => entry.genres.includes(genre))
      .map((entry) => entry.id);
    navigation.navigate("WatchedGrid", { filter, title: genre, ids });
  };

  const handleBucketPress = (min: number, max: number) => {
    navigation.navigate("WatchedGrid", { filter, title: t("stats.ratedRange", { min, max }), ratingMin: min, ratingMax: max });
  };

  const handleDecadePress = (min: number, max: number, label: string) => {
    navigation.navigate("WatchedGrid", { filter, title: label, decadeMin: min, decadeMax: max });
  };

  const handleMonthPress = (monthTimestamp: number, label: string) => {
    const monthStart = new Date(monthTimestamp);
    const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime();
    const ids = filteredActivity
      .filter((entry) => entry.watchedAt >= monthTimestamp && entry.watchedAt < nextMonth)
      .map((entry) => entry.id);
    navigation.navigate("WatchedGrid", { filter, title: label, monthTimestamp, ids });
  };

  const handleRuntimePress = (entry: { id: number | string; mediaType: string }) => {
    if (entry.mediaType === "movie") {
      navigation.navigate("MovieDetail", { movieId: String(entry.id) });
    } else {
      navigation.navigate("SeriesDetail", { seriesId: String(entry.id) });
    }
  };

  /**
   * Section order tells a story:
   * 1. Activity — "how active have you been?"
   * 2. Genre Breakdown — "what do you watch?"
   * 3. Genre Radar — visual complement to breakdown
   * 4. Decades — "when were your picks from?"
   * 5. Top Actors — "who do you watch?"
   * 6. Ratings — "how do you rate?"
   * 7. Runtime — fun extremes
   * 8. Taste Evolution — monthly journey
   * 9. Persona — the payoff, identity reveal
   */
  const sections: { key: string; node: React.ReactNode; delay: number; gapAfter: number }[] = [
    {
      key: "activity",
      node: <ActivityChart history={filteredActivity} />,
      delay: 60,
      gapAfter: 16,
    },
    {
      key: "genre-breakdown",
      node: <GenreBreakdown history={filtered} isMovieMode={filter === "movie"} onGenrePress={handleGenrePress} />,
      delay: 120,
      gapAfter: 16,
    },
    {
      key: "genre-radar",
      node: <GenreRadar history={filtered} />,
      delay: 180,
      gapAfter: 16,
    },
    {
      key: "decades",
      node: <DecadeBreakdown history={filtered} isMovieMode={filter === "movie"} onDecadePress={handleDecadePress} />,
      delay: 240,
      gapAfter: 16,
    },
    {
      key: "actors",
      node: (
        <TopActors
          history={filtered}
          itemLabelSingular={itemLabels.singular}
          itemLabelPlural={itemLabels.plural}
          onActorPress={handleActorPress}
        />
      ),
      delay: 300,
      gapAfter: 16,
    },
    {
      key: "ratings",
      node: <RatingDistribution history={filtered} onBucketPress={handleBucketPress} />,
      delay: 360,
      gapAfter: 16,
    },
    {
      key: "runtime",
      node: <RuntimeExtremes history={filtered} onItemPress={handleRuntimePress} />,
      delay: 420,
      gapAfter: 16,
    },
    {
      key: "timeline",
      node: <TasteTimeline history={filteredActivity} isMovieMode={filter === "movie"} onMonthPress={handleMonthPress} />,
      delay: 480,
      gapAfter: 16,
    },
    {
      key: "viewer-persona",
      node: <ViewerPersona history={filtered} itemLabelPlural={itemLabels.plural} />,
      delay: 540,
      gapAfter: 0,
    },
  ];

  if (isLoading) {
    return (
      <SafeContainer>
        <LoadWrap>
          <MovieLoader size={44} />
        </LoadWrap>
      </SafeContainer>
    );
  }

  if (history.length === 0) {
    return (
      <SafeContainer>
        <EmptyWrap entering={FadeInDown.duration(400)}>
          <Feather name="bar-chart-2" size={48} color={theme.colors.textSecondary} />
          <EmptyText>{t("stats.emptyState")}</EmptyText>
        </EmptyWrap>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero enters immediately */}
        <Animated.View entering={FadeInUp.duration(500)}>
          <StatsOverviewHero
            filter={filter}
            totalWatched={filtered.length}
            totalHours={totalHours}
            totalEpisodes={totalEpisodes}
            avgRating={avgRating}
            onFilterChange={setFilter}
          />
        </Animated.View>

        <SectionGap $size={8} />

        {sections.map((section) => (
          <Fragment key={section.key}>
            <Animated.View entering={FadeInUp.delay(section.delay).duration(400)}>
              {section.node}
            </Animated.View>
            {section.gapAfter > 0 ? <SectionGap $size={section.gapAfter} /> : null}
          </Fragment>
        ))}
        <BottomSpacer />
      </ScrollView>
    </SafeContainer>
  );
}
