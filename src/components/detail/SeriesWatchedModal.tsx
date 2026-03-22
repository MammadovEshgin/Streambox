import { Feather } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useMemo, useState } from "react";
import { Modal, Platform, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import type { SeriesSeason } from "../../api/tmdb";
import { normalizeWatchedDate } from "./WatchedDateModal";

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

const DatePickerSection = styled.View`
  margin-top: 14px;
`;

const PresetRow = styled.View`
  flex-direction: row;
  gap: 8px;
  align-items: center;
`;

const PresetChip = styled.Pressable<{ $active: boolean }>`
  padding: 8px 12px;
  border-radius: 4px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoft : theme.colors.surfaceRaised)};
`;

const PresetText = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-size: 12px;
  font-weight: 600;
`;

const CalendarChip = styled.Pressable<{ $active: boolean }>`
  width: 38px;
  height: 38px;
  border-radius: 4px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoft : theme.colors.surfaceRaised)};
  align-items: center;
  justify-content: center;
`;

const PickerWrap = styled.View`
  margin-top: 12px;
  border-radius: 12px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const FooterRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  justify-content: flex-end;
  gap: 10px;
`;

const FooterButton = styled.Pressable<{ $primary: boolean; $danger?: boolean }>`
  min-width: 82px;
  min-height: 42px;
  border-radius: 10px;
  padding: 10px 14px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $primary, $danger, theme }) =>
    $danger ? "#E5484D" : $primary ? theme.colors.primary : theme.colors.border};
  background-color: ${({ $primary, $danger, theme }) =>
    $danger ? "rgba(229, 72, 77, 0.12)" : $primary ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised};
`;

const FooterLabel = styled.Text<{ $primary: boolean; $danger?: boolean }>`
  color: ${({ $primary, $danger, theme }) =>
    $danger ? "#E5484D" : $primary ? theme.colors.primary : theme.colors.textPrimary};
  font-size: 13px;
  font-weight: 700;
`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function shiftDays(base: Date, diff: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + diff);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  visible: boolean;
  seriesTitle: string;
  seasons: SeriesSeason[];
  seriesId: number;
  isWatched: boolean;
  watchedAt: number | null;
  isEpisodeWatched: (seriesId: number, seasonNumber: number, episodeNumber: number) => boolean;
  markSeasonWatched: (seriesId: number, seasonNumber: number, episodeNumbers: number[]) => Promise<void>;
  unmarkSeasonWatched: (seriesId: number, seasonNumber: number, episodeNumbers: number[]) => Promise<void>;
  onMarkAllWatched: (date: Date) => void;
  onRemoveFromHistory: () => void;
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
  isWatched,
  isEpisodeWatched,
  markSeasonWatched,
  unmarkSeasonWatched,
  onMarkAllWatched,
  onRemoveFromHistory,
  onClose,
}: Props) {
  const currentTheme = useTheme();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showDateSection, setShowDateSection] = useState(false);

  const today = new Date();
  const yesterday = shiftDays(today, -1);
  const lastWeek = shiftDays(today, -7);

  // Compute per-season progress
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

  const handleMarkAllPress = () => {
    setShowDateSection(true);
    setSelectedDate(new Date());
  };

  const handleConfirmMarkAll = () => {
    onMarkAllWatched(selectedDate);
    setShowDateSection(false);
    setShowDatePicker(false);
  };

  const handlePickerChange = (event: DateTimePickerEvent, nextDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (event.type === "dismissed" || !nextDate) {
      return;
    }
    setSelectedDate(nextDate);
  };

  const handleOpenPicker = () => {
    setShowDatePicker((prev) => (Platform.OS === "ios" ? !prev : true));
  };

  // Reset local state when modal hides
  if (!visible && (showDateSection || showDatePicker)) {
    setShowDateSection(false);
    setShowDatePicker(false);
  }

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

          {showDateSection ? (
            <DatePickerSection>
              <PresetRow>
                <PresetChip $active={sameDay(selectedDate, today)} onPress={() => setSelectedDate(today)}>
                  <PresetText $active={sameDay(selectedDate, today)}>Today</PresetText>
                </PresetChip>
                <PresetChip $active={sameDay(selectedDate, yesterday)} onPress={() => setSelectedDate(yesterday)}>
                  <PresetText $active={sameDay(selectedDate, yesterday)}>Yesterday</PresetText>
                </PresetChip>
                <PresetChip $active={sameDay(selectedDate, lastWeek)} onPress={() => setSelectedDate(lastWeek)}>
                  <PresetText $active={sameDay(selectedDate, lastWeek)}>1 Week Ago</PresetText>
                </PresetChip>
                <CalendarChip $active={showDatePicker} onPress={handleOpenPicker}>
                  <Feather name="calendar" size={16} color={currentTheme.colors.primary} />
                </CalendarChip>
              </PresetRow>

              {showDatePicker ? (
                Platform.OS === "ios" ? (
                  <PickerWrap>
                    <DateTimePicker
                      value={selectedDate}
                      mode="date"
                      display="spinner"
                      maximumDate={today}
                      onChange={handlePickerChange}
                      textColor={currentTheme.colors.primary}
                      accentColor={currentTheme.colors.primary}
                      themeVariant="dark"
                    />
                  </PickerWrap>
                ) : (
                  <DateTimePicker
                    value={selectedDate}
                    mode="date"
                    display="calendar"
                    maximumDate={today}
                    onChange={handlePickerChange}
                    positiveButton={{ label: "OK", textColor: currentTheme.colors.primary }}
                    negativeButton={{ label: "Cancel", textColor: currentTheme.colors.primary }}
                  />
                )
              ) : null}

              <FooterRow>
                <FooterButton $primary={false} onPress={() => setShowDateSection(false)}>
                  <FooterLabel $primary={false}>Cancel</FooterLabel>
                </FooterButton>
                <FooterButton $primary={true} onPress={handleConfirmMarkAll}>
                  <FooterLabel $primary={true}>Confirm</FooterLabel>
                </FooterButton>
              </FooterRow>
            </DatePickerSection>
          ) : (
            <FooterRow>
              {isWatched ? (
                <FooterButton $primary={false} $danger={true} onPress={onRemoveFromHistory}>
                  <FooterLabel $primary={false} $danger={true}>Remove</FooterLabel>
                </FooterButton>
              ) : null}
              <FooterButton $primary={true} onPress={handleMarkAllPress}>
                <FooterLabel $primary={true}>Mark All Watched</FooterLabel>
              </FooterButton>
            </FooterRow>
          )}
        </Sheet>
      </Overlay>
    </Modal>
  );
}
