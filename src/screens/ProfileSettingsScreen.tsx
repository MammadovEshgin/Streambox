import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, TextInput } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeOut, FadeIn } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { SafeContainer } from "../components/common/SafeContainer";
import { useAuth } from "../context/AuthContext";
import { sendUserFeedback } from "../services/feedbackService";
import {
  importLetterboxdArchive,
  type LetterboxdImportProgress,
} from "../services/letterboxdImportService";
import type { ProfileStackParamList } from "../navigation/types";
import { useAppSettings } from "../settings/AppSettingsContext";
import { THEME_OPTIONS, withAlpha } from "../theme/Theme";
import type { AppLanguage } from "../localization/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "ProfileSettings">;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 10px 16px 8px;
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
  padding: 16px 16px 18px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.primary, 0.16)};
  background-color: ${({ theme }) => theme.colors.surfaceHigh};
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
  margin: 24px 16px 0;
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
  margin-top: 14px;
  padding: 16px;
  border-radius: 10px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.borderSoft};
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
  margin-top: 14px;
  gap: 10px;
`;

const ThemePaletteRow = styled.View`
  margin-top: 16px;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  row-gap: 16px;
`;

const ThemeSwatchButton = styled.Pressable`
  width: 23%;
  align-items: center;
  padding-vertical: 2px;
`;

const ThemeSwatchCircle = styled.View<{ $color: string; $selected: boolean }>`
  width: 54px;
  height: 54px;
  border-radius: 12px;
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
  min-height: 66px;
  padding: 13px 14px;
  border-radius: 10px;
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
  margin-top: 16px;
  gap: 10px;
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
  border-radius: 10px;
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
  border-radius: 10px;
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
  border-radius: 14px;
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
  border-radius: 10px;
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
    notifyStorageChanged,
  } = useAppSettings();
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<LetterboxdImportProgress | null>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const handleImportLetterboxd = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "multipart/x-zip", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) {
        return;
      }
      const fileUri = picked.assets?.[0]?.uri;
      if (!fileUri) {
        return;
      }

      setImportNote(null);
      setImportProgress({ phase: "reading", completed: 0, total: 0 });
      setIsImporting(true);

      const result = await importLetterboxdArchive(fileUri, setImportProgress);

      if (result.totalFilms === 0) {
        Alert.alert(t("settings.letterboxdImportFailed"), t("settings.letterboxdInvalidArchive"));
        return;
      }

      // Refresh every hook reading the media stores so the new watched/
      // watchlist/liked data shows up immediately across the app.
      notifyStorageChanged();

      const lines = [
        t("settings.letterboxdCompleteMessage", {
          watched: result.watchedAdded,
          watchlist: result.watchlistAdded,
          liked: result.likedAdded,
        }),
      ];
      if (result.unmatched.length > 0) {
        lines.push(t("settings.letterboxdUnmatchedNote", { count: result.unmatched.length }));
      }
      if (!result.syncedToCloud) {
        lines.push(t("settings.letterboxdOfflineNote"));
      }
      const summary = lines.join("\n");
      setImportNote(summary);
      Alert.alert(t("settings.letterboxdCompleteTitle"), summary);
    } catch (error) {
      Alert.alert(
        t("settings.letterboxdImportFailed"),
        error instanceof Error ? error.message : t("settings.letterboxdInvalidArchive")
      );
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  }, [notifyStorageChanged, t]);

  const languageOptions: Array<{ id: AppLanguage; labelKey: string; descriptionKey: string }> = [
    { id: "en", labelKey: "settings.enLabel", descriptionKey: "settings.enDescription" },
    { id: "tr", labelKey: "settings.trLabel", descriptionKey: "settings.trDescription" },
  ];
  const themeCopy: Record<string, { nameKey: string; descriptionKey: string }> = {
    "emerald-noir": { nameKey: "settings.themeEmeraldNoirName", descriptionKey: "settings.themeEmeraldNoirDescription" },
    "cinema-ember": { nameKey: "settings.themeCinemaEmberName", descriptionKey: "settings.themeCinemaEmberDescription" },
    "velvet-crimson": { nameKey: "settings.themeVelvetCrimsonName", descriptionKey: "settings.themeVelvetCrimsonDescription" },
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

  const importStatusLabel = (() => {
    if (!importProgress) return t("settings.letterboxdReading");
    switch (importProgress.phase) {
      case "matching":
        return t("settings.letterboxdMatching", {
          completed: importProgress.completed,
          total: importProgress.total,
        });
      case "details":
        return t("settings.letterboxdLoadingDetails", {
          completed: importProgress.completed,
          total: importProgress.total,
        });
      case "saving":
        return t("settings.letterboxdSaving");
      case "reading":
      default:
        return t("settings.letterboxdReading");
    }
  })();

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
          <SectionTitle>{t("settings.letterboxdTitle")}</SectionTitle>
          <SectionText>{t("settings.letterboxdDescription")}</SectionText>
          <Card>
            <Label>{t("settings.letterboxdLabel")}</Label>
            <BackupActions>
              <BackupButton
                $primary={true}
                $disabled={isImporting}
                onPress={() => {
                  void handleImportLetterboxd();
                }}
              >
                <Feather
                  name="download"
                  size={16}
                  color={isImporting ? currentTheme.colors.textSecondary : currentTheme.colors.primary}
                />
                <BackupButtonLabel $primary={true} $disabled={isImporting}>
                  {isImporting ? importStatusLabel : t("settings.letterboxdImport")}
                </BackupButtonLabel>
              </BackupButton>
            </BackupActions>
            <BackupMeta>{t("settings.letterboxdHint")}</BackupMeta>
            {importNote ? <BackupStatus>{importNote}</BackupStatus> : null}
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

      <Modal visible={isImporting} transparent animationType="fade" statusBarTranslucent>
        <SignOutOverlay entering={FadeIn.duration(250)} exiting={FadeOut.duration(200)}>
          <SignOutContent entering={FadeIn.duration(220)}>
            <ActivityIndicator size="large" color={currentTheme.colors.primary} />
            <SignOutTitle>{importStatusLabel}</SignOutTitle>
          </SignOutContent>
        </SignOutOverlay>
      </Modal>

      <Modal visible={signingOut} transparent animationType="fade" statusBarTranslucent>
        <SignOutOverlay entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
          <SignOutContent entering={FadeIn.duration(250)}>
            <ActivityIndicator size="large" color={currentTheme.colors.primary} />
            <SignOutTitle>{t("settings.signingOut")}</SignOutTitle>
          </SignOutContent>
        </SignOutOverlay>
      </Modal>

      <Modal visible={showSignOutConfirm} transparent animationType="none" statusBarTranslucent>
        <ConfirmModalOverlay entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
          <ConfirmModalBlur intensity={70} tint="dark" />
          <ConfirmModalContent entering={FadeIn.duration(220)}>
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

