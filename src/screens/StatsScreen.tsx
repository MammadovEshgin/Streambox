import { Feather } from "@expo/vector-icons";
import { Fragment } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import type { MediaItem } from "../api/tmdb";
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
import { useLikedMovies } from "../hooks/useLikedMovies";
import { useLikedSeries } from "../hooks/useLikedSeries";
import { useWatchHistory } from "../hooks/useWatchHistory";
import type { StatsStackParamList } from "../navigation/types";
import { getSharedHydratedMediaCache, hydrateMediaIds, type HydratedMediaCache } from "../services/mediaHydration";

type Props = NativeStackScreenProps<StatsStackParamList, "StatsFeed">;
type HydratedCache = HydratedMediaCache;

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

export function StatsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { history, isLoading } = useWatchHistory();
  const { likedMovies, isLoading: likedMoviesLoading } = useLikedMovies();
  const { likedSeries, isLoading: likedSeriesLoading } = useLikedSeries();
  const [filter, setFilter] = useState<"movie" | "tv">("movie");
  const [likedMovieItems, setLikedMovieItems] = useState<MediaItem[]>([]);
  const [likedSeriesItems, setLikedSeriesItems] = useState<MediaItem[]>([]);
  const likedCacheRef = useRef<HydratedCache>(getSharedHydratedMediaCache());

  useEffect(() => {
    if (likedMoviesLoading || likedSeriesLoading) {
      return;
    }

    let cancelled = false;

    async function hydrateLikedMedia() {
      const cache = likedCacheRef.current;
      const [movieItems, seriesItems] = await Promise.all([
        hydrateMediaIds(likedMovies, [], cache),
        hydrateMediaIds([], likedSeries, cache),
      ]);

      if (!cancelled) {
        startTransition(() => {
          setLikedMovieItems(movieItems);
          setLikedSeriesItems(seriesItems);
        });
      }
    }

    void hydrateLikedMedia();

    return () => {
      cancelled = true;
    };
  }, [likedMovies, likedMoviesLoading, likedSeries, likedSeriesLoading]);

  const filtered = useMemo(() => history.filter((entry) => entry.mediaType === filter), [history, filter]);
  const totalMinutes = filtered.reduce((sum, entry) => sum + (entry.runtimeMinutes ?? 0), 0);
  const totalHours = Math.round(totalMinutes / 60);
  const totalEpisodes = filtered.reduce((sum, entry) => sum + (entry.episodeCount ?? 0), 0);
  const avgRating = filtered.length > 0 ? Math.round((filtered.reduce((sum, entry) => sum + entry.voteAverage, 0) / filtered.length) * 10) / 10 : 0;
  const itemLabels = filter === "movie" ? { singular: "movie", plural: "movies" } : { singular: "series", plural: "series" };

  const handleActorPress = (actorId: number, actorName: string) => {
    navigation.navigate("WatchedGrid", { filter, title: actorName, actorId });
  };

  const handleWatchedPress = () => {
    navigation.navigate("WatchedGrid", { filter, title: "Watched" });
  };

  const handleGenrePress = (genre: string) => {
    navigation.navigate("WatchedGrid", { filter, title: genre, genre });
  };

  const handleBucketPress = (min: number, max: number) => {
    navigation.navigate("WatchedGrid", { filter, title: `Rated ${min}-${max}`, ratingMin: min, ratingMax: max });
  };

  const handleDecadePress = (min: number, max: number, label: string) => {
    navigation.navigate("WatchedGrid", { filter, title: label, decadeMin: min, decadeMax: max });
  };

  const handleMonthPress = (monthTimestamp: number, label: string) => {
    navigation.navigate("WatchedGrid", { filter, title: label, monthTimestamp });
  };

  const handleRuntimePress = (entry: { id: number; mediaType: string }) => {
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
      node: <ActivityChart history={filtered} />,
      delay: 60,
      gapAfter: 16,
    },
    {
      key: "genre-breakdown",
      node: <GenreBreakdown history={filtered} itemLabelPlural={itemLabels.plural} onGenrePress={handleGenrePress} />,
      delay: 120,
      gapAfter: 16,
    },
    {
      key: "genre-radar",
      node: <GenreRadar history={filtered} onGenrePress={handleGenrePress} />,
      delay: 180,
      gapAfter: 16,
    },
    {
      key: "decades",
      node: <DecadeBreakdown history={filtered} itemLabelPlural={itemLabels.plural} onDecadePress={handleDecadePress} />,
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
      node: <TasteTimeline history={filtered} itemLabelPlural={itemLabels.plural} onMonthPress={handleMonthPress} />,
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
          <EmptyText>Start watching to unlock your stats.</EmptyText>
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
