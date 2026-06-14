import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Svg, { Circle, Line, Polygon, Text as SvgText, TSpan } from "react-native-svg";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import { DataLabel, DataMeta, MiniPanel, SectionGrid, StatsSection } from "./StatsSection";

const RadarWrap = styled.View`
  align-items: center;
  padding-vertical: 6px;
`;

type Props = {
  history: WatchHistoryEntry[];
};

const SIZE = 296;
const CENTER = SIZE / 2;
const MAX_R = 82;
const LABEL_RADIUS = MAX_R + 18;
const LABEL_FONT_SIZE = 11;

function polarToXY(angle: number, radius: number): { x: number; y: number } {
  const radians = (angle - 90) * (Math.PI / 180);
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

function getGenreLabelLines(genre: string): string[] {
  if (genre.length <= 12) {
    return [genre];
  }

  if (genre.includes(" & ")) {
    const [left, right] = genre.split(" & ", 2);
    return [`${left} &`, right];
  }

  const words = genre.split(" ");
  if (words.length > 1) {
    const midpoint = Math.ceil(words.length / 2);
    return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
  }

  return [genre];
}

function getLabelAnchor(x: number): "start" | "middle" | "end" {
  if (x < CENTER - 18) return "end";
  if (x > CENTER + 18) return "start";
  return "middle";
}

export function GenreRadar({ history }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { genres, values, dominantGenre, dominantShare } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of history) {
      for (const genre of entry.genres) {
        counts[genre] = (counts[genre] ?? 0) + 1;
      }
    }

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const max = sorted[0]?.[1] ?? 1;
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);

    return {
      genres: sorted.map(([genre]) => genre),
      values: sorted.map(([, count]) => count / max),
      dominantGenre: sorted[0]?.[0] ?? null,
      dominantShare: total > 0 && sorted[0] ? Math.round((sorted[0][1] / total) * 100) : 0,
    };
  }, [history]);

  if (genres.length < 3) {
    return null;
  }

  const angleStep = 360 / genres.length;
  const ringStroke = withAlpha(theme.colors.textPrimary, 0.05);
  const axisStroke = withAlpha(theme.colors.textPrimary, 0.04);

  const ringPoints = (pct: number) =>
    Array.from({ length: genres.length }, (_, index) => {
      const { x, y } = polarToXY(index * angleStep, MAX_R * pct);
      return `${x},${y}`;
    }).join(" ");

  const dataPoints = values
    .map((value, index) => {
      const { x, y } = polarToXY(index * angleStep, MAX_R * Math.max(value, 0.08));
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <StatsSection title={t("stats.genreRadarTitle")} subtitle={t("stats.genreRadarSubtitle")}>
      <RadarWrap>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {[0.33, 0.66, 1].map((pct) => (
            <Polygon key={pct} points={ringPoints(pct)} fill="none" stroke={ringStroke} strokeWidth={1} />
          ))}
          {genres.map((_, index) => {
            const { x, y } = polarToXY(index * angleStep, MAX_R);
            return <Line key={index} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke={axisStroke} strokeWidth={1} />;
          })}
          <Polygon points={dataPoints} fill={withAlpha(theme.colors.primary, 0.12)} stroke={theme.colors.primary} strokeWidth={2} />
          {values.map((value, index) => {
            const { x, y } = polarToXY(index * angleStep, MAX_R * Math.max(value, 0.08));
            return <Circle key={index} cx={x} cy={y} r={3.5} fill={theme.colors.primary} />;
          })}
          {genres.map((genre, index) => {
            const { x, y } = polarToXY(index * angleStep, LABEL_RADIUS);
            const labelLines = getGenreLabelLines(genre);
            const labelStartY = y - ((labelLines.length - 1) * LABEL_FONT_SIZE) / 2;
            return (
              <SvgText
                key={genre}
                x={x}
                y={labelStartY}
                fill={withAlpha(theme.colors.textPrimary, 0.55)}
                fontSize={LABEL_FONT_SIZE}
                fontWeight="600"
                textAnchor={getLabelAnchor(x)}
              >
                {labelLines.map((line, lineIndex) => (
                  <TSpan key={`${genre}-${lineIndex}`} x={x} dy={lineIndex === 0 ? 0 : LABEL_FONT_SIZE + 2}>
                    {line}
                  </TSpan>
                ))}
              </SvgText>
            );
          })}
        </Svg>
      </RadarWrap>

      <SectionGrid>
        <MiniPanel>
          <DataMeta style={{ textAlign: "center" }}>{t("stats.dominant")}</DataMeta>
          <DataLabel style={{ marginTop: 6, textAlign: "center" }}>{dominantGenre ?? "-"}</DataLabel>
        </MiniPanel>
        <MiniPanel>
          <DataMeta style={{ textAlign: "center" }}>{t("stats.share")}</DataMeta>
          <DataLabel style={{ marginTop: 6, textAlign: "center" }}>{dominantShare}%</DataLabel>
        </MiniPanel>
      </SectionGrid>
    </StatsSection>
  );
}
