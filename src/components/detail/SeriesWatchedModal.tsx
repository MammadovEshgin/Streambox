import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ScrollView } from "react-native";
import styled from "styled-components/native";

import type { SeriesSeason } from "../../api/tmdb";
import { formatLocalizedDate, formatLocalizedMonthYear } from "../../localization/format";
import { normalizeWatchedMonth } from "./WatchedDateModal";

export type SeriesSeasonWatchedMode = "unwatched" | "month" | "undated";

export type SeriesSeasonWatchedDraft = {
  seasonNumber: number;
  mode: SeriesSeasonWatchedMode;
  watchedAt: number;
};

const Overlay = styled.Pressable`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.78);
  justify-content: center;
  padding: 22px 16px;
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
  font-size: 20px;
  letter-spacing: -0.2px;
`;

const Subtitle = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 19px;
`;

const SummaryCard = styled.View`
  margin-top: 16px;
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  padding: 14px;
`;

const SummaryValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
`;

const SummaryLabel = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
`;

const SeasonsScroll = styled(ScrollView)`
  margin-top: 14px;
  max-height: 360px;
`;

const SeasonCard = styled.View`
  margin-bottom: 12px;
  border-radius: 5px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  padding: 14px;
`;

const SeasonHeader = styled.View`
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const SeasonHeadingWrap = styled.View`
  flex: 1;
`;

const SeasonName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 15px;
  line-height: 20px;
`;

const SeasonMeta = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
`;

const StatusBadge = styled.View<{ $active: boolean }>`
  border-radius: 3px;
  padding: 5px 10px;
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primarySoftStrong : theme.colors.surface};
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
`;

const StatusBadgeLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textSecondary)};
  font-family: Outfit_700Bold;
  font-size: 11px;
  letter-spacing: 0.25px;
`;

const ModeRow = styled.View`
  margin-top: 12px;
  flex-direction: row;
  gap: 8px;
`;

const ModeChip = styled.Pressable<{ $active: boolean }>`
  flex: 1;
  min-height: 42px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primarySoftStrong : theme.colors.surface};
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
`;

const ModeChipLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 12px;
  text-align: center;
`;

const MonthPickerButton = styled.Pressable`
  margin-top: 12px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 12px 14px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const MonthPickerLabelWrap = styled.View`
  flex: 1;
`;

const MonthPickerCaption = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.45px;
`;

const MonthPickerValue = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 14px;
`;

const FooterRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  justify-content: flex-end;
  gap: 10px;
`;

const FooterButton = styled.Pressable<{ $primary?: boolean }>`
  min-width: 88px;
  min-height: 44px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $primary, theme }) =>
    $primary ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised};
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  opacity: ${({ disabled }) => (disabled ? 0.6 : 1)};
`;

const FooterLabel = styled.Text<{ $primary?: boolean }>`
  color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 13px;
`;

const PickerOverlay = styled.Pressable`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.82);
  justify-content: center;
  padding: 24px 18px;
`;

const PickerCard = styled.View`
  border-radius: 6px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 18px;
`;

const PickerHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const PickerTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 16px;
`;

const PickerYearRow = styled.View`
  margin-top: 14px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const YearButton = styled.Pressable`
  width: 40px;
  height: 40px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  align-items: center;
  justify-content: center;
`;

const YearValue = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
`;

const MonthGrid = styled.View`
  margin-top: 16px;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
`;

const MonthOption = styled.Pressable<{ $active: boolean }>`
  width: 31%;
  min-height: 48px;
  border-radius: 3px;
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $active, theme }) =>
    $active ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised};
  align-items: center;
  justify-content: center;
  padding: 8px;
`;

const MonthOptionLabel = styled.Text<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 12px;
`;

type Props = {
  visible: boolean;
  seriesTitle: string;
  seasons: SeriesSeason[];
  initialDrafts: SeriesSeasonWatchedDraft[];
  onSave: (drafts: SeriesSeasonWatchedDraft[]) => Promise<void> | void;
  onClose: () => void;
};

function buildDraftMap(drafts: SeriesSeasonWatchedDraft[]) {
  return drafts.reduce<Record<number, SeriesSeasonWatchedDraft>>((acc, draft) => {
    acc[draft.seasonNumber] = draft;
    return acc;
  }, {});
}

export function SeriesWatchedModal({
  visible,
  seriesTitle,
  seasons,
  initialDrafts,
  onSave,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<SeriesSeasonWatchedDraft[]>(initialDrafts);
  const [pickerSeasonNumber, setPickerSeasonNumber] = useState<number | null>(null);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDrafts(initialDrafts);
      setPickerSeasonNumber(null);
      setPickerYear(new Date().getFullYear());
      setIsSaving(false);
    }
  }, [initialDrafts, visible]);

  const draftMap = useMemo(() => buildDraftMap(drafts), [drafts]);

  const watchedCount = useMemo(
    () => drafts.filter((draft) => draft.mode !== "unwatched").length,
    [drafts]
  );

  const handleChangeMode = (seasonNumber: number, mode: SeriesSeasonWatchedMode) => {
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.seasonNumber === seasonNumber
          ? {
              ...draft,
              mode,
              watchedAt: mode === "unwatched" ? draft.watchedAt : draft.watchedAt || normalizeWatchedMonth(new Date()),
            }
          : draft
      )
    );
  };

  const handleOpenPicker = (seasonNumber: number) => {
    const draft = draftMap[seasonNumber];
    if (!draft) {
      return;
    }

    setPickerSeasonNumber(seasonNumber);
    setPickerYear(new Date(draft.watchedAt).getFullYear());
  };

  const handleSelectMonth = (monthIndex: number) => {
    if (pickerSeasonNumber === null) {
      return;
    }

    const nextValue = normalizeWatchedMonth(new Date(pickerYear, monthIndex, 1));
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        draft.seasonNumber === pickerSeasonNumber
          ? {
              ...draft,
              mode: "month",
              watchedAt: nextValue,
            }
          : draft
      )
    );
    setPickerSeasonNumber(null);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(drafts);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const pickerDraft = pickerSeasonNumber === null ? null : draftMap[pickerSeasonNumber] ?? null;
  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, monthIndex) =>
        formatLocalizedDate(new Date(pickerYear, monthIndex, 1), { month: "short" })
      ),
    [pickerYear]
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
        <Overlay onPress={onClose}>
          <Sheet onStartShouldSetResponder={() => true}>
            <Title>{seriesTitle}</Title>
            <Subtitle>{t("detail.seasonTrackingDescription")}</Subtitle>

            <SummaryCard>
              <SummaryValue>{watchedCount}</SummaryValue>
              <SummaryLabel>
                {watchedCount > 0
                  ? t("detail.seasonsMarkedWatched", { count: watchedCount })
                  : t("detail.markWatchedWithoutDateDescription")}
              </SummaryLabel>
            </SummaryCard>

            <SeasonsScroll showsVerticalScrollIndicator={false}>
              {seasons.map((season) => {
                const draft = draftMap[season.seasonNumber];
                if (!draft) {
                  return null;
                }

                const isMonthMode = draft.mode === "month";
                const isUndatedMode = draft.mode === "undated";
                const isWatched = draft.mode !== "unwatched";
                const seasonLabel = season.name || t("detail.seasonLabel", { number: season.seasonNumber });

                return (
                  <SeasonCard key={season.id}>
                    <SeasonHeader>
                      <SeasonHeadingWrap>
                        <SeasonName>{seasonLabel}</SeasonName>
                        <SeasonMeta>
                          {t("detail.episodesCount", { count: season.episodeCount })}
                        </SeasonMeta>
                      </SeasonHeadingWrap>
                      <StatusBadge $active={isWatched}>
                        <StatusBadgeLabel $active={isWatched}>
                          {isMonthMode
                            ? formatLocalizedMonthYear(draft.watchedAt)
                            : isUndatedMode
                              ? t("common.justWatched")
                              : t("detail.notWatched")}
                        </StatusBadgeLabel>
                      </StatusBadge>
                    </SeasonHeader>

                    <ModeRow>
                      <ModeChip
                        $active={draft.mode === "unwatched"}
                        onPress={() => handleChangeMode(season.seasonNumber, "unwatched")}
                      >
                        <ModeChipLabel $active={draft.mode === "unwatched"}>
                          {t("detail.notWatched")}
                        </ModeChipLabel>
                      </ModeChip>
                      <ModeChip
                        $active={isMonthMode}
                        onPress={() => handleChangeMode(season.seasonNumber, "month")}
                      >
                        <ModeChipLabel $active={isMonthMode}>
                          {t("detail.monthYearMode")}
                        </ModeChipLabel>
                      </ModeChip>
                      <ModeChip
                        $active={isUndatedMode}
                        onPress={() => handleChangeMode(season.seasonNumber, "undated")}
                      >
                        <ModeChipLabel $active={isUndatedMode}>
                          {t("detail.noDateMode")}
                        </ModeChipLabel>
                      </ModeChip>
                    </ModeRow>

                    {isMonthMode ? (
                      <MonthPickerButton onPress={() => handleOpenPicker(season.seasonNumber)}>
                        <MonthPickerLabelWrap>
                          <MonthPickerCaption>{t("detail.selectMonthYear")}</MonthPickerCaption>
                          <MonthPickerValue>{formatLocalizedMonthYear(draft.watchedAt)}</MonthPickerValue>
                        </MonthPickerLabelWrap>
                        <MaterialCommunityIcons
                          name="calendar-month-outline"
                          size={20}
                          color="#FFFFFF"
                        />
                      </MonthPickerButton>
                    ) : null}
                  </SeasonCard>
                );
              })}
            </SeasonsScroll>

            <FooterRow>
              <FooterButton onPress={onClose} disabled={isSaving}>
                <FooterLabel>{t("common.cancel")}</FooterLabel>
              </FooterButton>
              <FooterButton $primary={true} onPress={() => void handleSave()} disabled={isSaving}>
                <FooterLabel $primary={true}>
                  {isSaving ? t("common.loading") : t("common.save")}
                </FooterLabel>
              </FooterButton>
            </FooterRow>
          </Sheet>
        </Overlay>
      </Modal>

      <Modal visible={pickerSeasonNumber !== null} transparent animationType="fade" statusBarTranslucent>
        <PickerOverlay onPress={() => setPickerSeasonNumber(null)}>
          <PickerCard onStartShouldSetResponder={() => true}>
            <PickerHeader>
              <PickerTitle>
                {pickerSeasonNumber === null
                  ? t("detail.selectMonthYear")
                  : t("detail.seasonLabel", { number: pickerSeasonNumber })}
              </PickerTitle>
              <MaterialCommunityIcons
                name="calendar-month-outline"
                size={20}
                color="#FFFFFF"
              />
            </PickerHeader>

            <PickerYearRow>
              <YearButton onPress={() => setPickerYear((current) => current - 1)}>
                <MaterialCommunityIcons name="chevron-left" size={18} color="#FFFFFF" />
              </YearButton>
              <YearValue>{pickerYear}</YearValue>
              <YearButton onPress={() => setPickerYear((current) => current + 1)}>
                <MaterialCommunityIcons name="chevron-right" size={18} color="#FFFFFF" />
              </YearButton>
            </PickerYearRow>

            <MonthGrid>
              {monthLabels.map((label, monthIndex) => {
                const isActive =
                  pickerDraft !== null &&
                  new Date(pickerDraft.watchedAt).getFullYear() === pickerYear &&
                  new Date(pickerDraft.watchedAt).getMonth() === monthIndex;

                return (
                  <MonthOption
                    key={`${pickerYear}-${monthIndex}`}
                    $active={isActive}
                    onPress={() => handleSelectMonth(monthIndex)}
                  >
                    <MonthOptionLabel $active={isActive}>{label}</MonthOptionLabel>
                  </MonthOption>
                );
              })}
            </MonthGrid>
          </PickerCard>
        </PickerOverlay>
      </Modal>
    </>
  );
}
