import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import {
  FilterChip,
  FilterLabel,
  PillRow,
  StatsSection,
} from "./StatsSection";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const ChartFrame = styled.View`
  border-radius: 5px;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.28)};
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.04)};
  padding: 14px 12px 10px;
`;

const SummaryWrap = styled.View`
  margin-top: 14px;
  flex-direction: row;
  gap: 10px;
`;

const SummaryTile = styled.View`
  flex: 1;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.32)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.04)};
  align-items: center;
  justify-content: center;
  padding: 14px 8px;
`;

const SummaryValue = styled.Text`
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SummaryLabel = styled.Text`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.36)};
  margin-top: 4px;
`;

type Props = {
  history: WatchHistoryEntry[];
};

type Period = "4w" | "3m" | "6m" | "1y";

const PERIOD_CONFIG: Record<Period, { label: string; weeks: number }> = {
  "4w": { label: "4W", weeks: 4 },
  "3m": { label: "3M", weeks: 12 },
  "6m": { label: "6M", weeks: 26 },
  "1y": { label: "1Y", weeks: 52 },
};

function getWeeklyData(history: WatchHistoryEntry[], numWeeks: number): number[] {
  const now = Date.now();
  const weeks: number[] = new Array(numWeeks).fill(0);

  for (const entry of history) {
    const weeksAgo = Math.floor((now - entry.watchedAt) / (7 * 24 * 60 * 60 * 1000));
    if (weeksAgo >= 0 && weeksAgo < numWeeks) {
      weeks[numWeeks - 1 - weeksAgo]++;
    }
  }

  return weeks;
}

function AnimatedBar({
  x,
  width,
  maxHeight,
  value,
  maxValue,
  index,
  fill,
  emptyFill,
}: {
  x: number;
  width: number;
  maxHeight: number;
  value: number;
  maxValue: number;
  index: number;
  fill: string;
  emptyFill: string;
}) {
  const height = useSharedValue(0);
  const targetHeight = maxValue > 0 ? Math.max(3, (value / maxValue) * maxHeight) : 3;

  useEffect(() => {
    height.value = withDelay(index * 24, withTiming(targetHeight, { duration: 460 }));
  }, [height, targetHeight, index]);

  const animatedProps = useAnimatedProps(() => ({
    height: height.value,
    y: maxHeight - height.value,
  }));

  return (
    <AnimatedRect
      x={x}
      rx={3}
      width={width}
      fill={value > 0 ? fill : emptyFill}
      animatedProps={animatedProps}
    />
  );
}

export function ActivityChart({ history }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>("3m");
  const config = PERIOD_CONFIG[period];
  const weeks = getWeeklyData(history, config.weeks);
  const maxVal = Math.max(...weeks, 1);
  const totalInPeriod = weeks.reduce((a, b) => a + b, 0);
  const peakWeek = Math.max(...weeks);
  const activeWeeks = weeks.filter((week) => week > 0).length;

  const chartWidth = 300;
  const chartHeight = 120;
  const barGap = config.weeks > 26 ? 2 : config.weeks > 12 ? 3 : 5;
  const barWidth = (chartWidth - barGap * (config.weeks - 1)) / config.weeks;
  const inactiveBarFill = withAlpha(theme.colors.textPrimary, 0.04);

  const labelCount = Math.min(config.weeks, 5);
  const labelStep = Math.max(1, Math.floor(config.weeks / Math.max(1, labelCount - 1)));
  const labelIndices: number[] = [];
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.min(i * labelStep, config.weeks - 1);
    if (!labelIndices.includes(idx)) labelIndices.push(idx);
  }

  return (
    <StatsSection
      title={t("stats.watchActivityTitle")}
      subtitle={t("stats.watchActivitySubtitle")}
      accentGlow
      action={
        <PillRow>
          {(Object.keys(PERIOD_CONFIG) as Period[]).map((value) => (
            <FilterChip key={value} $active={period === value} onPress={() => setPeriod(value)}>
              <FilterLabel $active={period === value}>{PERIOD_CONFIG[value].label}</FilterLabel>
            </FilterChip>
          ))}
        </PillRow>
      }
    >
      <ChartFrame>
        <Svg width="100%" height={chartHeight + 26} viewBox={`0 0 ${chartWidth} ${chartHeight + 26}`}>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <Line
              key={ratio}
              x1="0"
              y1={chartHeight - chartHeight * ratio}
              x2={chartWidth}
              y2={chartHeight - chartHeight * ratio}
              stroke={withAlpha(theme.colors.textPrimary, 0.04)}
            />
          ))}
          {weeks.map((value, index) => (
            <AnimatedBar
              key={`${period}-${index}`}
              x={index * (barWidth + barGap)}
              width={barWidth}
              maxHeight={chartHeight}
              value={value}
              maxValue={maxVal}
              index={index}
              fill={theme.colors.primary}
              emptyFill={inactiveBarFill}
            />
          ))}
          {labelIndices.map((index) => {
            const weeksAgo = config.weeks - 1 - index;
            const label = weeksAgo === 0 ? t("stats.now") : `${weeksAgo}${t("stats.weekShort")}`;
            return (
              <SvgText
                key={index}
                x={index * (barWidth + barGap) + barWidth / 2}
                y={chartHeight + 18}
                fontSize={9}
                fill={withAlpha(theme.colors.textPrimary, 0.36)}
                textAnchor="middle"
              >
                {label}
              </SvgText>
            );
          })}
        </Svg>
      </ChartFrame>

      <SummaryWrap>
        <SummaryTile>
          <SummaryValue>{totalInPeriod}</SummaryValue>
          <SummaryLabel>{t("stats.chartTotal")}</SummaryLabel>
        </SummaryTile>
        <SummaryTile>
          <SummaryValue>{peakWeek}</SummaryValue>
          <SummaryLabel>{t("stats.chartPeakWeek")}</SummaryLabel>
        </SummaryTile>
        <SummaryTile>
          <SummaryValue>{activeWeeks}</SummaryValue>
          <SummaryLabel>{t("stats.chartActive")}</SummaryLabel>
        </SummaryTile>
      </SummaryWrap>
    </StatsSection>
  );
}
