import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import { DataLabel, DataRow, EmptyText, StatsSection } from "./StatsSection";

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
  background-color: ${({ theme, $isTop }) => $isTop ? theme.colors.primary : withAlpha(theme.colors.primary, 0.5)};
`;

const CountWrap = styled.View`
  min-width: 50px;
  align-items: flex-end;
  margin-left: 12px;
`;

const CountInline = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 5px;
`;

const DecadeLabel = styled.Text<{ $isTop?: boolean }>`
  font-size: 13px;
  font-weight: ${({ $isTop }) => ($isTop ? "700" : "600")};
  min-width: 54px;
  color: ${({ theme, $isTop }) => $isTop ? theme.colors.textPrimary : withAlpha(theme.colors.textPrimary, 0.7)};
`;

type Props = {
  history: WatchHistoryEntry[];
  isMovieMode: boolean;
  onDecadePress?: (min: number, max: number, label: string) => void;
};

const DECADES = [
  { label: "2020s", min: 2020, max: 2029 },
  { label: "2010s", min: 2010, max: 2019 },
  { label: "2000s", min: 2000, max: 2009 },
  { label: "90s", min: 1990, max: 1999 },
  { label: "80s", min: 1980, max: 1989 },
  { label: "Older", min: 0, max: 1979 },
];

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

export function DecadeBreakdown({ history, isMovieMode, onDecadePress }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const decadeCounts = DECADES.map((decade) => {
    const count = history.filter((entry) => {
      const year = Number.parseInt(entry.year, 10);
      return !Number.isNaN(year) && year >= decade.min && year <= decade.max;
    }).length;
    return { ...decade, count };
  });

  const maxCount = Math.max(...decadeCounts.map((decade) => decade.count), 1);
  const hasData = decadeCounts.some((decade) => decade.count > 0);
  return (
    <StatsSection title={t("stats.decadeSpreadTitle")} subtitle={t("stats.decadeSpreadSubtitle")}>
      {hasData ? (
        <Rows>
          {decadeCounts.map((decade, index) => {
            const isTop = decade.count === maxCount && decade.count > 0;
            return (
              <RowWrap key={decade.label}>
                <Pressable onPress={() => onDecadePress?.(decade.min, decade.max, decade.label)}>
                  <DataRow>
                    <DecadeLabel $isTop={isTop}>{decade.label}</DecadeLabel>
                    <BarTrack>
                      <AnimatedBar ratio={decade.count / maxCount} delay={index * 55} isTop={isTop} />
                    </BarTrack>
                    <CountWrap>
                      <CountInline>
                        <DataLabel style={{ opacity: isTop ? 1 : 0.6 }}>{decade.count}</DataLabel>
                        {isMovieMode ? (
                          <MaterialCommunityIcons name="movie-open" size={12} color={withAlpha(theme.colors.textSecondary, 0.6)} />
                        ) : (
                          <Feather name="tv" size={11} color={withAlpha(theme.colors.textSecondary, 0.6)} />
                        )}
                      </CountInline>
                    </CountWrap>
                  </DataRow>
                </Pressable>
                {index < decadeCounts.length - 1 ? <RowDivider /> : null}
              </RowWrap>
            );
          })}
        </Rows>
      ) : (
        <EmptyText>{t("stats.noDecadeDistribution")}</EmptyText>
      )}
    </StatsSection>
  );
}
