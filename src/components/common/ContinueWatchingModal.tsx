import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal } from "react-native";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components/native";

import { formatPlaybackTime } from "../../utils/continueWatching";

const Overlay = styled.View`
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
  padding: 22px 20px;
`;

const IconRow = styled.View`
  align-items: center;
  margin-bottom: 14px;
`;

const Badge = styled.View`
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background-color: ${({ theme }) => theme.colors.primarySoft};
  align-items: center;
  justify-content: center;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
  text-align: center;
`;

const TimeTag = styled.View`
  align-self: center;
  margin-top: 10px;
  padding: 4px 12px;
  border-radius: 4px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primaryMuted};
  background-color: ${({ theme }) => theme.colors.primarySoft};
`;

const TimeTagText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.8px;
`;

const Body = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
  text-align: center;
`;

const FooterRow = styled.View`
  margin-top: 20px;
  flex-direction: row;
  gap: 10px;
`;

const FooterButton = styled.Pressable<{ $primary: boolean }>`
  flex: 1;
  min-height: 44px;
  border-radius: 10px;
  padding: 10px 14px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $primary, theme }) =>
    $primary ? theme.colors.primary : theme.colors.border};
  background-color: ${({ $primary, theme }) =>
    $primary ? theme.colors.primarySoftStrong : theme.colors.surfaceRaised};
`;

const FooterLabel = styled.Text<{ $primary: boolean }>`
  color: ${({ $primary, theme }) =>
    $primary ? theme.colors.primary : theme.colors.textPrimary};
  font-size: 13px;
  font-weight: 700;
`;

type Props = {
  visible: boolean;
  positionSeconds: number;
  onResume: () => void;
  onStartOver: () => void;
};

export function ContinueWatchingModal({ visible, positionSeconds, onResume, onStartOver }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const time = formatPlaybackTime(positionSeconds);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onStartOver}>
      <Overlay>
        <Sheet>
          <IconRow>
            <Badge>
              <MaterialCommunityIcons name="history" size={28} color={theme.colors.primary} />
            </Badge>
          </IconRow>

          <Title>{t("player.resumeTitle")}</Title>

          <TimeTag>
            <TimeTagText>{time}</TimeTagText>
          </TimeTag>

          <Body>{t("player.resumeBody", { time })}</Body>

          <FooterRow>
            <FooterButton $primary={false} onPress={onStartOver}>
              <FooterLabel $primary={false}>{t("player.resumeStartOver")}</FooterLabel>
            </FooterButton>
            <FooterButton $primary={true} onPress={onResume}>
              <FooterLabel $primary={true}>{t("player.resumeConfirm")}</FooterLabel>
            </FooterButton>
          </FooterRow>
        </Sheet>
      </Overlay>
    </Modal>
  );
}
