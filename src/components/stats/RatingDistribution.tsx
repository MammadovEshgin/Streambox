import { Fragment, useEffect } from "react";
import { Pressable, View } from "react-native";
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
import { StatsSection } from "./StatsSection";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const ChartFrame = styled.View`
  border-radius: 5px;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.28)};
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.04)};
  padding: 14px 12px 8px;
`;

type Props = {
  history: WatchHistoryEntry[];
  onBucketPress?: (min: number, max: number) => void;
};

const BUCKETS = ["0-2", "2-4", "4-6", "6-8", "8-10"] as const;
const BUCKET_RANGES: [number, number][] = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]];

function getBucketIndex(rating: number): number {
  if (rating < 2) return 0;
  if (rating < 4) return 1;
  if (rating < 6) return 2;
  if (rating < 8) return 3;
  return 4;
}

function AnimatedBar({
  x,
  width,
  baselineY,
  targetHeight,
  index,
  fill,
}: {
  x: number;
  width: number;
  baselineY: number;
  targetHeight: number;
  index: number;
  fill: string;
}) {
  const height = useSharedValue(0);

  useEffect(() => {
    height.value = withDelay(index * 80, withTiming(targetHeight, { duration: 520 }));
  }, [height, targetHeight, index]);

  const animatedProps = useAnimatedProps(() => ({
    height: height.value,
    y: baselineY - height.value,
  }));

  return <AnimatedRect x={x} rx={4} width={width} fill={fill} animatedProps={animatedProps} />;
}

export function RatingDistribution({ history, onBucketPress }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const counts = [0, 0, 0, 0, 0];
  for (const entry of history) {
    counts[getBucketIndex(entry.voteAverage)]++;
  }
  const maxCount = Math.max(...counts, 1);
  const peakIndex = counts.indexOf(maxCount);

  const chartWidth = 260;
  const chartHeight = 110;
  const barGap = 14;
  const barWidth = (chartWidth - barGap * 4) / 5;
  const maxBarHeight = chartHeight - 22;

  return (
    <StatsSection title={t("stats.ratingDistributionTitle")} subtitle={t("stats.ratingDistributionSubtitle")}>
      <ChartFrame>
        <View style={{ width: "100%", position: "relative" }}>
          <Svg width="100%" height={chartHeight + 26} viewBox={`0 0 ${chartWidth} ${chartHeight + 26}`}>
            <Line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke={withAlpha(theme.colors.textPrimary, 0.05)} />
            {counts.map((count, index) => {
              const x = index * (barWidth + barGap);
              const height = count > 0 ? Math.max(5, (count / maxCount) * maxBarHeight) : 3;
              const isPeak = index === peakIndex && count > 0;
              return (
                <Fragment key={index}>
                  <SvgText
                    x={x + barWidth / 2}
                    y={12}
                    fontSize={11}
                    fontWeight="700"
                    fill={withAlpha(theme.colors.textPrimary, isPeak ? 0.8 : 0.36)}
                    textAnchor="middle"
                  >
                    {count}
                  </SvgText>
                  <AnimatedBar
                    x={x}
                    width={barWidth}
                    baselineY={chartHeight}
                    targetHeight={height}
                    index={index}
                    fill={isPeak ? theme.colors.primary : withAlpha(theme.colors.primary, 0.4)}
                  />
                </Fragment>
              );
            })}
            {BUCKETS.map((label, index) => (
              <SvgText
                key={label}
                x={index * (barWidth + barGap) + barWidth / 2}
                y={chartHeight + 18}
                fontSize={10}
                fill={withAlpha(theme.colors.textPrimary, 0.36)}
                textAnchor="middle"
              >
                {label}
              </SvgText>
            ))}
          </Svg>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
            {BUCKET_RANGES.map(([min, max], index) => (
              <Pressable key={index} style={{ flex: 1 }} onPress={() => onBucketPress?.(min, max)} />
            ))}
          </View>
        </View>
      </ChartFrame>
    </StatsSection>
  );
}
