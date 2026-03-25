import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useMemo } from "react";
import { Modal, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import type { SeriesSeason } from "../../api/tmdb";

/* ------------------------------------------------------------------ */
/*  Styled components                                                  */
/* ------------------------------------------------------------------ */

const Overlay = styled.Pressable`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.76);
  justify-content: center;
  padding: 24px 18px;
`;

const Sheet = styled.View`
  border-radius: 18px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 18px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const ProgressSummary = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 18px;
`;

const ProgressBarTrack = styled.View`
  margin-top: 10px;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  overflow: hidden;
`;

const ProgressBarFill = styled.View<{ $percent: number }>`
  height: 100%;
  width: ${({ $percent }) => $percent}%;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const SeasonsScroll = styled(ScrollView)`
  margin-top: 14px;
  max-height: 280px;
`;

const SeasonRow = styled.Pressable`
  flex-direction: row;
  align-items: center;
  padding: 10px 0;
  border-bottom-width: 1px;
  border-bottom-color: rgba(255, 255, 255, 0.06);
`;

const SeasonName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  font-weight: 600;
  flex: 1;
`;

const SeasonProgress = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  margin-right: 12px;
`;

const FooterRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  justify-content: flex-end;
  gap: 10px;
`;

const FooterButton = styled.Pressable`
  min-width: 82px;
  min-height: 42px;
  border-radius: 10px;
  padding: 10px 14px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primary};
  background-color: ${({ theme }) => theme.colors.primarySoftStrong};
`;

const FooterLabel = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 13px;
  font-weight: 700;
`;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  visible: boolean;
  seriesTitle: string;
  seasons: SeriesSeason[];
  seriesId: number;
  isEpisodeWatched: (seriesId: number, seasonNumber: number, episodeNumber: number) => boolean;
  markSeasonWatched: (seriesId: number, seasonNumber: number, episodeNumbers: number[]) => Promise<void>;
  unmarkSeasonWatched: (seriesId: number, seasonNumber: number, episodeNumbers: number[]) => Promise<void>;
  onConfirm: (allSeasonsWatched: boolean) => void;
  onClose: () => void;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SeriesWatchedModal({
  visible,
  seriesTitle,
  seasons,
  seriesId,
  isEpisodeWatched,
  markSeasonWatched,
  unmarkSeasonWatched,
  onConfirm,
  onClose,
}: Props) {
  const currentTheme = useTheme();

  const seasonStats = useMemo(() => {
    return seasons.map((season) => {
      let watchedCount = 0;
      for (let ep = 1; ep <= season.episodeCount; ep++) {
        if (isEpisodeWatched(seriesId, season.seasonNumber, ep)) {
          watchedCount++;
        }
      }
      return {
        season,
        watchedCount,
        total: season.episodeCount,
        allWatched: watchedCount === season.episodeCount,
        partial: watchedCount > 0 && watchedCount < season.episodeCount,
      };
    });
  }, [seasons, seriesId, isEpisodeWatched]);

  const totalWatched = useMemo(() => seasonStats.reduce((sum, s) => sum + s.watchedCount, 0), [seasonStats]);
  const totalEpisodes = useMemo(() => seasonStats.reduce((sum, s) => sum + s.total, 0), [seasonStats]);
  const progressPercent = totalEpisodes > 0 ? (totalWatched / totalEpisodes) * 100 : 0;

  const handleSeasonToggle = (stat: (typeof seasonStats)[number]) => {
    const episodeNumbers = Array.from({ length: stat.total }, (_, i) => i + 1);
    if (stat.allWatched) {
      void unmarkSeasonWatched(seriesId, stat.season.seasonNumber, episodeNumbers);
    } else {
      void markSeasonWatched(seriesId, stat.season.seasonNumber, episodeNumbers);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Overlay onPress={onClose}>
        <Sheet onStartShouldSetResponder={() => true}>
          <Title>{seriesTitle}</Title>
          <ProgressSummary>
            {totalWatched} of {totalEpisodes} episodes watched
          </ProgressSummary>

          <ProgressBarTrack>
            <ProgressBarFill $percent={progressPercent} />
          </ProgressBarTrack>

          <SeasonsScroll showsVerticalScrollIndicator={false}>
            {seasonStats.map((stat) => {
              const iconName = stat.allWatched
                ? "checkbox-marked"
                : stat.partial
                  ? "minus-box"
                  : "checkbox-blank-outline";
              const iconColor = stat.allWatched
                ? currentTheme.colors.primary
                : stat.partial
                  ? currentTheme.colors.primaryMuted
                  : currentTheme.colors.textSecondary;

              return (
                <SeasonRow key={stat.season.id} onPress={() => handleSeasonToggle(stat)}>
                  <SeasonName>{stat.season.name || `Season ${stat.season.seasonNumber}`}</SeasonName>
                  <SeasonProgress>
                    {stat.watchedCount}/{stat.total}
                  </SeasonProgress>
                  <MaterialCommunityIcons name={iconName} size={22} color={iconColor} />
                </SeasonRow>
              );
            })}
          </SeasonsScroll>

          <FooterRow>
            <FooterButton onPress={() => { onConfirm(totalWatched === totalEpisodes && totalEpisodes > 0); onClose(); }}>
              <FooterLabel>Confirm</FooterLabel>
            </FooterButton>
          </FooterRow>
        </Sheet>
      </Overlay>
    </Modal>
  );
}
