import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Modal } from "react-native";
import styled from "styled-components/native";

import {
  cancelWatchInvite,
  getMutualFollows,
  getWatchInvite,
  sendWatchInvite,
  type UserSummary,
  type WatchInvite,
} from "../../api/social";
import { getTmdbImageUrl } from "../../api/tmdb";
import { userInboxService } from "../../services/userInboxService";
import type { WatchRoom, WatchRoomMedia } from "../../utils/watchRoom";
import { inviteRemainingSeconds, inviteStatusAtTime } from "../../utils/watchInvites";
import { SocialAvatar } from "./SocialAvatar";

// Sender-side "Invite a friend" section for the Watch Together setup screen.
// Lists mutual follows; tapping one creates the room (host) + sends the invite,
// then shows a waiting overlay that resolves on accept (→ into the player),
// decline, cancel, or expiry.

const Section = styled.View`
  margin-top: 26px;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

const SectionSub = styled.Text`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
`;

const FriendRow = styled.Pressable`
  flex-direction: row;
  align-items: center;
  padding: 10px 2px;
`;

const FriendBody = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const FriendName = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
`;

const FriendHandle = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
`;

const InvitePill = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primary};
`;

const InvitePillText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_700Bold;
  font-size: 12px;
`;

const EmptyNote = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 18px;
`;

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.85);
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const WaitCard = styled.View`
  width: 100%;
  max-width: 360px;
  border-radius: 20px;
  padding: 22px;
  align-items: center;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const WaitPoster = styled.View`
  width: 110px;
  height: 165px;
  border-radius: 12px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  margin-bottom: 16px;
`;

const WaitTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 18px;
  text-align: center;
`;

const WaitSub = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  text-align: center;
`;

const WaitCountdown = styled.Text`
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
`;

const OverlayButton = styled.Pressable`
  margin-top: 18px;
  min-height: 44px;
  padding: 0 22px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const OverlayButtonText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 14px;
`;

type Phase = "idle" | "sending" | "waiting" | "declined" | "expired" | "cancelled";

type Props = {
  media: WatchRoomMedia;
  canInvite: boolean;
  createRoom: () => Promise<WatchRoom>;
  onEnterRoom: (roomCode: string) => void;
};

export function WatchInviteSection({ media, canInvite, createRoom, onEnterRoom }: Props) {
  const { t } = useTranslation();
  const [mutuals, setMutuals] = useState<UserSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [invite, setInvite] = useState<WatchInvite | null>(null);
  const [friendName, setFriendName] = useState("");
  const [now, setNow] = useState(Date.now());
  const inviteRef = useRef<WatchInvite | null>(null);
  inviteRef.current = invite;
  // Reuse the room across retries so declining/cancelling and inviting again
  // (or inviting a different mutual) doesn't orphan a fresh room each time.
  const roomRef = useRef<WatchRoom | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMutualFollows()
      .then((rows) => {
        if (!cancelled) setMutuals(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Watch the invite we sent for accept/decline (sender sees from_user UPDATEs).
  useEffect(() => {
    if (phase !== "waiting") return;
    const unsubscribe = userInboxService.addListener({
      onInviteUpdate: (updated) => {
        if (!inviteRef.current || updated.id !== inviteRef.current.id) return;
        if (updated.status === "accepted") {
          setPhase("idle");
          onEnterRoom(updated.roomCode);
        } else if (updated.status === "declined") {
          setPhase("declined");
        } else if (updated.status === "cancelled") {
          setPhase("cancelled");
        } else if (updated.status === "expired") {
          setPhase("expired");
        }
      },
    });
    return unsubscribe;
  }, [phase, onEnterRoom]);

  // Countdown + expiry, and a 5s poll floor against a dead socket.
  useEffect(() => {
    if (phase !== "waiting" || !invite) return;
    const tick = setInterval(() => {
      const t2 = Date.now();
      setNow(t2);
      const state = { status: invite.status, expiresAt: Date.parse(invite.expiresAt) };
      if (inviteStatusAtTime(state, t2) !== "pending") setPhase("expired");
    }, 1000);
    const poll = setInterval(() => {
      void getWatchInvite(invite.id)
        .then((fresh) => {
          if (!fresh || fresh.status === "pending") return;
          if (fresh.status === "accepted") {
            setPhase("idle");
            onEnterRoom(fresh.roomCode);
          } else {
            setPhase(fresh.status as Phase);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [phase, invite, onEnterRoom]);

  const handleInvite = useCallback(
    async (friend: UserSummary) => {
      if (!canInvite || phase === "sending" || phase === "waiting") return;
      setFriendName(friend.displayName);
      setPhase("sending");
      try {
        const room = roomRef.current ?? (await createRoom());
        roomRef.current = room;
        const sent = await sendWatchInvite({
          toUser: friend.userId,
          roomCode: room.code,
          mediaType: media.mediaType,
          tmdbId: media.tmdbId,
          title: media.title,
          posterPath: media.posterPath ?? null,
          backdropPath: media.backdropPath ?? null,
          year: media.year ?? null,
          imdbId: media.imdbId ?? null,
        });
        setInvite(sent);
        setNow(Date.now());
        setPhase("waiting");
      } catch {
        // A reused room may have expired (membership check fails) — drop it so
        // the next attempt provisions a fresh one.
        roomRef.current = null;
        setPhase("idle");
      }
    },
    [canInvite, createRoom, media, phase]
  );

  const handleCancel = useCallback(async () => {
    const current = inviteRef.current;
    if (current) await cancelWatchInvite(current.id).catch(() => undefined);
    setPhase("idle");
    setInvite(null);
  }, []);

  const closeOverlay = useCallback(() => {
    setPhase("idle");
    setInvite(null);
  }, []);

  if (!loaded) return null;

  const posterUri = getTmdbImageUrl(media.posterPath ?? media.backdropPath ?? null, "w342");
  const secondsLeft =
    invite && phase === "waiting"
      ? inviteRemainingSeconds({ status: invite.status, expiresAt: Date.parse(invite.expiresAt) }, now)
      : 0;

  const overlayVisible = phase !== "idle";

  return (
    <Section>
      <SectionTitle>{t("social.inviteFriend")}</SectionTitle>
      <SectionSub>{t("social.inviteFriendSubtitle")}</SectionSub>

      {mutuals.length === 0 ? (
        <EmptyNote>{t("social.noMutualsBody")}</EmptyNote>
      ) : (
        mutuals.map((friend) => (
          <FriendRow key={friend.userId} onPress={() => handleInvite(friend)} disabled={!canInvite}>
            <SocialAvatar
              avatarPath={friend.avatarPath}
              avatarVersion={friend.avatarVersion}
              displayName={friend.displayName}
              size={40}
            />
            <FriendBody>
              <FriendName numberOfLines={1}>{friend.displayName}</FriendName>
              {friend.username ? <FriendHandle numberOfLines={1}>@{friend.username}</FriendHandle> : null}
            </FriendBody>
            <InvitePill>
              <Feather name="send" size={12} color="#fff" />
              <InvitePillText>{t("social.invite")}</InvitePillText>
            </InvitePill>
          </FriendRow>
        ))
      )}

      <Modal visible={overlayVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={closeOverlay}>
        <Overlay>
          <WaitCard>
            <WaitPoster>
              {posterUri ? (
                <Image source={{ uri: posterUri }} style={{ width: 110, height: 165 }} resizeMode="cover" />
              ) : null}
            </WaitPoster>

            {phase === "sending" || phase === "waiting" ? (
              <>
                <WaitTitle numberOfLines={2}>{t("social.waitingForResponse", { name: friendName })}</WaitTitle>
                <ActivityIndicator style={{ marginTop: 14 }} />
                {phase === "waiting" ? (
                  <WaitCountdown>{t("social.inviteExpiresIn", { seconds: secondsLeft })}</WaitCountdown>
                ) : null}
                <OverlayButton onPress={handleCancel}>
                  <OverlayButtonText>{t("social.cancelInvite")}</OverlayButtonText>
                </OverlayButton>
              </>
            ) : (
              <>
                <WaitTitle numberOfLines={2}>
                  {phase === "declined"
                    ? t("social.inviteDeclined", { name: friendName })
                    : phase === "cancelled"
                      ? t("social.inviteCancelled")
                      : t("social.inviteExpired")}
                </WaitTitle>
                <WaitSub>{t("social.inviteFriendSubtitle")}</WaitSub>
                <OverlayButton onPress={closeOverlay}>
                  <OverlayButtonText>{t("social.retry")}</OverlayButtonText>
                </OverlayButton>
              </>
            )}
          </WaitCard>
        </Overlay>
      </Modal>
    </Section>
  );
}
