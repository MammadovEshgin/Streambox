import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import { DataLabel, DataRow, EmptyText, RankPill, RankText, StatsSection } from "./StatsSection";

const Rows = styled.View`
  gap: 0;
`;

const RowWrap = styled.View``;

const RowDivider = styled.View`
  height: 1px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  margin-vertical: 10px;
`;

const BarTrack = styled.View`
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  margin-left: 12px;
  overflow: hidden;
`;

const BarFill = styled(Animated.View)<{ $isTop?: boolean }>`
  height: 8px;
  border-radius: 4px;
  background-color: ${({ theme, $isTop }) => $isTop ? theme.colors.primary : withAlpha(theme.colors.primary, 0.45)};
`;

const MetaWrap = styled.View`
  min-width: 50px;
  align-items: flex-end;
  margin-left: 12px;
`;

const CountInline = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 5px;
`;

type Props = {
  history: WatchHistoryEntry[];
  itemLabelPlural: string;
  onGenrePress?: (genre: string) => void;
};

function AnimatedBar({ ratio, delay, isTop }: { ratio: number; delay: number; isTop?: boolean }) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withDelay(delay, withTiming(ratio * 100, { duration: 540 }));
  }, [width, ratio, delay]);

  const style = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }));

  return <BarFill style={style} $isTop={isTop} />;
}

export function GenreBreakdown({ history, itemLabelPlural, onGenrePress }: Props) {
  const theme = useTheme();
  const genreCounts: Record<string, number> = {};
  for (const entry of history) {
    for (const genre of entry.genres) {
      genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const maxCount = sorted[0]?.[1] ?? 1;
  const isMovieMode = itemLabelPlural === "movies";

  return (
    <StatsSection title="Genre Breakdown" subtitle="Your most watched genres ranked by count." accentGlow>
      {sorted.length > 0 ? (
        <Rows>
          {sorted.map(([genre, count], index) => {
            const isTop = index === 0;
            return (
              <RowWrap key={genre}>
                <Pressable onPress={() => onGenrePress?.(genre)}>
                  <DataRow>
                    <RankPill>
                      <RankText style={{ opacity: isTop ? 1 : 0.5 }}>{index + 1}</RankText>
                    </RankPill>
                    <DataLabel style={{ minWidth: 72, fontWeight: isTop ? "700" : "600", opacity: isTop ? 1 : 0.7 }}>{genre}</DataLabel>
                    <BarTrack>
                      <AnimatedBar ratio={count / maxCount} delay={index * 55} isTop={isTop} />
                    </BarTrack>
                    <MetaWrap>
                      <CountInline>
                        <DataLabel style={{ opacity: isTop ? 1 : 0.6 }}>{count}</DataLabel>
                        {isMovieMode ? (
                          <MaterialCommunityIcons name="movie-open" size={12} color={withAlpha(theme.colors.textSecondary, 0.6)} />
                        ) : (
                          <Feather name="tv" size={11} color={withAlpha(theme.colors.textSecondary, 0.6)} />
                        )}
                      </CountInline>
                    </MetaWrap>
                  </DataRow>
                </Pressable>
                {index < sorted.length - 1 ? <RowDivider /> : null}
              </RowWrap>
            );
          })}
        </Rows>
      ) : (
        <EmptyText>No genre patterns yet.</EmptyText>
      )}
    </StatsSection>
  );
}
