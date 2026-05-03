import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform } from "react-native";
import styled, { useTheme } from "styled-components/native";

import type { WatchHistoryEntry } from "../../hooks/useWatchHistory";
import { formatLocalizedMonthDayYear, formatLocalizedMonthYear } from "../../localization/format";
import i18n from "../../localization/i18n";

export type WatchedSelectionMode = "dated" | "undated";

export function normalizeWatchedDate(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized.getTime();
}

export function normalizeWatchedMonth(date: Date) {
  const normalized = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  return normalized.getTime();
}

export function formatWatchedDateLabel(value: number | Date) {
  return formatLocalizedMonthDayYear(value);
}

export function formatWatchHistoryEntryLabel(entry: Pick<WatchHistoryEntry, "watchPrecision" | "watchedAt">, t: (key: string, options?: Record<string, unknown>) => string) {
  if (entry.watchPrecision === "none") {
    return t("detail.watchedWithoutDate");
  }

  if (entry.watchPrecision === "month") {
    return t("detail.watchedInMonth", { date: formatLocalizedMonthYear(entry.watchedAt) });
  }

  return t("common.watchedOn", { date: formatWatchedDateLabel(entry.watchedAt) });
}

const Overlay = styled.Pressable`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.76);
  justify-content: center;
  padding: 24px 18px;
`;

const Sheet = styled.View`
  border-radius: 6px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 18px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
  letter-spacing: -0.2px;
`;

const ModeRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  gap: 10px;
`;

const ModeCard = styled.Pressable<{ $active: boolean }>`
  flex: 1;
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised};
  padding: 14px 12px;
`;

const ModeTitle = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 13px;
`;

const ModeDescription = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
`;

const DateSection = styled.View`
  margin-top: 16px;
`;

const DateSectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  margin-bottom: 10px;
`;

const PresetRow = styled.View`
  flex-direction: row;
  gap: 8px;
  align-items: center;
`;

const PresetChip = styled.Pressable<{ $active: boolean }>`
  padding: 8px 12px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoft : theme.colors.surfaceRaised)};
`;

const PresetText = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-family: ${({ $active }) => ($active ? "Outfit_600SemiBold" : "Outfit_400Regular")};
  font-size: 12px;
`;

const CalendarChip = styled.Pressable<{ $active: boolean }>`
  width: 38px;
  height: 38px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoft : theme.colors.surfaceRaised)};
  align-items: center;
  justify-content: center;
`;

const SelectedDateCard = styled.View`
  margin-top: 12px;
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  padding: 12px 14px;
`;

const SelectedDateLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 11px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

const SelectedDateValue = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

const PickerWrap = styled.View`
  margin-top: 12px;
  border-radius: 5px;
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
  border-radius: 3px;
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
  font-family: Outfit_700Bold;
  font-size: 13px;
`;

type Props = {
  visible: boolean;
  title: string;
  mediaLabel: "movie" | "series";
  selectedDate: Date;
  selectedMode: WatchedSelectionMode;
  isWatched: boolean;
  onChangeDate: (date: Date) => void;
  onChangeMode: (mode: WatchedSelectionMode) => void;
  onClose: () => void;
  onSave: () => void;
  onRemove?: () => void;
};

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

export function WatchedDateModal({
  visible,
  title,
  mediaLabel,
  selectedDate,
  selectedMode,
  isWatched,
  onChangeDate,
  onChangeMode,
  onClose,
  onSave,
  onRemove,
}: Props) {
  const currentTheme = useTheme();
  const { t } = useTranslation();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const today = new Date();
  const yesterday = shiftDays(today, -1);
  const lastWeek = shiftDays(today, -7);

  useEffect(() => {
    if (!visible) {
      setShowDatePicker(false);
    }
  }, [visible]);

  const handlePickerChange = (event: DateTimePickerEvent, nextDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }

    if (event.type === "dismissed" || !nextDate) {
      return;
    }

    onChangeDate(nextDate);
  };

  const handleOpenPicker = () => {
    setShowDatePicker((previous) => (Platform.OS === "ios" ? !previous : true));
  };

  const isDatedMode = selectedMode === "dated";

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Overlay onPress={onClose}>
        <Sheet>
          <Title>{title}</Title>

          <ModeRow>
            <ModeCard $active={isDatedMode} onPress={() => onChangeMode("dated")}>
              <ModeTitle $active={isDatedMode}>{t("detail.pickSpecificDate")}</ModeTitle>
              <ModeDescription>{t("detail.chooseWatchedDateDescription", {
                mediaLabel: mediaLabel === "movie" ? t("common.movie").toLowerCase() : t("common.series").toLowerCase(),
              })}</ModeDescription>
            </ModeCard>
            <ModeCard $active={!isDatedMode} onPress={() => onChangeMode("undated")}>
              <ModeTitle $active={!isDatedMode}>{t("common.justWatched")}</ModeTitle>
              <ModeDescription>{t("detail.markWatchedWithoutDateDescription")}</ModeDescription>
            </ModeCard>
          </ModeRow>

          {isDatedMode ? (
            <DateSection>
              <DateSectionTitle>{t("detail.pickSpecificDate")}</DateSectionTitle>
              <PresetRow>
                <PresetChip $active={sameDay(selectedDate, today)} onPress={() => onChangeDate(today)}>
                  <PresetText $active={sameDay(selectedDate, today)}>{t("common.today")}</PresetText>
                </PresetChip>
                <PresetChip $active={sameDay(selectedDate, yesterday)} onPress={() => onChangeDate(yesterday)}>
                  <PresetText $active={sameDay(selectedDate, yesterday)}>{t("common.yesterday")}</PresetText>
                </PresetChip>
                <PresetChip $active={sameDay(selectedDate, lastWeek)} onPress={() => onChangeDate(lastWeek)}>
                  <PresetText $active={sameDay(selectedDate, lastWeek)}>{t("common.oneWeekAgo")}</PresetText>
                </PresetChip>
                <CalendarChip $active={showDatePicker} onPress={handleOpenPicker}>
                  <Feather name="calendar" size={16} color={currentTheme.colors.primary} />
                </CalendarChip>
              </PresetRow>

              <SelectedDateCard>
                <SelectedDateLabel>{t("detail.chosenDate")}</SelectedDateLabel>
                <SelectedDateValue>{formatWatchedDateLabel(selectedDate)}</SelectedDateValue>
              </SelectedDateCard>

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
                    positiveButton={{ label: i18n.t("common.confirm"), textColor: currentTheme.colors.primary }}
                    negativeButton={{ label: i18n.t("common.cancel"), textColor: currentTheme.colors.primary }}
                  />
                )
              ) : null}
            </DateSection>
          ) : null}

          <FooterRow>
            {isWatched && onRemove ? (
              <FooterButton $primary={false} $danger={true} onPress={onRemove}>
                <FooterLabel $primary={false} $danger={true}>{t("common.remove")}</FooterLabel>
              </FooterButton>
            ) : null}
            <FooterButton $primary={true} onPress={onSave}>
              <FooterLabel $primary={true}>
                {isDatedMode ? (isWatched ? t("common.update") : t("common.save")) : t("detail.markWatchedWithoutDate")}
              </FooterLabel>
            </FooterButton>
          </FooterRow>
        </Sheet>
      </Overlay>
    </Modal>
  );
}
