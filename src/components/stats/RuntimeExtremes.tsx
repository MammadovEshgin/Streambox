import { Image, Pressable } from "react-native";
import styled from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { withAlpha } from "../../theme/Theme";
import { SectionGrid, StatsSection } from "./StatsSection";

const ItemCard = styled(Pressable)`
  flex: 1;
  background-color: ${({ theme }) => withAlpha(theme.colors.background, 0.28)};
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.04)};
  padding: 14px;
  align-items: center;
`;

const TagLabel = styled.Text`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.36)};
`;

const Poster = styled(Image)`
  width: 78px;
  height: 116px;
  border-radius: 5px;
  background-color: rgba(255, 255, 255, 0.04);
  margin-top: 12px;
  margin-bottom: 12px;
`;

const PosterPlaceholder = styled.View`
  width: 78px;
  height: 116px;
  border-radius: 5px;
  background-color: rgba(255, 255, 255, 0.04);
  margin-top: 12px;
  margin-bottom: 12px;
`;

const ItemTitle = styled.Text`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
`;

const RuntimeText = styled.Text`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  margin-top: 6px;
`;

type Props = {
  history: WatchHistoryEntry[];
  onItemPress?: (entry: { id: number | string; mediaType: string }) => void;
};

function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function RuntimeExtremes({ history, onItemPress }: Props) {
  const withRuntime = history.filter((entry) => entry.runtimeMinutes && entry.runtimeMinutes > 0);

  if (withRuntime.length === 0) {
    return null;
  }

  const longest = withRuntime.reduce((left, right) => ((left.runtimeMinutes ?? 0) > (right.runtimeMinutes ?? 0) ? left : right));
  const shortest = withRuntime.reduce((left, right) => ((left.runtimeMinutes ?? Infinity) < (right.runtimeMinutes ?? Infinity) ? left : right));

  return (
    <StatsSection title="Runtime Extremes" subtitle="Your shortest and longest watches side by side.">
      <SectionGrid>
        <ItemCard onPress={() => onItemPress?.(longest)}>
          <TagLabel>Longest</TagLabel>
          {longest.posterPath ? (
            <Poster source={{ uri: `https://image.tmdb.org/t/p/w185${longest.posterPath}` }} />
          ) : (
            <PosterPlaceholder />
          )}
          <ItemTitle numberOfLines={2}>{longest.title}</ItemTitle>
          <RuntimeText>{formatRuntime(longest.runtimeMinutes!)}</RuntimeText>
        </ItemCard>
        <ItemCard onPress={() => onItemPress?.(shortest)}>
          <TagLabel>Shortest</TagLabel>
          {shortest.posterPath ? (
            <Poster source={{ uri: `https://image.tmdb.org/t/p/w185${shortest.posterPath}` }} />
          ) : (
            <PosterPlaceholder />
          )}
          <ItemTitle numberOfLines={2}>{shortest.title}</ItemTitle>
          <RuntimeText>{formatRuntime(shortest.runtimeMinutes!)}</RuntimeText>
        </ItemCard>
      </SectionGrid>
    </StatsSection>
  );
}
