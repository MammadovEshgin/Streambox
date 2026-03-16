import { Feather } from "@expo/vector-icons";
import { View } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { withAlpha } from "../../theme/Theme";
import { FilterChip, FilterLabel, PillRow } from "./StatsSection";

/* ── Outer wrapper — full-bleed, no card ── */
const Wrap = styled.View`
  padding: 20px 16px 4px;
`;

/* ── Title row with integrated toggle ── */
const TopRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
`;

const Title = styled.Text`
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.6px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* ── Three metric pillars in one row ── */
const PillarsRow = styled.View`
  flex-direction: row;
  gap: 10px;
`;

const Pillar = styled.View`
  flex: 1;
  background-color: ${({ theme }) => withAlpha(theme.colors.surfaceRaised, 0.92)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  padding: 20px 12px;
  align-items: center;
  justify-content: center;
`;

const PillarIcon = styled.View`
  margin-bottom: 10px;
`;

const PillarValue = styled.Text`
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -1.2px;
  color: ${({ theme }) => theme.colors.textPrimary};
  include-font-padding: false;
`;

const PillarLabel = styled.Text`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.32)};
  margin-top: 6px;
`;

/* ── Rating strip below the pillars ── */
const RatingStrip = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 10px;
  background-color: ${({ theme }) => withAlpha(theme.colors.surfaceRaised, 0.92)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  padding: 14px 16px;
  gap: 14px;
`;

const RatingLeft = styled.View`
  flex-direction: row;
  align-items: flex-end;
`;

const RatingBig = styled.Text`
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.6px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const RatingUnit = styled.Text`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.3)};
  margin-bottom: 3px;
  margin-left: 2px;
`;

const RatingTrack = styled.View`
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  overflow: hidden;
`;

const RatingFill = styled.View<{ $pct: number }>`
  height: 5px;
  width: ${({ $pct }) => $pct}%;
  border-radius: 3px;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const RatingTag = styled.Text`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.3)};
`;

type MediaFilter = "movie" | "tv";

type Props = {
  filter: MediaFilter;
  totalWatched: number;
  totalHours: number;
  totalEpisodes: number;
  avgRating: number;
  onFilterChange: (filter: MediaFilter) => void;
};

export function StatsOverviewHero({ filter, totalWatched, totalHours, totalEpisodes, avgRating, onFilterChange }: Props) {
  const theme = useTheme();
  const ratingPct = Math.max(0, Math.min(100, avgRating * 10));

  return (
    <Wrap>
      <TopRow>
        <Title>Recap</Title>
        <PillRow>
          <FilterChip $active={filter === "movie"} onPress={() => onFilterChange("movie")}>
            <FilterLabel $active={filter === "movie"}>Movies</FilterLabel>
          </FilterChip>
          <FilterChip $active={filter === "tv"} onPress={() => onFilterChange("tv")}>
            <FilterLabel $active={filter === "tv"}>Series</FilterLabel>
          </FilterChip>
        </PillRow>
      </TopRow>

      <PillarsRow>
        {/* Primary pillar — the hero number — gets accent tint */}
        <Pillar>
          <PillarIcon>
            <Feather name="film" size={16} color={withAlpha(theme.colors.primary, 0.55)} />
          </PillarIcon>
          <PillarValue>{totalWatched}</PillarValue>
          <PillarLabel>{filter === "movie" ? "watched" : "watched"}</PillarLabel>
        </Pillar>

        <Pillar>
          <PillarIcon>
            <Feather name={filter === "movie" ? "clock" : "tv"} size={16} color={withAlpha(theme.colors.primary, 0.55)} />
          </PillarIcon>
          <PillarValue>{filter === "movie" ? totalHours : totalEpisodes}</PillarValue>
          <PillarLabel>{filter === "movie" ? "hours" : "episodes"}</PillarLabel>
        </Pillar>

        <Pillar>
          <PillarIcon>
            <Feather name="star" size={16} color={withAlpha(theme.colors.primary, 0.55)} />
          </PillarIcon>
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <PillarValue>{avgRating || 0}</PillarValue>
            <RatingUnit style={{ marginBottom: 6 }}>/10</RatingUnit>
          </View>
          <PillarLabel>avg score</PillarLabel>
        </Pillar>
      </PillarsRow>

    </Wrap>
  );
}
