import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Image,
  InteractionManager,
  Linking,
  Modal,
  Pressable,
} from "react-native";
import { useTranslation } from "react-i18next";
import styled from "styled-components/native";

import { useAuth } from "../../context/AuthContext";
import { useAppSettings } from "../../settings/AppSettingsContext";
import { applyFetchedAppUpdate, checkForPendingAppUpdate } from "../../services/appUpdateService";
import {
  fetchNextLiveAnnouncement,
  markLiveAnnouncementSeen,
  type LiveAnnouncement,
} from "../../services/announcementsService";

const LIVE_OPS_BOOT_DELAY_MS = 1400;

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(2, 6, 6, 0.62);
  justify-content: flex-end;
  padding: 20px;
`;

const CardShell = styled.View`
  border-radius: 28px;
  overflow: hidden;
  background-color: rgba(10, 11, 12, 0.94);
`;

const Card = styled.View`
  background-color: rgba(10, 11, 12, 0.94);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  border-radius: 28px;
  padding: 22px;
`;

const Accent = styled.View<{ $accent: string }>`
  position: absolute;
  top: -42px;
  right: -28px;
  width: 124px;
  height: 124px;
  border-radius: 62px;
  background-color: ${({ $accent }) => $accent};
  opacity: 0.18;
`;

const Eyebrow = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
`;

const Title = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 24px;
  line-height: 30px;
  letter-spacing: -0.5px;
`;

const Body = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 15px;
  line-height: 23px;
`;

const HeroImage = styled(Image)`
  width: 100%;
  height: 152px;
  border-radius: 20px;
  margin-top: 18px;
`;

const ActionRow = styled.View`
  flex-direction: row;
  gap: 12px;
  margin-top: 22px;
`;

const SecondaryButton = styled(Pressable)`
  flex: 1;
  min-height: 50px;
  border-radius: 16px;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.1);
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.02);
`;

const SecondaryButtonLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 15px;
`;

const PrimaryButton = styled(Pressable)`
  flex: 1.35;
  min-height: 50px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const PrimaryButtonLabel = styled.Text`
  color: #031106;
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

type LiveOpsHostProps = {
  enabled: boolean;
};

async function openAnnouncementUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      return;
    }

    if (url.startsWith("http://") || url.startsWith("https://")) {
      await WebBrowser.openBrowserAsync(url);
      return;
    }

    await Linking.openURL(url);
  } catch (error) {
    console.warn("Announcement CTA open failed:", error);
  }
}

export function LiveOpsHost({ enabled }: LiveOpsHostProps) {
  const { language } = useAppSettings();
  const { session } = useAuth();
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState<LiveAnnouncement | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const bootTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appVersion = useMemo(
    () => String(Constants.expoConfig?.version ?? "1.0.0"),
    []
  );
  const hasAnnouncementCta = Boolean(announcement?.ctaUrl);

  const runLiveOpsRefresh = useCallback(async () => {
    if (!enabled || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      const [nextAnnouncement, pendingUpdate] = await Promise.all([
        fetchNextLiveAnnouncement({
          language,
          appVersion,
          userId: session?.user.id ?? null,
        }),
        checkForPendingAppUpdate(),
      ]);

      if (!mountedRef.current) {
        return;
      }

      if (nextAnnouncement) {
        setAnnouncement((current) => current ?? nextAnnouncement);
      }

      if (pendingUpdate) {
        setUpdateReady(true);
      }
    } catch (error) {
      console.warn("Live ops refresh failed:", error);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [appVersion, enabled, language, session?.user.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    bootTimerRef.current = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        void runLiveOpsRefresh();
      });
    }, LIVE_OPS_BOOT_DELAY_MS);

    return () => {
      if (bootTimerRef.current) {
        clearTimeout(bootTimerRef.current);
      }
    };
  }, [enabled, runLiveOpsRefresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void runLiveOpsRefresh();
      }
    });

    return () => subscription.remove();
  }, [enabled, runLiveOpsRefresh]);

  const dismissAnnouncement = useCallback(async (target: LiveAnnouncement) => {
    await markLiveAnnouncementSeen({
      announcement: target,
      userId: session?.user.id ?? null,
    });
    setAnnouncement((current) => (current?.seenKey === target.seenKey ? null : current));
  }, [session?.user.id]);

  const handleAnnouncementPrimary = useCallback(async () => {
    if (!announcement) {
      return;
    }

    const url = announcement.ctaUrl;
    await dismissAnnouncement(announcement);
    if (url) {
      await openAnnouncementUrl(url);
    }
  }, [announcement, dismissAnnouncement]);

  const handleRestartLater = useCallback(() => {
    setUpdateReady(false);
  }, []);

  const handleRestartNow = useCallback(async () => {
    try {
      await applyFetchedAppUpdate();
    } catch (error) {
      console.warn("Failed to apply fetched update:", error);
    }
  }, []);

  return (
    <>
      {announcement ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => void dismissAnnouncement(announcement)}>
          <Overlay>
            <CardShell>
              <Card>
                <Accent $accent={announcement.accentHex ?? "rgba(34, 197, 94, 0.9)"} />
                {announcement.eyebrow ? <Eyebrow>{announcement.eyebrow}</Eyebrow> : null}
                <Title>{announcement.title}</Title>
                <Body>{announcement.body}</Body>
                {announcement.imageUrl ? <HeroImage source={{ uri: announcement.imageUrl }} resizeMode="cover" /> : null}
                <ActionRow>
                  {hasAnnouncementCta ? (
                    <>
                      <SecondaryButton onPress={() => void dismissAnnouncement(announcement)}>
                        <SecondaryButtonLabel>{t("liveOps.gotIt")}</SecondaryButtonLabel>
                      </SecondaryButton>
                      <PrimaryButton onPress={() => void handleAnnouncementPrimary()}>
                        <PrimaryButtonLabel>{announcement.ctaLabel ?? t("liveOps.learnMore")}</PrimaryButtonLabel>
                      </PrimaryButton>
                    </>
                  ) : (
                    <PrimaryButton onPress={() => void handleAnnouncementPrimary()}>
                      <PrimaryButtonLabel>{t("liveOps.gotIt")}</PrimaryButtonLabel>
                    </PrimaryButton>
                  )}
                </ActionRow>
              </Card>
            </CardShell>
          </Overlay>
        </Modal>
      ) : null}

      {!announcement && updateReady ? (
        <Modal visible transparent animationType="fade" onRequestClose={handleRestartLater}>
          <Overlay>
            <CardShell>
              <Card>
                <Accent $accent="rgba(34, 197, 94, 0.85)" />
                <Eyebrow>{t("liveOps.updateEyebrow")}</Eyebrow>
                <Title>{t("liveOps.updateTitle")}</Title>
                <Body>{t("liveOps.updateBody")}</Body>
                <ActionRow>
                  <SecondaryButton onPress={handleRestartLater}>
                    <SecondaryButtonLabel>{t("liveOps.updateLater")}</SecondaryButtonLabel>
                  </SecondaryButton>
                  <PrimaryButton onPress={() => void handleRestartNow()}>
                    <PrimaryButtonLabel>{t("liveOps.updateRestartNow")}</PrimaryButtonLabel>
                  </PrimaryButton>
                </ActionRow>
              </Card>
            </CardShell>
          </Overlay>
        </Modal>
      ) : null}
    </>
  );
}
