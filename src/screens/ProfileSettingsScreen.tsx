import { Feather } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, TextInput } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeInDown, FadeOut, FadeIn } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { SafeContainer } from "../components/common/SafeContainer";
import { useAuth } from "../context/AuthContext";
import { sendUserFeedback } from "../services/feedbackService";
import type { ProfileStackParamList } from "../navigation/types";
import {
  exportStreamBoxBackupFile,
  importStreamBoxBackupFile,
  pickStreamBoxBackupFile,
} from "../services/backupService";
import { useAppSettings } from "../settings/AppSettingsContext";
import { THEME_OPTIONS, withAlpha } from "../theme/Theme";
import type { AppLanguage } from "../localization/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "ProfileSettings">;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px 4px;
`;

const BackButton = styled.Pressable`
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`;

const ScreenTitle = styled.Text`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const Content = styled(ScrollView).attrs({
  showsVerticalScrollIndicator: false,
  keyboardShouldPersistTaps: "handled",
  contentContainerStyle: {
    paddingBottom: 52,
  },
})`
  flex: 1;
`;

const IntroCard = styled.View`
  margin: 8px 16px 2px;
  padding: 18px 18px 20px;
  border-radius: 24px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.16)};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const IntroTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 24px;
  line-height: 30px;
  font-weight: 800;
  letter-spacing: -0.55px;
`;

const IntroText = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 21px;
`;

const Section = styled.View`
  margin: 20px 16px 0;
  padding: 20px 18px 18px;
  border-radius: 24px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 19px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.3px;
`;

const SectionText = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 20px;
`;

const Card = styled.View`
  margin-top: 18px;
  padding: 18px;
  border-radius: 20px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.textPrimary, 0.06)};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const Label = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.7px;
  text-transform: uppercase;
`;

const ThemeGrid = styled.View`
  margin-top: 16px;
  gap: 12px;
`;

const ThemePaletteRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  row-gap: 18px;
`;

const ThemeSwatchButton = styled.Pressable`
  width: 23%;
  align-items: center;
  padding-vertical: 2px;
`;

const ThemeSwatchCircle = styled.View<{ $color: string; $selected: boolean }>`
  width: 58px;
  height: 58px;
  border-radius: 29px;
  background-color: ${({ $color }) => $color};
  border-width: ${({ $selected }) => ($selected ? 3 : 1)}px;
  border-color: ${({ $selected, theme }) =>
    $selected ? theme.colors.textPrimary : "rgba(255, 255, 255, 0.18)"};
  align-items: center;
  justify-content: center;
`;

const ThemeSwatchLabel = styled.Text<{ $selected: boolean }>`
  margin-top: 9px;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.textPrimary : theme.colors.textSecondary};
  font-size: 11px;
  line-height: 15px;
  font-weight: ${({ $selected }) => ($selected ? 700 : 500)};
  text-align: center;
`;

const ThemeCard = styled.Pressable<{ $selected: boolean; $primary: string }>`
  padding: 15px 14px;
  border-radius: 18px;
  border-width: 1px;
  border-color: ${({ $selected, $primary, theme }) => ($selected ? $primary : theme.colors.border)};
  background-color: ${({ $selected, $primary, theme }) => ($selected ? withAlpha($primary, 0.14) : theme.colors.surfaceRaised)};
`;

const ThemePreviewRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const ThemeMeta = styled.View`
  flex: 1;
  padding-right: 12px;
`;

const ThemeName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.15px;
`;

const ThemeDescription = styled.Text`
  margin-top: 5px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 18px;
`;

const SwatchRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const Swatch = styled.View<{ $color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 8px;
  background-color: ${({ $color }) => $color};
`;

const BackupActions = styled.View`
  margin-top: 18px;
  gap: 12px;
`;

const BackupButton = styled.Pressable<{ $primary: boolean; $disabled: boolean }>`
  min-height: 50px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 14px;
  border-width: 1px;
  border-color: ${({ $disabled, $primary, theme }) =>
    $disabled ? theme.colors.border : $primary ? theme.colors.primary : theme.colors.border};
  background-color: ${({ $disabled, $primary, theme }) =>
    $disabled
      ? theme.colors.surfaceRaised
      : $primary
        ? theme.colors.primarySoftStrong
        : theme.colors.surfaceRaised};
  opacity: ${({ $disabled }) => ($disabled ? 0.65 : 1)};
`;

const BackupButtonLabel = styled.Text<{ $primary: boolean; $disabled: boolean }>`
  color: ${({ $disabled, $primary, theme }) =>
    $disabled
      ? theme.colors.textSecondary
      : $primary
        ? theme.colors.primary
        : theme.colors.textPrimary};
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2px;
`;

const BackupMeta = styled.Text`
  margin-top: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 18px;
`;

const BackupStatus = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  line-height: 17px;
`;

const FeedbackInput = styled(TextInput).attrs(({ theme }) => ({
  placeholderTextColor: theme.colors.textSecondary,
  textAlignVertical: "top",
}))`
  margin-top: 16px;
  min-height: 144px;
  padding: 14px 16px;
  border-radius: 14px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 14px;
  line-height: 21px;
`;

const CharacterCount = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  text-align: right;
`;


const LogoutButton = styled.Pressable`
  min-height: 50px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 14px;
  border-width: 1px;
  border-color: #E50914;
  background-color: rgba(229, 9, 20, 0.1);
`;

const LogoutLabel = styled.Text`
  color: #E50914;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2px;
`;

const BottomSpacer = styled.View`
  height: 12px;
`;

const SignOutOverlay = styled(Animated.View)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.8);
  align-items: center;
  justify-content: center;
`;

const SignOutContent = styled(Animated.View)`
  align-items: center;
  justify-content: center;
`;

const SignOutTitle = styled.Text`
  color: #FFFFFF;
  font-size: 16px;
  font-weight: 600;
  margin-top: 16px;
  letter-spacing: 0.2px;
  opacity: 0.9;
`;

const ConfirmModalOverlay = styled(Animated.View)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.85);
  align-items: center;
  justify-content: center;
`;

const ConfirmModalBlur = styled(BlurView)`
  position: absolute;
  inset: 0;
`;

const ConfirmModalContent = styled(Animated.View)`
  width: 85%;
  background-color: rgba(23, 23, 23, 0.95);
  border-radius: 28px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  padding: 32px 24px 24px;
  align-items: center;
`;

const ConfirmTitle = styled.Text`
  color: #FFFFFF;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-align: center;
`;

const ConfirmSub = styled.Text`
  color: rgba(255, 255, 255, 0.5);
  font-size: 15px;
  line-height: 22px;
  text-align: center;
  margin-top: 10px;
  margin-bottom: 32px;
`;

const ConfirmActions = styled.View`
  width: 100%;
  gap: 12px;
`;

const ConfirmButton = styled.Pressable<{ $primary?: boolean }>`
  width: 100%;
  height: 54px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${({ $primary, theme }) => 
    $primary ? theme.colors.primary : "rgba(255, 255, 255, 0.05)"};
`;

const ConfirmButtonLabel = styled.Text<{ $primary?: boolean }>`
  color: ${({ $primary }) => ($primary ? "#FFFFFF" : "rgba(255, 255, 255, 0.8)")};
  font-size: 16px;
  font-weight: 700;
`;


export function ProfileSettingsScreen({ navigation }: Props) {
  const currentTheme = useTheme();
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const {
    language,
    setLanguage,
    themeId,
    setThemeId,
    profileName,
    profileLocation,
    reloadPersistedSettings,
  } = useAppSettings();
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const handleExportBackup = useCallback(async () => {
    setBackupStatus(null);
    setIsExporting(true);

    try {
      const { fileUri } = await exportStreamBoxBackupFile();
      const isSharingAvailable = await Sharing.isAvailableAsync();

      if (!isSharingAvailable) {
        throw new Error(t("settings.sharingUnavailable"));
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: t("settings.exportAllData"),
        UTI: "public.json",
      });

      setBackupStatus(t("settings.backupReady"));
    } catch (error) {
      Alert.alert(
        t("settings.exportFailed"),
        error instanceof Error ? error.message : t("settings.backupCreateFailed")
      );
    } finally {
      setIsExporting(false);
    }
  }, [t]);

  const runImportBackup = useCallback(async () => {
    setBackupStatus(null);
    setIsImporting(true);

    try {
      const fileUri = await pickStreamBoxBackupFile();
      if (!fileUri) {
        return;
      }

      await importStreamBoxBackupFile(fileUri);
      await reloadPersistedSettings();
      setBackupStatus(t("settings.backupImported"));
      Alert.alert(t("settings.importComplete"), t("settings.importCompleteMessage"));
    } catch (error) {
      Alert.alert(
        t("settings.importFailed"),
        error instanceof Error ? error.message : t("settings.backupRestoreFailed")
      );
    } finally {
      setIsImporting(false);
    }
  }, [reloadPersistedSettings, t]);

  const handleImportBackup = useCallback(() => {
    Alert.alert(
      t("settings.importBackupTitle"),
      t("settings.importBackupMessage"),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
        },
        {
          text: t("settings.importBackup"),
          style: "destructive",
          onPress: () => {
            void runImportBackup();
          },
        },
      ]
    );
  }, [runImportBackup, t]);

  const languageOptions: Array<{ id: AppLanguage; labelKey: string; descriptionKey: string }> = [
    { id: "en", labelKey: "settings.enLabel", descriptionKey: "settings.enDescription" },
    { id: "tr", labelKey: "settings.trLabel", descriptionKey: "settings.trDescription" },
  ];
  const themeCopy: Record<string, { nameKey: string; descriptionKey: string }> = {
    "emerald-noir": { nameKey: "settings.themeEmeraldNoirName", descriptionKey: "settings.themeEmeraldNoirDescription" },
    "cinema-ember": { nameKey: "settings.themeCinemaEmberName", descriptionKey: "settings.themeCinemaEmberDescription" },
    "velvet-crimson": { nameKey: "settings.themeVelvetCrimsonName", descriptionKey: "settings.themeVelvetCrimsonDescription" },
    "aurora-cyan": { nameKey: "settings.themeAuroraCyanName", descriptionKey: "settings.themeAuroraCyanDescription" },
  };

  const handleSendFeedback = useCallback(async () => {
    const trimmedMessage = feedbackMessage.trim();
    if (trimmedMessage.length < 10) {
      Alert.alert(t("settings.feedbackTooShortTitle"), t("settings.feedbackTooShortMessage"));
      return;
    }

    setIsSendingFeedback(true);
    try {
      await sendUserFeedback({
        message: trimmedMessage,
        language,
        themeId,
        profileName,
        profileLocation,
      });
      setFeedbackMessage("");
      Alert.alert(t("settings.feedbackSentTitle"), t("settings.feedbackSentMessage"));
    } catch (error) {
      Alert.alert(
        t("settings.feedbackFailedTitle"),
        error instanceof Error ? error.message : t("settings.feedbackFailedMessage")
      );
    } finally {
      setIsSendingFeedback(false);
    }
  }, [feedbackMessage, language, profileLocation, profileName, t, themeId]);

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>{t("settings.title")}</ScreenTitle>
      </HeaderRow>

      <Content>
        <IntroCard>
          <IntroTitle>{t("settings.pageLeadTitle")}</IntroTitle>
          <IntroText>{t("settings.pageLeadDescription")}</IntroText>
        </IntroCard>

        <Section>
          <SectionTitle>{t("settings.languageTitle")}</SectionTitle>
          <SectionText>{t("settings.languageDescription")}</SectionText>
          <ThemeGrid>
            {languageOptions.map((option) => (
              <ThemeCard
                key={option.id}
                $selected={language === option.id}
                $primary={currentTheme.colors.primary}
                onPress={() => {
                  void setLanguage(option.id);
                }}
              >
                <ThemePreviewRow>
                  <ThemeMeta>
                    <ThemeName>{t(option.labelKey)}</ThemeName>
                    <ThemeDescription>{t(option.descriptionKey)}</ThemeDescription>
                  </ThemeMeta>
                  <SwatchRow>
                    {language === option.id ? (
                      <Feather name="check" size={16} color={currentTheme.colors.primary} />
                    ) : null}
                  </SwatchRow>
                </ThemePreviewRow>
              </ThemeCard>
            ))}
          </ThemeGrid>
        </Section>

        <Section>
          <SectionTitle>{t("settings.appThemeTitle")}</SectionTitle>
          <SectionText>{t("settings.appThemeDescription")}</SectionText>
          <ThemePaletteRow>
            {THEME_OPTIONS.map((option) => (
              <ThemeSwatchButton
                key={option.id}
                onPress={() => {
                  void setThemeId(option.id);
                }}
              >
                <ThemeSwatchCircle $color={option.primary} $selected={themeId === option.id}>
                  {themeId === option.id ? (
                    <Feather name="check" size={16} color="#FFFFFF" />
                  ) : null}
                </ThemeSwatchCircle>
                <ThemeSwatchLabel $selected={themeId === option.id}>
                  {themeCopy[option.id] ? t(themeCopy[option.id].nameKey) : option.name}
                </ThemeSwatchLabel>
              </ThemeSwatchButton>
            ))}
          </ThemePaletteRow>
        </Section>

        <Section>
          <SectionTitle>{t("settings.backupTitle")}</SectionTitle>
          <SectionText>{t("settings.backupDescription")}</SectionText>
          <Card>
            <Label>{t("settings.dataPortability")}</Label>
            <BackupActions>
              <BackupButton
                $primary={true}
                $disabled={isExporting || isImporting}
                onPress={() => {
                  void handleExportBackup();
                }}
              >
                <Feather
                  name="upload"
                  size={16}
                  color={isExporting || isImporting ? currentTheme.colors.textSecondary : currentTheme.colors.primary}
                />
                <BackupButtonLabel $primary={true} $disabled={isExporting || isImporting}>
                  {isExporting ? t("settings.preparingBackup") : t("settings.exportAllData")}
                </BackupButtonLabel>
              </BackupButton>

              <BackupButton
                $primary={false}
                $disabled={isExporting || isImporting}
                onPress={handleImportBackup}
              >
                <Feather
                  name="download"
                  size={16}
                  color={isExporting || isImporting ? currentTheme.colors.textSecondary : currentTheme.colors.textPrimary}
                />
                <BackupButtonLabel $primary={false} $disabled={isExporting || isImporting}>
                  {isImporting ? t("settings.importingBackup") : t("settings.importBackup")}
                </BackupButtonLabel>
              </BackupButton>
            </BackupActions>
            <BackupMeta>{t("settings.importReplacesData")}</BackupMeta>
            {backupStatus ? <BackupStatus>{backupStatus}</BackupStatus> : null}
          </Card>
        </Section>

        <Section>
          <SectionTitle>{t("settings.feedbackTitle")}</SectionTitle>
          <SectionText>{t("settings.feedbackDescription")}</SectionText>
          <Card>
            <Label>{t("settings.feedbackLabel")}</Label>
            <FeedbackInput
              value={feedbackMessage}
              onChangeText={setFeedbackMessage}
              placeholder={t("settings.feedbackPlaceholder")}
              multiline
              maxLength={2000}
            />
            <CharacterCount>{feedbackMessage.length}/2000</CharacterCount>
            <BackupActions>
              <BackupButton
                $primary={true}
                $disabled={isSendingFeedback || feedbackMessage.trim().length < 10 || !user?.email}
                onPress={() => {
                  void handleSendFeedback();
                }}
              >
                <Feather
                  name="send"
                  size={16}
                  color={
                    isSendingFeedback || feedbackMessage.trim().length < 10 || !user?.email
                      ? currentTheme.colors.textSecondary
                      : currentTheme.colors.primary
                  }
                />
                <BackupButtonLabel
                  $primary={true}
                  $disabled={isSendingFeedback || feedbackMessage.trim().length < 10 || !user?.email}
                >
                  {isSendingFeedback ? t("settings.sendingFeedback") : t("settings.sendFeedback")}
                </BackupButtonLabel>
              </BackupButton>
            </BackupActions>
          </Card>
        </Section>

        <Section>
          <SectionTitle>{t("settings.accountTitle")}</SectionTitle>
          <SectionText>{t("settings.accountDescription")}</SectionText>
          <Card>
            <LogoutButton
              onPress={() => setShowSignOutConfirm(true)}
            >
              <Feather name="log-out" size={16} color="#E50914" />
              <LogoutLabel>{t("settings.signOut")}</LogoutLabel>
            </LogoutButton>
          </Card>
        </Section>

        <BottomSpacer />
      </Content>

      <Modal visible={signingOut} transparent animationType="fade" statusBarTranslucent>
        <SignOutOverlay entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
          <SignOutContent entering={FadeInDown.duration(400)}>
            <ActivityIndicator size="large" color={currentTheme.colors.primary} />
            <SignOutTitle>{t("settings.signingOut")}</SignOutTitle>
          </SignOutContent>
        </SignOutOverlay>
      </Modal>

      <Modal visible={showSignOutConfirm} transparent animationType="none" statusBarTranslucent>
        <ConfirmModalOverlay entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
          <ConfirmModalBlur intensity={70} tint="dark" />
          <ConfirmModalContent entering={FadeInDown.duration(300)}>
            <Feather name="log-out" size={32} color={currentTheme.colors.primary} style={{ marginBottom: 20 }} />
            <ConfirmTitle>{t("settings.signOutConfirmTitle")}</ConfirmTitle>
            <ConfirmSub>{t("settings.signOutConfirmMessage")}</ConfirmSub>
            
            <ConfirmActions>
              <ConfirmButton 
                $primary 
                onPress={async () => {
                  setShowSignOutConfirm(false);
                  setSigningOut(true);
                  try {
                    await signOut();
                  } catch {
                    setSigningOut(false);
                  }
                }}
              >
                <ConfirmButtonLabel $primary>{t("settings.signOut")}</ConfirmButtonLabel>
              </ConfirmButton>
              
              <ConfirmButton onPress={() => setShowSignOutConfirm(false)}>
                <ConfirmButtonLabel>{t("common.cancel")}</ConfirmButtonLabel>
              </ConfirmButton>
            </ConfirmActions>
          </ConfirmModalContent>
        </ConfirmModalOverlay>
      </Modal>
    </SafeContainer>
  );
}

