import { Feather } from "@expo/vector-icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ScrollView } from "react-native";
import styled, { useTheme } from "styled-components/native";

import { BADGE_DEFINITIONS, type BadgeCategory, type BadgeDefinition } from "../../constants/badges";
import type { BadgeProgress } from "../../services/badgeEngine";
import { BadgeIcon } from "./BadgeArt";

const SheetRoot = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const SheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 54px 20px 12px;
`;

const SheetTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 20px;
  letter-spacing: -0.4px;
`;

const CloseButton = styled.Pressable`
  width: 34px;
  height: 34px;
  border-radius: 17px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin: 18px 20px 8px;
`;

const BadgeRow = styled.View<{ $locked: boolean }>`
  flex-direction: row;
  align-items: center;
  margin: 4px 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  opacity: ${({ $locked }) => ($locked ? 0.45 : 1)};
`;

const RowInfo = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const BadgeName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
  letter-spacing: -0.15px;
`;

const BadgeDescription = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 11.5px;
  line-height: 15px;
  margin-top: 2px;
`;

const ProgressTrack = styled.View`
  height: 4px;
  border-radius: 2px;
  margin-top: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  overflow: hidden;
`;

const ProgressFill = styled.View<{ $ratio: number; $color: string }>`
  width: ${({ $ratio }) => Math.round($ratio * 100)}%;
  height: 4px;
  border-radius: 2px;
  background-color: ${({ $color }) => $color};
`;

const ProgressCaption = styled.Text<{ $earned: boolean; $color: string }>`
  color: ${({ $earned, $color, theme }) => ($earned ? $color : theme.colors.textTertiary)};
  font-family: Outfit_600SemiBold;
  font-size: 11px;
  margin-left: 10px;
`;

const RowRight = styled.View`
  align-items: flex-end;
`;

const BottomSpacer = styled.View`
  height: 32px;
`;

const CATEGORY_ORDER: BadgeCategory[] = ["milestones", "genres", "special"];

function formatProgress(definition: BadgeDefinition, progress: BadgeProgress) {
  // Hours badge tracks minutes internally; surface it as hours.
  if (definition.id === "hundredHours") {
    const currentHours = Math.min(Math.floor(progress.current / 60), definition.target / 60);
    return `${currentHours}/${definition.target / 60}`;
  }

  return `${Math.min(progress.current, definition.target)}/${definition.target}`;
}

type BadgesModalProps = {
  visible: boolean;
  progress: BadgeProgress[];
  onClose: () => void;
};

export function BadgesModal({ visible, progress, onClose }: BadgesModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const progressById = useMemo(
    () => new Map(progress.map((status) => [status.id, status])),
    [progress]
  );

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <SheetRoot>
        <SheetHeader>
          <SheetTitle>{t("profile.badges.title")}</SheetTitle>
          <CloseButton onPress={onClose} hitSlop={8}>
            <Feather name="x" size={18} color={theme.colors.textPrimary} />
          </CloseButton>
        </SheetHeader>

        <ScrollView showsVerticalScrollIndicator={false}>
          {CATEGORY_ORDER.map((category) => (
            <SectionWrap key={category}>
              <SectionTitle>{t(`profile.badges.sections.${category}`)}</SectionTitle>
              {BADGE_DEFINITIONS.filter((definition) => definition.category === category).map(
                (definition) => {
                  const status = progressById.get(definition.id);
                  if (!status) {
                    return null;
                  }

                  const ratio = Math.max(0, Math.min(1, status.current / status.target));
                  return (
                    <BadgeRow key={definition.id} $locked={!status.earned}>
                      <BadgeIcon id={definition.id} size={46} />
                      <RowInfo>
                        <BadgeName>{t(`profile.badges.items.${definition.id}.name`)}</BadgeName>
                        <BadgeDescription>
                          {t(`profile.badges.items.${definition.id}.description`)}
                        </BadgeDescription>
                        {!status.earned && (
                          <ProgressTrack>
                            <ProgressFill $ratio={ratio} $color={definition.ringColor} />
                          </ProgressTrack>
                        )}
                      </RowInfo>
                      <RowRight>
                        {status.earned ? (
                          <Feather name="check-circle" size={16} color={definition.ringColor} />
                        ) : (
                          <ProgressCaption $earned={false} $color={definition.ringColor}>
                            {formatProgress(definition, status)}
                          </ProgressCaption>
                        )}
                      </RowRight>
                    </BadgeRow>
                  );
                }
              )}
            </SectionWrap>
          ))}
          <BottomSpacer />
        </ScrollView>
      </SheetRoot>
    </Modal>
  );
}

const SectionWrap = styled.View``;
