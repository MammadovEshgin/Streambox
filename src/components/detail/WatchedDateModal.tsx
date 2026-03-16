import { Feather } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { Modal, Platform } from "react-native";
import styled, { useTheme } from "styled-components/native";

export function normalizeWatchedDate(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized.getTime();
}

export function formatWatchedDateLabel(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

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

const Subtitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
`;

const PresetRow = styled.View`
  margin-top: 16px;
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

type Props = {
  visible: boolean;
  title: string;
  mediaLabel: "movie" | "series";
  selectedDate: Date;
  isWatched: boolean;
  onChangeDate: (date: Date) => void;
  onClose: () => void;
  onSave: () => void;
  onRemove?: () => void;
};

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
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
  isWatched,
  onChangeDate,
  onClose,
  onSave,
  onRemove,
}: Props) {
  const currentTheme = useTheme();
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

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Overlay onPress={onClose}>
        <Sheet>
          <Title>{title}</Title>
          <Subtitle>
            Choose the date you actually watched this {mediaLabel}. StreamBox will use this date in watched
            activity, grids, and timeline stats.
          </Subtitle>

          <PresetRow>
            <PresetChip $active={sameDay(selectedDate, today)} onPress={() => onChangeDate(today)}>
              <PresetText $active={sameDay(selectedDate, today)}>Today</PresetText>
            </PresetChip>
            <PresetChip $active={sameDay(selectedDate, yesterday)} onPress={() => onChangeDate(yesterday)}>
              <PresetText $active={sameDay(selectedDate, yesterday)}>Yesterday</PresetText>
            </PresetChip>
            <PresetChip $active={sameDay(selectedDate, lastWeek)} onPress={() => onChangeDate(lastWeek)}>
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
            {isWatched && onRemove ? (
              <FooterButton $primary={false} $danger={true} onPress={onRemove}>
                <FooterLabel $primary={false} $danger={true}>Remove</FooterLabel>
              </FooterButton>
            ) : null}
            <FooterButton $primary={true} onPress={onSave}>
              <FooterLabel $primary={true}>{isWatched ? "Update" : "Save"}</FooterLabel>
            </FooterButton>
          </FooterRow>
        </Sheet>
      </Overlay>
    </Modal>
  );
}
