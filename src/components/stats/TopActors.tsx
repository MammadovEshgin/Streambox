import { useMemo, useState } from "react";
import { Image, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import {
  DataLabel,
  DataMeta,
  DataRow,
  EmptyText,
  FilterChip,
  FilterLabel,
  PillRow,
  RankPill,
  RankText,
  StatsSection,
} from "./StatsSection";

const Rows = styled.View`
  gap: 0;
`;

const RowWrap = styled.View``;

const RowDivider = styled.View`
  height: 1px;
  background-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.05)};
  margin-vertical: 10px;
`;

const Avatar = styled(Image)`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  margin-right: 12px;
`;

const AvatarPlaceholder = styled.View`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.32)};
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.06)};
  align-items: center;
  justify-content: center;
  margin-right: 12px;
`;

const AvatarLetter = styled.Text`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.4)};
`;

const Info = styled.View`
  flex: 1;
`;

type Props = {
  history: WatchHistoryEntry[];
  itemLabelSingular: string;
  itemLabelPlural: string;
  onActorPress: (actorId: number, actorName: string) => void;
};

type ActorFilter = "all" | "male" | "female";

type ActorStat = {
  id: number;
  name: string;
  profilePath: string | null;
  count: number;
};

export function TopActors({ history, itemLabelSingular, itemLabelPlural, onActorPress }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ActorFilter>("all");

  const topActors = useMemo(() => {
    const actorMap = new Map<number, ActorStat>();

    for (const entry of history) {
      for (let index = 0; index < entry.castIds.length; index++) {
        const gender = entry.castGenders[index] ?? null;
        if (filter === "male" && gender !== "male") continue;
        if (filter === "female" && gender !== "female") continue;

        const id = entry.castIds[index];
        const existing = actorMap.get(id);
        if (existing) {
          existing.count++;
        } else {
          actorMap.set(id, {
            id,
            name: entry.castNames[index] ?? t("common.unknown"),
            profilePath: entry.castProfilePaths[index] ?? null,
            count: 1,
          });
        }
      }
    }

    return Array.from(actorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filter, history]);

  const emptyText =
    filter === "male"
      ? t("stats.noMaleActors")
      : filter === "female"
        ? t("stats.noFemaleActors")
        : t("stats.noActorPatterns");

  return (
    <StatsSection
      title={t("stats.topActorsTitle")}
      subtitle={t("stats.topActorsSubtitle")}
      accentGlow
      action={
        <PillRow>
          <FilterChip $active={filter === "all"} onPress={() => setFilter("all")}>
            <FilterLabel $active={filter === "all"}>{t("common.all")}</FilterLabel>
          </FilterChip>
          <FilterChip $active={filter === "male"} onPress={() => setFilter("male")}>
            <FilterLabel $active={filter === "male"}>{t("common.male")}</FilterLabel>
          </FilterChip>
          <FilterChip $active={filter === "female"} onPress={() => setFilter("female")}>
            <FilterLabel $active={filter === "female"}>{t("common.female")}</FilterLabel>
          </FilterChip>
        </PillRow>
      }
    >
      {topActors.length > 0 ? (
        <Rows>
          {topActors.map((actor, index) => (
            <RowWrap key={actor.id}>
              <Pressable onPress={() => onActorPress(actor.id, actor.name)}>
                <DataRow>
                  <RankPill>
                    <RankText style={{ opacity: index === 0 ? 1 : 0.5 }}>{index + 1}</RankText>
                  </RankPill>
                  {actor.profilePath ? (
                    <Avatar source={{ uri: `https://image.tmdb.org/t/p/w185${actor.profilePath}` }} />
                  ) : (
                    <AvatarPlaceholder>
                      <AvatarLetter>{actor.name[0]}</AvatarLetter>
                    </AvatarPlaceholder>
                  )}
                  <Info>
                    <DataLabel numberOfLines={1} style={{ fontWeight: index === 0 ? "700" : "600" }}>{actor.name}</DataLabel>
                    <DataMeta>
                      {actor.count} {actor.count === 1 ? itemLabelSingular : itemLabelPlural}
                    </DataMeta>
                  </Info>
                </DataRow>
              </Pressable>
              {index < topActors.length - 1 ? <RowDivider /> : null}
            </RowWrap>
          ))}
        </Rows>
      ) : (
        <EmptyText>{emptyText}</EmptyText>
      )}
    </StatsSection>
  );
}
