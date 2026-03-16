import { Feather } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeInDown, FadeOut, FadeIn } from "react-native-reanimated";
import styled, { useTheme } from "styled-components/native";

import { SafeContainer } from "../components/common/SafeContainer";
import { useAuth } from "../context/AuthContext";
import type { ProfileStackParamList } from "../navigation/types";
import {
  exportStreamBoxBackupFile,
  importStreamBoxBackupFile,
  pickStreamBoxBackupFile,
} from "../services/backupService";
import { useAppSettings } from "../settings/AppSettingsContext";
import { THEME_OPTIONS, withAlpha } from "../theme/Theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "ProfileSettings">;

const HeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px 6px;
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
  keyboardShouldPersistTaps: "handled"
})`
  flex: 1;
`;

const Section = styled.View`
  margin-top: 18px;
  padding-horizontal: 16px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const SectionText = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  line-height: 19px;
`;

const Card = styled.View`
  margin-top: 12px;
  padding: 16px;
  border-radius: 16px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const Label = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
`;

const ThemeGrid = styled.View`
  margin-top: 12px;
  gap: 10px;
`;

const ThemeCard = styled.Pressable<{ $selected: boolean; $primary: string }>`
  padding: 14px;
  border-radius: 14px;
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
`;

const ThemeDescription = styled.Text`
  margin-top: 4px;
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
  margin-top: 14px;
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
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  line-height: 18px;
`;

const BackupStatus = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  line-height: 17px;
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
  height: 32px;
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
  const { signOut } = useAuth();
  const {
    themeId,
    setThemeId,
    reloadPersistedSettings,
  } = useAppSettings();
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  const handleExportBackup = useCallback(async () => {
    setBackupStatus(null);
    setIsExporting(true);

    try {
      const { fileUri } = await exportStreamBoxBackupFile();
      const isSharingAvailable = await Sharing.isAvailableAsync();

      if (!isSharingAvailable) {
        throw new Error("Sharing is not available on this device.");
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: "Export StreamBox backup",
        UTI: "public.json",
      });

      setBackupStatus("backup file is ready to save or send to your new phone");
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "StreamBox could not create a backup file."
      );
    } finally {
      setIsExporting(false);
    }
  }, []);

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
      setBackupStatus("backup imported and all saved data has been restored");
      Alert.alert("Import complete", "Your StreamBox data and settings have been restored on this phone.");
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "StreamBox could not restore that backup file."
      );
    } finally {
      setIsImporting(false);
    }
  }, [reloadPersistedSettings]);

  const handleImportBackup = useCallback(() => {
    Alert.alert(
      "Import backup",
      "This will replace the current StreamBox data on this phone with the selected backup.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Import",
          style: "destructive",
          onPress: () => {
            void runImportBackup();
          },
        },
      ]
    );
  }, [runImportBackup]);

  return (
    <SafeContainer>
      <HeaderRow>
        <BackButton onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color={currentTheme.colors.textPrimary} />
        </BackButton>
        <ScreenTitle>Settings</ScreenTitle>
      </HeaderRow>

      <Content>
        <Section>
          <SectionTitle>App Theme</SectionTitle>
          <SectionText>Choose the accent that drives tabs, buttons, toggles, loaders, and the global app look.</SectionText>
          <ThemeGrid>
            {THEME_OPTIONS.map((option) => (
              <ThemeCard
                key={option.id}
                $selected={themeId === option.id}
                $primary={option.primary}
                onPress={() => {
                  void setThemeId(option.id);
                }}
              >
                <ThemePreviewRow>
                  <ThemeMeta>
                    <ThemeName>{option.name}</ThemeName>
                    <ThemeDescription>{option.description}</ThemeDescription>
                  </ThemeMeta>
                  <SwatchRow>
                    <Swatch $color={option.primary} />
                    {themeId === option.id ? (
                      <Feather name="check" size={16} color={option.primary} />
                    ) : null}
                  </SwatchRow>
                </ThemePreviewRow>
              </ThemeCard>
            ))}
          </ThemeGrid>
        </Section>

        <Section>
          <SectionTitle>Backup & Transfer</SectionTitle>
          <SectionText>Export one StreamBox backup file, move it to another phone, then import it to restore your profile, theme, likes, watchlists, and history.</SectionText>
          <Card>
            <Label>Data Portability</Label>
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
                  {isExporting ? "Preparing backup..." : "Export all data"}
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
                  {isImporting ? "Importing backup..." : "Import backup"}
                </BackupButtonLabel>
              </BackupButton>
            </BackupActions>
            <BackupMeta>Import replaces the current phone data with the selected backup file.</BackupMeta>
            {backupStatus ? <BackupStatus>{backupStatus}</BackupStatus> : null}
          </Card>
        </Section>


        <Section>
          <SectionTitle>Account</SectionTitle>
          <SectionText>Sign out of your StreamBox account on this device.</SectionText>
          <Card>
            <LogoutButton
              onPress={() => setShowSignOutConfirm(true)}
            >
              <Feather name="log-out" size={16} color="#E50914" />
              <LogoutLabel>Sign Out</LogoutLabel>
            </LogoutButton>
          </Card>
        </Section>

        <BottomSpacer />
      </Content>

      <Modal visible={signingOut} transparent animationType="fade" statusBarTranslucent>
        <SignOutOverlay entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
          <SignOutContent entering={FadeInDown.duration(400)}>
            <ActivityIndicator size="large" color={currentTheme.colors.primary} />
            <SignOutTitle>Signing you out...</SignOutTitle>
          </SignOutContent>
        </SignOutOverlay>
      </Modal>

      <Modal visible={showSignOutConfirm} transparent animationType="none" statusBarTranslucent>
        <ConfirmModalOverlay entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
          <ConfirmModalBlur intensity={70} tint="dark" />
          <ConfirmModalContent entering={FadeInDown.duration(300)}>
            <Feather name="log-out" size={32} color={currentTheme.colors.primary} style={{ marginBottom: 20 }} />
            <ConfirmTitle>Log out of StreamBox?</ConfirmTitle>
            <ConfirmSub>Are you sure you want to sign out? Your session will be ended.</ConfirmSub>
            
            <ConfirmActions>
              <ConfirmButton 
                $primary 
                onPress={() => {
                  setShowSignOutConfirm(false);
                  setSigningOut(true);
                  setTimeout(() => {
                    void signOut();
                  }, 800);
                }}
              >
                <ConfirmButtonLabel $primary>Sign Out</ConfirmButtonLabel>
              </ConfirmButton>
              
              <ConfirmButton onPress={() => setShowSignOutConfirm(false)}>
                <ConfirmButtonLabel>Cancel</ConfirmButtonLabel>
              </ConfirmButton>
            </ConfirmActions>
          </ConfirmModalContent>
        </ConfirmModalOverlay>
      </Modal>
    </SafeContainer>
  );
}

