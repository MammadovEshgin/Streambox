import { Feather } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components/native";

import { withAlpha } from "../../theme/Theme";
import { FilterChip, FilterLabel, PillRow } from "./StatsSection";

const Wrap = styled.View`
  padding: 20px 16px 4px;
`;

const TopRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 26px;
  letter-spacing: -0.6px;
`;

const PillarsRow = styled.View`
  flex-direction: row;
  gap: 10px;
  align-items: stretch;
`;

const Pillar = styled.View`
  background-color: ${({ theme }) => withAlpha(theme.colors.surfaceRaised, 0.92)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  align-items: center;
  justify-content: center;
`;

const LeadPillar = styled(Pillar)`
  flex: 1.2;
  min-height: 180px;
  padding: 24px 12px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.16)};
`;

const SupportStack = styled.View`
  flex: 0.95;
  gap: 10px;
`;

const SupportPillar = styled(Pillar)`
  min-height: 85px;
  padding: 12px 10px;
`;

const PillarIcon = styled.View`
  margin-bottom: 10px;
`;

const LeadValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 44px;
  letter-spacing: -1.8px;
  include-font-padding: false;
`;

const SupportValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 32px;
  letter-spacing: -1.2px;
  include-font-padding: false;
`;

const PillarValue = SupportValue;

const PillarLabel = styled.Text`
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.32)};
  font-family: Outfit_700Bold;
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-top: 6px;
`;

const RatingUnit = styled.Text`
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.3)};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  margin-bottom: 3px;
  margin-left: 2px;
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

export function StatsOverviewHero({
  filter,
  totalWatched,
  totalHours,
  totalEpisodes,
  avgRating,
  onFilterChange,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Wrap>
      <TopRow>
        <Title>{t("stats.recap")}</Title>
        <PillRow>
          <FilterChip $active={filter === "movie"} onPress={() => onFilterChange("movie")}>
            <FilterLabel $active={filter === "movie"}>{t("common.movies")}</FilterLabel>
          </FilterChip>
          <FilterChip $active={filter === "tv"} onPress={() => onFilterChange("tv")}>
            <FilterLabel $active={filter === "tv"}>{t("common.series")}</FilterLabel>
          </FilterChip>
        </PillRow>
      </TopRow>

      <PillarsRow>
        <LeadPillar>
          <PillarIcon>
            <Feather name="film" size={18} color={withAlpha(theme.colors.primary, 0.7)} />
          </PillarIcon>
          <LeadValue>{totalWatched}</LeadValue>
          <PillarLabel>{t("stats.watched")}</PillarLabel>
        </LeadPillar>

        <SupportStack>
          <SupportPillar>
            <PillarIcon>
              <Feather
                name={filter === "movie" ? "clock" : "tv"}
                size={15}
                color={withAlpha(theme.colors.primary, 0.55)}
              />
            </PillarIcon>
            <SupportValue>{filter === "movie" ? totalHours : totalEpisodes}</SupportValue>
            <PillarLabel>{filter === "movie" ? t("stats.hours") : t("stats.episodes")}</PillarLabel>
          </SupportPillar>

          <SupportPillar>
            <PillarIcon>
              <Feather name="star" size={15} color={withAlpha(theme.colors.primary, 0.55)} />
            </PillarIcon>
            <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
              <SupportValue>{avgRating || 0}</SupportValue>
              <RatingUnit style={{ marginBottom: 6 }}>/10</RatingUnit>
            </View>
            <PillarLabel>{t("stats.avgScore")}</PillarLabel>
          </SupportPillar>
        </SupportStack>
      </PillarsRow>
    </Wrap>
  );
}
