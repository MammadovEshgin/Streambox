import { Feather } from "@expo/vector-icons";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Modal } from "react-native";
import styled from "styled-components/native";

import { getPublicProfile, getWatchInvite, respondWatchInvite, type WatchInvite } from "../../api/social";
import { getTmdbImageUrl } from "../../api/tmdb";
import { userInboxService } from "../../services/userInboxService";
import { inviteStatusAtTime, inviteRemainingSeconds } from "../../utils/watchInvites";
import { SocialAvatar } from "./SocialAvatar";

// Recipient-side incoming-invite popup, mounted at app root (sibling of the
// NavigationContainer, gated on the splash like LiveOpsHost). Shows the newest
// pending invite over whatever screen the user is on; Accept routes into the
// room via the passed navigation ref. Self-dismisses on expiry (reducer clock)
// and polls the invite row every 5s so a dead socket can't leave it hanging.

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.82);
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Card = styled.View`
  width: 100%;
  max-width: 380px;
  border-radius: 20px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const Backdrop = styled.View`
  width: 100%;
  height: 150px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const Body = styled.View`
  padding: 16px 18px 18px;
`;

const SenderRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const SenderName = styled.Text`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
`;

const Eyebrow = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_700Bold;
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
`;

const Title = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 20px;
  letter-spacing: -0.3px;
`;

const Sub = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
  line-height: 20px;
`;

const Countdown = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_500Medium;
  font-size: 13px;
`;

const Actions = styled.View`
  flex-direction: row;
  gap: 10px;
  margin-top: 16px;
`;

const ActionButton = styled.Pressable<{ $primary?: boolean }>`
  flex: 1;
  min-height: 46px;
  border-radius: 12px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : "transparent")};
`;

const ActionLabel = styled.Text<{ $primary?: boolean }>`
  color: ${({ $primary, theme }) => ($primary ? theme.colors.textOnPrimary : theme.colors.textPrimary)};
  font-family: Outfit_700Bold;
  font-size: 14px;
`;

type Props = {
  enabled: boolean;
  // Loosely typed: the popup lives outside the NavigationContainer and routes
  // via the container ref (same nested path as the streambox://room/<code> link).
  navigationRef: NavigationContainerRefWithCurrent<any>;
};

type SenderInfo = {
  displayName: string;
  username: string | null;
  avatarPath: string | null;
  avatarVersion: number;
};

export function InviteHost({ enabled, navigationRef }: Props) {
  const { t } = useTranslation();
  const [invite, setInvite] = useState<WatchInvite | null>(null);
  const [sender, setSender] = useState<SenderInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const inviteRef = useRef<WatchInvite | null>(null);
  inviteRef.current = invite;

  // Incoming invites (+ updates that cancel/expire the shown one). The
  // watch_invites row carries no sender identity (that lives only in the
  // notification payload), so resolve the sender's public profile for the
  // name + avatar — otherwise the popup reads "Someone".
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = userInboxService.addListener({
      onInviteIncoming: (incoming) => {
        // Newest pending invite wins the popup.
        setInvite(incoming);
        setSender(null);
        setNow(Date.now());
        void getPublicProfile(incoming.fromUser)
          .then((profile) => {
            if (!profile || inviteRef.current?.id !== incoming.id) return;
            setSender({
              displayName: profile.displayName,
              username: profile.username,
              avatarPath: profile.avatarPath,
              avatarVersion: profile.avatarVersion,
            });
          })
          .catch(() => undefined);
      },
      onInviteUpdate: (updated) => {
        if (inviteRef.current && updated.id === inviteRef.current.id && updated.status !== "pending") {
          setInvite(null);
        }
      },
    });
    return unsubscribe;
  }, [enabled]);

  // 1s countdown tick + expiry dismissal.
  useEffect(() => {
    if (!invite) return;
    const timer = setInterval(() => {
      const t2 = Date.now();
      setNow(t2);
      const state = { status: invite.status, expiresAt: Date.parse(invite.expiresAt) };
      if (inviteStatusAtTime(state, t2) !== "pending") {
        setInvite(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [invite]);

  // 5s poll floor — a dead socket must never leave the popup hanging.
  useEffect(() => {
    if (!invite) return;
    const timer = setInterval(() => {
      void getWatchInvite(invite.id)
        .then((fresh) => {
          if (fresh && fresh.status !== "pending") setInvite(null);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [invite]);

  const dismiss = useCallback(() => setInvite(null), []);

  const handleAccept = useCallback(async () => {
    if (!invite || busy) return;
    setBusy(true);
    try {
      const result = await respondWatchInvite(invite.id, true);
      setInvite(null);
      // Route into the room's join sheet (same path as the deep link).
      navigationRef.navigate("Discover", {
        screen: "WatchRoomSetup",
        params: { mode: "join", code: result.roomCode },
      } as never);
    } catch {
      // Cancelled/expired before we answered — just close.
      setInvite(null);
    } finally {
      setBusy(false);
    }
  }, [busy, invite, navigationRef]);

  const handleDecline = useCallback(async () => {
    if (!invite || busy) return;
    setBusy(true);
    try {
      await respondWatchInvite(invite.id, false);
    } catch {
      // ignore
    } finally {
      setInvite(null);
      setBusy(false);
    }
  }, [busy, invite]);

  if (!enabled || !invite) return null;

  const state = { status: invite.status, expiresAt: Date.parse(invite.expiresAt) };
  const secondsLeft = inviteRemainingSeconds(state, now);
  const backdropUri = getTmdbImageUrl(invite.backdropPath ?? invite.posterPath, "w780");
  const name = sender?.displayName || (sender?.username ? `@${sender.username}` : t("social.someone"));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <Overlay>
        <Card>
          <Backdrop>
            {backdropUri ? (
              <Image source={{ uri: backdropUri }} style={{ width: "100%", height: 150 }} resizeMode="cover" />
            ) : null}
          </Backdrop>
          <Body>
            <Eyebrow>{t("social.inviteIncomingTitle")}</Eyebrow>
            <SenderRow>
              <SocialAvatar
                avatarPath={sender?.avatarPath ?? null}
                avatarVersion={sender?.avatarVersion ?? 0}
                displayName={name}
                size={36}
              />
              <SenderName numberOfLines={1}>{name}</SenderName>
            </SenderRow>
            <Title numberOfLines={2}>
              {invite.title}
              {invite.year ? ` (${invite.year})` : ""}
            </Title>
            <Sub numberOfLines={2}>{t("social.inviteWantsToWatch", { name })}</Sub>
            <Countdown>{t("social.inviteExpiresIn", { seconds: secondsLeft })}</Countdown>
            <Actions>
              <ActionButton onPress={handleDecline} disabled={busy}>
                <ActionLabel>{t("social.decline")}</ActionLabel>
              </ActionButton>
              <ActionButton $primary onPress={handleAccept} disabled={busy}>
                <Feather name="play" size={14} color="#fff" style={{ marginRight: 6 }} />
                <ActionLabel $primary>{t("social.accept")}</ActionLabel>
              </ActionButton>
            </Actions>
          </Body>
        </Card>
      </Overlay>
    </Modal>
  );
}
