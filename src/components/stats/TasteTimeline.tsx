import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { formatLocalizedDate } from "../../localization/format";
import { withAlpha } from "../../theme/Theme";
import { DataLabel, EmptyText, StatsSection } from "./StatsSection";

const MonthCard = styled(Pressable)<{ $isCurrent?: boolean }>`
  width: 120px;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.28)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme, $isCurrent }) =>
    $isCurrent ? withAlpha(theme.colors.primary, 0.2) : withAlpha(theme.colors.textPrimary, 0.04)};
  padding: 14px 10px;
  margin-right: 10px;
  align-items: center;
`;

const MonthLabel = styled.Text<{ $isCurrent?: boolean }>`
  font-size: 11px;
  font-weight: ${({ $isCurrent }) => ($isCurrent ? "700" : "500")};
  color: ${({ theme, $isCurrent }) =>
    $isCurrent ? withAlpha(theme.colors.textPrimary, 0.8) : withAlpha(theme.colors.textPrimary, 0.44)};
  text-align: center;
`;

const GenreChip = styled.View`
  align-self: center;
  background-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.1)};
  border-radius: 3px;
  padding: 5px 8px;
  margin-top: 10px;
  margin-bottom: 8px;
`;

const GenreText = styled.Text`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: ${({ theme }) => withAlpha(theme.colors.primary, 0.8)};
`;

type Props = {
  history: WatchHistoryEntry[];
  isMovieMode: boolean;
  onMonthPress?: (monthTimestamp: number, label: string) => void;
};

type MonthData = {
  month: string;
  year: number;
  topGenre: string;
  count: number;
  timestamp: number;
  label: string;
  isCurrent: boolean;
};

function getMonthlyData(history: WatchHistoryEntry[]): MonthData[] {
  const now = new Date();
  const results: MonthData[] = [];

  for (let index = 0; index < 6; index++) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const monthStart = date.getTime();
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();

    const monthEntries = history.filter((entry) => entry.watchedAt >= monthStart && entry.watchedAt < nextMonth);

    const genreCounts: Record<string, number> = {};
    for (const entry of monthEntries) {
      for (const genre of entry.genres) {
        genreCounts[genre] = (genreCounts[genre] ?? 0) + 1;
      }
    }

    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    const monthName = formatLocalizedDate(date, { month: "long" });
    const yearNum = date.getFullYear();
    const yearSuffix = yearNum !== now.getFullYear() ? ` '${String(yearNum).slice(2)}` : "";

    results.push({
      month: monthName,
      year: yearNum,
      topGenre: topGenre?.[0] ?? "-",
      count: monthEntries.length,
      timestamp: monthStart,
      label: `${monthName}${yearSuffix} ${yearNum}`,
      isCurrent: index === 0,
    });
  }

  return results;
}

export function TasteTimeline({ history, isMovieMode, onMonthPress }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const months = getMonthlyData(history);

  return (
    <StatsSection title={t("stats.tasteEvolutionTitle")} subtitle={t("stats.tasteEvolutionSubtitle")}>
      {history.length === 0 ? (
        <EmptyText>{t("stats.noMonthlyTasteData")}</EmptyText>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 4 }}>
          {months.map((month) => (
            <MonthCard key={month.timestamp} $isCurrent={month.isCurrent} onPress={() => onMonthPress?.(month.timestamp, month.label)}>
              <MonthLabel $isCurrent={month.isCurrent}>
                {month.month.slice(0, 3)}
                {month.year !== new Date().getFullYear() ? ` '${String(month.year).slice(2)}` : ""}
              </MonthLabel>
              <GenreChip>
                <GenreText numberOfLines={1}>{month.topGenre}</GenreText>
              </GenreChip>
              <DataLabel style={{ textAlign: "center", alignSelf: "center", fontSize: 18, fontWeight: "700" }}>{month.count}</DataLabel>
              {isMovieMode ? (
                <MaterialCommunityIcons name="movie-open" size={13} color={withAlpha(theme.colors.textSecondary, 0.5)} style={{ alignSelf: "center", marginTop: 3 }} />
              ) : (
                <Feather name="tv" size={12} color={withAlpha(theme.colors.textSecondary, 0.5)} style={{ alignSelf: "center", marginTop: 3 }} />
              )}
            </MonthCard>
          ))}
        </ScrollView>
      )}
    </StatsSection>
  );
}
