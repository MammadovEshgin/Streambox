import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, InteractionManager, LayoutChangeEvent, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import {
  FranchiseEntry,
  UserFranchiseProgress,
  getFranchiseEntries,
  getUserFranchiseProgress,
  refreshFranchiseEntries,
  refreshUserFranchiseProgress,
  toggleFranchiseEntryWatched,
} from "../api/franchises";
import { getMovieDetails, getSeriesDetails } from "../api/tmdb";
import { resolveFranchiseImageUriBlocking, warmFranchiseImageCache } from "../services/franchisePosterCache";
import { TimelinePath, NodeRect } from "../components/franchise/TimelinePath";
import { TimelineNode, POSTER_WIDTH, POSTER_HEIGHT, NODE_FULL_WIDTH } from "../components/franchise/TimelineNode";
import { ProgressRing } from "../components/franchise/ProgressRing";
import { MovieLoader } from "../components/common/MovieLoader";
import { SafeContainer } from "../components/common/SafeContainer";
import { HomeStackParamList } from "../navigation/types";
import { useAuth } from "../context/AuthContext";
import { useWatchHistory } from "../hooks/useWatchHistory";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Layout constants
const NODE_LEFT_MARGIN = (SCREEN_WIDTH - NODE_FULL_WIDTH) / 2;
const NODE_SPACING = 206;
const INITIAL_VISIBLE_COUNT = 12;

const Root = styled.View`
  flex: 1;
  background-color: #111114;
`;

const Header = styled.View`
  padding: 8px 16px 6px;
  flex-direction: row;
  align-items: center;
`;

const BackButton = styled.Pressable`
  width: 34px;
  height: 34px;
  border-radius: 10px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.06);
`;

const HeaderTextWrap = styled.View`
  margin-left: 12px;
  flex: 1;
`;

const HeaderTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 17px;
  line-height: 22px;
  font-family: Outfit_700Bold;
  letter-spacing: -0.3px;
`;

const HeaderSubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  line-height: 14px;
  font-family: Outfit_400Regular;
  letter-spacing: 0.15px;
  margin-top: 1px;
`;

// ── Progress Banner ─────────────────────────────────────────────────────
const ProgressBanner = styled.View`
  margin: 8px 16px 4px;
  padding: 16px 18px;
  border-radius: 16px;
  flex-direction: row;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.035);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.06);
`;

const ProgressInfo = styled.View`
  flex: 1;
  margin-left: 14px;
`;

const ProgressTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
  line-height: 18px;
  letter-spacing: -0.15px;
`;

const ProgressSubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.1px;
  margin-top: 2px;
`;

const NextUpRow = styled.Text`
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  letter-spacing: 0.1px;
  margin-top: 5px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const NextUpTitle = styled.Text<{ $color: string }>`
  color: ${({ $color }) => $color};
`;

// ── Timeline Container ──────────────────────────────────────────────────
const TimelineScroll = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
  contentContainerStyle: {
    paddingBottom: 80,
  },
})`
  flex: 1;
`;

const TimelineContainer = styled.View`
  position: relative;
  width: 100%;
`;

const NodePositioner = styled.View<{ $top: number; $left: number }>`
  position: absolute;
  top: ${({ $top }) => $top}px;
  left: ${({ $left }) => $left}px;
`;

// ── Loading / Error / Empty ─────────────────────────────────────────────
const LoadingWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
`;

const EmptyText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
  text-align: center;
  margin-top: 12px;
`;

// ── Action Toast ────────────────────────────────────────────────────────
const ToastWrap = styled(Animated.View)`
  position: absolute;
  bottom: 24px;
  left: 24px;
  right: 24px;
  padding: 14px 18px;
  border-radius: 14px;
  flex-direction: row;
  align-items: center;
  background-color: rgba(24, 24, 27, 0.95);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
`;

const ToastText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_500Medium;
  font-size: 13px;
  letter-spacing: 0.05px;
  margin-left: 10px;
  flex: 1;
`;

// ── End of Timeline ────────────────────────────────────────────────────
const EndOfTimelineWrap = styled.View`
  align-items: center;
  padding: 20px 32px 40px;
`;

const EndDivider = styled.View<{ $color: string }>`
  width: 1px;
  height: 36px;
  background-color: ${({ $color }) => `${$color}30`};
  margin-bottom: 16px;
`;

const EndDot = styled.View<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background-color: ${({ $color }) => `${$color}40`};
  border-width: 1.5px;
  border-color: ${({ $color }) => `${$color}60`};
  margin-bottom: 20px;
`;

const EndTitle = styled.Text<{ $color: string }>`
  color: ${({ $color }) => $color};
  font-family: Outfit_600SemiBold;
  font-size: 13px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 6px;
`;

const EndSubtitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
  letter-spacing: 0.1px;
  text-align: center;
  opacity: 0.6;
`;

type FranchiseTimelineProps = NativeStackScreenProps<HomeStackParamList, "FranchiseTimeline">;

export function FranchiseTimelineScreen({ route, navigation }: FranchiseTimelineProps) {
  const { franchiseId, franchiseTitle } = route.params;
  const theme = useTheme();
  const { user } = useAuth();
  const { saveMovieToWatchHistory, saveSeriesToWatchHistory, removeFromWatchHistory, isWatched: isInWatchHistory } = useWatchHistory();
  const accent = theme.colors.primary;

  const [entries, setEntries] = useState<FranchiseEntry[]>([]);
  const [progress, setProgress] = useState<UserFranchiseProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Scroll tracking for viewport-based SVG culling
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(Dimensions.get("window").height);

  // Pagination: load entries in chunks of 10 for performance
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const visibleEntries = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);

  const watchedEntryIds = useMemo(() => new Set(progress.map((p) => p.entryId)), [progress]);
  const watchedIndices = useMemo(() => {
    const set = new Set<number>();
    visibleEntries.forEach((entry, index) => {
      if (watchedEntryIds.has(entry.id)) set.add(index);
    });
    return set;
  }, [visibleEntries, watchedEntryIds]);

  const watchedCount = useMemo(
    () => entries.filter((e) => watchedEntryIds.has(e.id)).length,
    [entries, watchedEntryIds]
  );
  const progressFraction = entries.length > 0 ? watchedCount / entries.length : 0;

  // Find the next unwatched entry the user should watch
  const nextEntry = useMemo(() => {
    for (const entry of entries) {
      if (!watchedEntryIds.has(entry.id)) return entry;
    }
    return null;
  }, [entries, watchedEntryIds]);

  // ── Data Loading ────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    let warmTask: { cancel: () => void } | null = null;

    async function load() {
      setIsLoading(true);
      try {
        const [fetchedEntries, fetchedProgress] = await Promise.all([
          getFranchiseEntries(franchiseId),
          user ? getUserFranchiseProgress(user.id, franchiseId) : Promise.resolve([]),
        ]);

        if (!active) return;

        const priorityEntries = await Promise.all(
          fetchedEntries.map(async (entry, index) => {
            if (index >= INITIAL_VISIBLE_COUNT || !entry.posterUrl || entry.cachedPosterUrl) {
              return entry;
            }

            return {
              ...entry,
              cachedPosterUrl: await resolveFranchiseImageUriBlocking(entry.posterUrl),
            };
          })
        );

        if (!active) return;

        startTransition(() => {
          setEntries(priorityEntries);
          setProgress(fetchedProgress);
          setVisibleCount(INITIAL_VISIBLE_COUNT);
          setIsLoading(false);
        });

        void refreshFranchiseEntries(franchiseId)
          .then((freshEntries) => {
            if (!active) return;
            setEntries((currentEntries) => {
              const currentSignature = JSON.stringify(
                currentEntries.map((entry) => [
                  entry.id,
                  entry.title,
                  entry.year,
                  entry.watchOrder,
                  entry.posterUrl,
                  entry.cachedPosterUrl,
                  entry.tagline,
                  entry.note,
                  entry.runtimeMinutes,
                  entry.episodeCount,
                  entry.isReleased,
                ])
              );
              const freshSignature = JSON.stringify(
                freshEntries.map((entry) => [
                  entry.id,
                  entry.title,
                  entry.year,
                  entry.watchOrder,
                  entry.posterUrl,
                  entry.cachedPosterUrl,
                  entry.tagline,
                  entry.note,
                  entry.runtimeMinutes,
                  entry.episodeCount,
                  entry.isReleased,
                ])
              );
              return currentSignature === freshSignature ? currentEntries : freshEntries;
            });
          })
          .catch(() => undefined);

        if (user?.id) {
          void refreshUserFranchiseProgress(user.id, franchiseId)
            .then((freshProgress) => {
              if (!active) return;
              setProgress((currentProgress) => {
                const currentSignature = JSON.stringify(
                  currentProgress.map((item) => [item.entryId, item.watchedAt])
                );
                const freshSignature = JSON.stringify(
                  freshProgress.map((item) => [item.entryId, item.watchedAt])
                );
                return currentSignature === freshSignature ? currentProgress : freshProgress;
              });
            })
            .catch(() => undefined);
        }

        warmTask = InteractionManager.runAfterInteractions(() => {
          void warmFranchiseImageCache(priorityEntries.map((entry) => entry.posterUrl), 10).catch(() => undefined);
        });
      } catch (error) {
        console.warn("Failed to load franchise timeline:", error);
        if (active) setIsLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      warmTask?.cancel();
    };
  }, [franchiseId, user?.id]);

  // ── Toast Animation ────────────────────────────────────────────────
  const showToast = useCallback(
    (message: string) => {
      setToastMessage(message);
      Animated.sequence([
        Animated.spring(toastOpacity, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }),
        Animated.delay(2000),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setToastMessage(null));
    },
    [toastOpacity]
  );

  // ── Handlers ────────────────────────────────────────────────────────
  const handlePressEntry = useCallback(
    (entry: FranchiseEntry) => {
      if (!entry.tmdbId) return;

      if (entry.mediaType === "tv") {
        navigation.navigate("SeriesDetail", { seriesId: String(entry.tmdbId) });
      } else {
        navigation.navigate("MovieDetail", { movieId: String(entry.tmdbId) });
      }
    },
    [navigation]
  );

  const handleLongPressEntry = useCallback(
    async (entry: FranchiseEntry) => {
      if (!user) {
        showToast("Sign in to track your progress");
        return;
      }

      const isCurrentlyWatched = watchedEntryIds.has(entry.id);
      const newWatched = !isCurrentlyWatched;

      try {
        await toggleFranchiseEntryWatched(user.id, entry.id, franchiseId, newWatched);

        // Optimistic update for franchise progress
        setProgress((prev) => {
          if (newWatched) {
            return [...prev, { entryId: entry.id, watchedAt: new Date().toISOString() }];
          }
          return prev.filter((p) => p.entryId !== entry.id);
        });

        // Sync with global watch history so profile page + detail screens reflect the state
        if (entry.tmdbId) {
          const now = Date.now();
          try {
            if (newWatched) {
              if (entry.mediaType === "tv") {
                const details = await getSeriesDetails(String(entry.tmdbId));
                await saveSeriesToWatchHistory(details, now);
              } else {
                const details = await getMovieDetails(String(entry.tmdbId));
                await saveMovieToWatchHistory(details, now);
              }
            } else {
              const mediaType = entry.mediaType === "tv" ? "tv" as const : "movie" as const;
              await removeFromWatchHistory(entry.tmdbId, mediaType);
            }
          } catch {
            // Franchise progress was saved; watch history sync is best-effort
          }
        }

        showToast(
          newWatched
            ? `Marked "${entry.title}" as watched`
            : `Unmarked "${entry.title}"`
        );
      } catch (error) {
        showToast("Failed to update progress");
      }
    },
    [user, watchedEntryIds, franchiseId, showToast, saveMovieToWatchHistory, saveSeriesToWatchHistory, removeFromWatchHistory]
  );

  // ── Scroll handler for lazy loading + SVG viewport culling ──────────
  const handleScroll = useCallback(
    (event: any) => {
      const nativeEvent = event?.nativeEvent;
      if (!nativeEvent) return;

      const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
      if (!layoutMeasurement || !contentOffset || !contentSize) return;

      // Track scroll position for SVG culling
      setScrollY(contentOffset.y);

      const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 600;

      if (isNearBottom && visibleCount < entries.length) {
        setVisibleCount((prev) => Math.min(prev + 10, entries.length));
      }
    },
    [visibleCount, entries.length]
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height);
  }, []);

  // ── Layout Calculations ────────────────────────────────────────────
  const nodePositions = useMemo(() => {
    const positions: Array<{ top: number; left: number; index: number }> = [];
    let currentY = 20;

    visibleEntries.forEach((_entry, index) => {
      positions.push({
        top: currentY,
        left: NODE_LEFT_MARGIN,
        index,
      });

      currentY += NODE_SPACING;
    });

    return positions;
  }, [visibleEntries]);

  const totalHeight = nodePositions.length > 0
    ? nodePositions[nodePositions.length - 1].top + NODE_SPACING + 40
    : 400;

  // Compute node bounding rectangles for the SVG curved path
  // The path connects through poster centers, which alternate sides within each full-width node
  const nodeRects = useMemo((): NodeRect[] => {
    return nodePositions.map((pos, index) => {
      const isLeft = index % 2 === 0;
      // Poster sits at the left or right edge of the full node
      const posterLeft = isLeft
        ? pos.left
        : pos.left + NODE_FULL_WIDTH - POSTER_WIDTH;
      return {
        left: posterLeft,
        top: pos.top,
        width: POSTER_WIDTH,
        height: POSTER_HEIGHT,
        isLeft,
      };
    });
  }, [nodePositions]);

  // ── Render ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeContainer>
        <LoadingWrap>
          <MovieLoader label="Loading timeline" />
        </LoadingWrap>
      </SafeContainer>
    );
  }

  if (entries.length === 0) {
    return (
      <SafeContainer>
        <Root>
          <Header>
            <BackButton onPress={() => navigation.goBack()}>
              <Feather name="arrow-left" size={18} color="#FFFFFF" />
            </BackButton>
            <HeaderTextWrap>
              <HeaderTitle>{franchiseTitle}</HeaderTitle>
            </HeaderTextWrap>
          </Header>
          <EmptyWrap>
            <Feather name="film" size={36} color="rgba(255,255,255,0.2)" />
            <EmptyText>No entries found for this franchise.</EmptyText>
          </EmptyWrap>
        </Root>
      </SafeContainer>
    );
  }

  return (
    <SafeContainer>
      <Root>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </BackButton>
          <HeaderTextWrap>
            <HeaderTitle numberOfLines={1}>{franchiseTitle}</HeaderTitle>
            <HeaderSubtitle>
              {entries.length} titles in the journey
            </HeaderSubtitle>
          </HeaderTextWrap>
        </Header>

        {/* Progress Banner */}
        <ProgressBanner>
          <ProgressRing
            progress={progressFraction}
            size={64}
            strokeWidth={4}
            accentColor={accent}
            variant="sm"
          />
          <ProgressInfo>
            <ProgressTitle>
              {watchedCount} of {entries.length} completed
            </ProgressTitle>
            <ProgressSubtitle>
              {watchedCount === entries.length
                ? "You have completed this entire franchise"
                : "Long press any title to mark as watched"}
            </ProgressSubtitle>
            {nextEntry ? (
              <NextUpRow>
                Next up: <NextUpTitle $color={accent}>{nextEntry.title}</NextUpTitle>
              </NextUpRow>
            ) : null}
          </ProgressInfo>
        </ProgressBanner>

        <TimelineScroll onScroll={handleScroll} scrollEventThrottle={16} onLayout={handleLayout}>
          <TimelineContainer style={{ height: totalHeight }}>
            {/* SVG curved path between nodes */}
            <TimelinePath
              nodeRects={nodeRects}
              width={SCREEN_WIDTH}
              height={totalHeight}
              accentColor={accent}
              watchedSet={watchedIndices}
              scrollY={scrollY}
              viewportHeight={viewportHeight}
            />

            {/* Timeline nodes */}
            {visibleEntries.map((entry, index) => {
              const pos = nodePositions[index];
              if (!pos) return null;
              const isLeft = index % 2 === 0;
              const isWatched = watchedEntryIds.has(entry.id);

              return (
                <NodePositioner key={entry.id} $top={pos.top} $left={pos.left}>
                  <TimelineNode
                    entry={entry}
                    isLeft={isLeft}
                    isWatched={isWatched}
                    onPress={handlePressEntry}
                    onLongPress={handleLongPressEntry}
                  />
                </NodePositioner>
              );
            })}
          </TimelineContainer>

          {/* End of timeline */}
          {visibleCount >= entries.length && (
            <EndOfTimelineWrap>
              <EndDivider $color={accent} />
              <EndDot $color={accent} />
              <EndTitle $color={accent}>
                {watchedCount === entries.length ? "Journey Complete" : "End of Timeline"}
              </EndTitle>
              <EndSubtitle>
                {watchedCount === entries.length
                  ? `You've experienced all ${entries.length} titles in this saga. What a ride.`
                  : `${entries.length} titles. One epic journey. How far will you go?`}
              </EndSubtitle>
            </EndOfTimelineWrap>
          )}
        </TimelineScroll>

        {/* Toast notification */}
        {toastMessage && (
          <ToastWrap style={{ opacity: toastOpacity, transform: [{ translateY: toastOpacity.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <Feather name="check-circle" size={16} color={accent} />
            <ToastText>{toastMessage}</ToastText>
          </ToastWrap>
        )}
      </Root>
    </SafeContainer>
  );
}
