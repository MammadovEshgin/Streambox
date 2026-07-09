import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import ViewShot from "react-native-view-shot";
import styled, { useTheme } from "styled-components/native";
import type { VideoPlayer } from "expo-video";

import { FaceCamOverlay } from "./FaceCamOverlay";
import { PolaroidCard } from "./PolaroidCard";
import { getMovieDetails, getSeriesDetails } from "../../api/tmdb";
import { useWatchRoomSession } from "../../hooks/useWatchRoomSession";
import { getWebRtc } from "../../services/webrtcCompat";
import {
  uploadCameraStill,
  uploadPolaroid,
  saveWatchMemory,
  cacheMemoryFromLocalUri,
} from "../../services/watchMemories";

const STILL_STREAM_STYLE = { width: "100%" as const, height: "100%" as const };
const REACTION_EMOJIS = ["😂", "❤️", "🔥", "😮"];
const PARTNER_STILL_TIMEOUT_MS = 5000;

const RAIL_WIDTH = 54;
const HANDLE_WIDTH = 22;

export type WatchRoomLayerProps = {
  player: VideoPlayer | null;
  code: string;
  nickname: string;
  onExit: () => void;
};

// A single emoji that floats up and fades, TikTok/IG-live style.
function FloatingReaction({ emoji }: { emoji: string }) {
  const progress = useSharedValue(0);
  const drift = useMemo(() => (Math.random() - 0.5) * 46, []);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) });
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateY: -progress.value * 150 },
      { translateX: drift * progress.value },
      { scale: 0.7 + 0.3 * progress.value },
    ],
  }));
  return <Reanimated.Text style={[{ fontSize: 22, position: "absolute", bottom: 0 }, style]}>{emoji}</Reanimated.Text>;
}

export function WatchRoomLayer({ player, code, nickname, onExit }: WatchRoomLayerProps) {
  const theme = useTheme();
  const session = useWatchRoomSession({ player, code, nickname });
  const RTCView = getWebRtc()?.RTCView;

  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const seenChatCountRef = useRef(0);

  // WhatsApp-style unread badge: count partner messages that land while the
  // chat sheet is closed; clear when it opens.
  useEffect(() => {
    if (chatOpen) {
      seenChatCountRef.current = session.chatMessages.length;
      setUnread(0);
      return;
    }
    const fresh = session.chatMessages.slice(seenChatCountRef.current).filter((m) => !m.mine).length;
    seenChatCountRef.current = session.chatMessages.length;
    if (fresh > 0) setUnread((count) => count + fresh);
  }, [session.chatMessages, chatOpen]);

  const selfStillShotRef = useRef<ViewShot>(null);
  const polaroidShotRef = useRef<ViewShot>(null);
  const authorRef = useRef(false);
  const [selfStillUri, setSelfStillUri] = useState<string | null>(null);
  const [polaroidPreview, setPolaroidPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [genres, setGenres] = useState<string[] | null>(null);

  const partnerNickname = session.partner?.nickname ?? null;

  // Pull the film's rating + genres for the polaroid log once we know the title.
  const roomId = session.room?.id;
  const roomTmdbId = session.room?.tmdbId;
  const roomMediaType = session.room?.mediaType;
  useEffect(() => {
    if (!roomId || !roomTmdbId || !roomMediaType) return;
    let active = true;
    void (async () => {
      try {
        const details =
          roomMediaType === "movie"
            ? await getMovieDetails(String(roomTmdbId))
            : await getSeriesDetails(String(roomTmdbId));
        if (active) {
          setRating(details.voteAverage ?? null);
          setGenres(details.genres ?? null);
        }
      } catch {
        /* rating/genres just stay empty */
      }
    })();
    return () => {
      active = false;
    };
  }, [roomId, roomTmdbId, roomMediaType]);

  // ── Right rail slide (swipe from the right edge reveals it) ──
  const railProgress = useSharedValue(0); // 0 hidden, 1 shown
  const railStart = useSharedValue(0);
  const pan = Gesture.Pan()
    .onBegin(() => {
      railStart.value = railProgress.value;
    })
    .onUpdate((event) => {
      const next = railStart.value - event.translationX / RAIL_WIDTH;
      railProgress.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((event) => {
      const open = railProgress.value > 0.5 || event.velocityX < -400;
      railProgress.value = withTiming(open ? 1 : 0, { duration: 180 });
    });
  // A plain tap on the handle toggles the rail (races with the drag gesture).
  const tap = Gesture.Tap().onEnd(() => {
    railProgress.value = withTiming(railProgress.value > 0.5 ? 0 : 1, { duration: 180 });
  });
  const railGesture = Gesture.Race(pan, tap);

  const railStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - railProgress.value) * RAIL_WIDTH }],
  }));

  // ── Polaroid capture ──
  const captureOwnStill = useCallback(async (): Promise<string | null> => {
    try {
      return await captureRef(selfStillShotRef, { format: "jpg", quality: 0.85 });
    } catch {
      return null;
    }
  }, []);

  const contributeStill = useCallback(async () => {
    const uri = await captureOwnStill();
    if (uri) setSelfStillUri(uri);
    if (uri && session.room) {
      const path = await uploadCameraStill(session.room.id, uri).catch(() => null);
      if (path) session.sendCaptureStill(nickname, path);
    }
  }, [captureOwnStill, nickname, session]);

  const initiateCapture = useCallback(() => {
    if (capturing) return;
    authorRef.current = true;
    setCapturing(true);
    session.requestCapture();
    void contributeStill();
  }, [capturing, contributeStill, session]);

  useEffect(() => {
    if (session.captureRequestedBy && !authorRef.current) {
      setCapturing(true);
      void contributeStill().finally(() => {
        setTimeout(() => setCapturing(false), 1500);
        session.clearCapture();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.captureRequestedBy]);

  useEffect(() => {
    if (!authorRef.current || polaroidPreview || !capturing) return;
    const build = async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        const uri = await captureRef(polaroidShotRef, { format: "png", quality: 1 });
        setPolaroidPreview(uri);
        if (session.room) {
          const path = await uploadPolaroid(session.room.id, uri).catch(() => null);
          if (path) {
            const memoryId = await saveWatchMemory({
              roomId: session.room.id,
              mediaType: session.room.mediaType,
              tmdbId: session.room.tmdbId,
              title: session.room.title,
              positionSeconds: player?.currentTime ?? 0,
              imagePath: path,
              participantNicknames: [nickname, partnerNickname].filter(Boolean) as string[],
              participantUserIds: session.members.map((member) => member.userId),
            }).catch(() => null);
            // Keep the author's own copy on-device immediately (the partner's
            // device caches it on first shelf load).
            if (memoryId) await cacheMemoryFromLocalUri(memoryId, uri).catch(() => undefined);
          }
        }
      } finally {
        authorRef.current = false;
        setCapturing(false);
      }
    };
    const timer = setTimeout(() => void build(), session.partnerStill ? 0 : PARTNER_STILL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [session.partnerStill, capturing, polaroidPreview, nickname, partnerNickname, player, session.room, session.members]);

  const sharePolaroid = useCallback(async () => {
    if (!polaroidPreview) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(polaroidPreview, { mimeType: "image/png", UTI: "public.png" });
    }
  }, [polaroidPreview]);

  const dismissPreview = useCallback(() => {
    setPolaroidPreview(null);
    setSelfStillUri(null);
    session.clearCapture();
  }, [session]);

  const handleExit = useCallback(() => {
    void session.leave();
    onExit();
  }, [onExit, session]);

  // Fit the polaroid preview within the (often landscape) player bounds.
  const preview = useMemo(() => {
    const { width, height } = Dimensions.get("window");
    const ratio = 320 / 430; // polaroid w/h
    const h = Math.min(height * 0.82, (width * 0.55) / ratio);
    return { w: h * ratio, h };
  }, []);

  return (
    <Root pointerEvents="box-none">
      <FaceCamOverlay
        visible={session.camerasOn}
        localStream={session.localStream}
        remoteStream={session.remoteStream}
        selfNickname={nickname}
        partnerNickname={partnerNickname}
        cameraEnabled={session.cameraEnabled}
        partnerConnected={session.bothPresent}
      />

      {/* Floating reactions */}
      <ReactionsAnchor pointerEvents="none">
        {session.reactions.map((reaction) => (
          <FloatingReaction key={reaction.id} emoji={reaction.emoji} />
        ))}
      </ReactionsAnchor>

      {/* Lobby / waiting state */}
      {!session.bothPresent ? (
        <Reanimated.View entering={FadeIn} exiting={FadeOut} style={waitingWrapStyle} pointerEvents="none">
          <WaitingCard>
            <WaitingTitle>Waiting for your partner</WaitingTitle>
            <CodePill>
              <CodeText>{code}</CodeText>
            </CodePill>
          </WaitingCard>
        </Reanimated.View>
      ) : null}

      {/* Right slide-in control rail */}
      <Reanimated.View style={[railWrapStyle, railStyle]}>
        <GestureDetector gesture={railGesture}>
          <Handle>
            <Feather name="chevron-left" size={16} color="#EFF2ED" />
          </Handle>
        </GestureDetector>
        <Rail>
          <EmojiStrip>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity key={emoji} onPress={() => session.sendReaction(emoji)} hitSlop={6}>
                <EmojiText>{emoji}</EmojiText>
              </TouchableOpacity>
            ))}
          </EmojiStrip>
          <RailButton onPress={() => setChatOpen(true)} $tone="surface">
            <Feather name="message-circle" size={15} color={theme.colors.textPrimary} />
            {unread > 0 ? (
              <Badge>
                <BadgeText>{unread > 9 ? "9+" : unread}</BadgeText>
              </Badge>
            ) : null}
          </RailButton>
          <RailButton onPress={initiateCapture} disabled={capturing} $tone="surface">
            <Feather name={capturing ? "loader" : "aperture"} size={15} color={theme.colors.primary} />
          </RailButton>
          <RailButton onPress={() => session.setCamerasOn((on) => !on)} $tone={session.camerasOn ? "primary" : "surface"}>
            <Feather name="camera" size={15} color={session.camerasOn ? theme.colors.textOnPrimary : theme.colors.textPrimary} />
          </RailButton>
          {session.camerasOn ? (
            <RailButton onPress={session.toggleMic} $tone="surface">
              <Feather name={session.micEnabled ? "mic" : "mic-off"} size={15} color={theme.colors.textPrimary} />
            </RailButton>
          ) : null}
          <RailButton onPress={handleExit} $tone="danger">
            <Feather name="phone-off" size={15} color="#FFFFFF" />
          </RailButton>
        </Rail>
      </Reanimated.View>

      {/* Hidden capturable local still (source for the polaroid face) */}
      <OffscreenHost pointerEvents="none">
        <ViewShot ref={selfStillShotRef} options={{ format: "jpg", quality: 0.85 }}>
          <StillTile>
            {RTCView && session.localStream ? (
              <RTCView streamURL={session.localStream.toURL()} style={STILL_STREAM_STYLE} objectFit="cover" mirror />
            ) : (
              <View />
            )}
          </StillTile>
        </ViewShot>
        <PolaroidCard
          viewShotRef={polaroidShotRef}
          title={session.room?.title ?? ""}
          posterPath={session.room?.posterPath ?? null}
          backdropPath={session.room?.backdropPath ?? null}
          selfStillUri={selfStillUri}
          partnerStillUri={session.partnerStill?.uri ?? null}
          selfNickname={nickname}
          partnerNickname={partnerNickname}
          dateEpochMs={Date.now()}
          rating={rating}
          genres={genres}
        />
      </OffscreenHost>

      {/* Chat sheet */}
      <Modal visible={chatOpen} transparent animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <ChatBackdrop activeOpacity={1} onPress={() => setChatOpen(false)} />
        <ChatSheet>
          <ChatHeader>
            <ChatTitle>Chat</ChatTitle>
            <TouchableOpacity onPress={() => setChatOpen(false)} hitSlop={8}>
              <Feather name="x" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </ChatHeader>
          <FlatList
            data={session.chatMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ChatRow $mine={item.mine}>
                <ChatBubble $mine={item.mine}>
                  <ChatText $mine={item.mine}>{item.text}</ChatText>
                </ChatBubble>
              </ChatRow>
            )}
            contentContainerStyle={{ padding: 12, gap: 6 }}
          />
          <ChatInputRow>
            <ChatInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor={theme.colors.textTertiary}
              onSubmitEditing={() => {
                session.sendChat(draft);
                setDraft("");
              }}
              returnKeyType="send"
            />
            <SendButton
              onPress={() => {
                session.sendChat(draft);
                setDraft("");
              }}
            >
              <Feather name="send" size={16} color={theme.colors.textOnPrimary} />
            </SendButton>
          </ChatInputRow>
        </ChatSheet>
      </Modal>

      {/* Polaroid preview */}
      <Modal visible={Boolean(polaroidPreview)} transparent animationType="fade" onRequestClose={dismissPreview}>
        <PreviewBackdrop>
          <PreviewClose onPress={dismissPreview} hitSlop={10}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </PreviewClose>
          {polaroidPreview ? (
            <PreviewImage source={{ uri: polaroidPreview }} style={{ width: preview.w, height: preview.h }} resizeMode="contain" />
          ) : null}
          <PreviewActions>
            <PreviewButton onPress={sharePolaroid} $primary>
              <Feather name="share-2" size={16} color="#fff" />
              <PreviewButtonText>Share</PreviewButtonText>
            </PreviewButton>
            <PreviewButton onPress={dismissPreview}>
              <PreviewButtonText>Done</PreviewButtonText>
            </PreviewButton>
          </PreviewActions>
        </PreviewBackdrop>
      </Modal>
    </Root>
  );
}

const Root = styled(View)`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
`;

const waitingWrapStyle = {
  position: "absolute" as const,
  top: 14,
  alignSelf: "center" as const,
};

const railWrapStyle = {
  position: "absolute" as const,
  right: 0,
  top: 0,
  bottom: 0,
  flexDirection: "row" as const,
  alignItems: "center" as const,
};

const ReactionsAnchor = styled(View)`
  position: absolute;
  left: 22px;
  bottom: 60px;
  width: 40px;
  height: 160px;
`;

const WaitingCard = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  background-color: rgba(13, 16, 15, 0.72);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.1);
`;

const WaitingTitle = styled(Text)`
  color: #eff2ed;
  font-size: 12px;
  font-weight: 600;
`;

const CodePill = styled(View)`
  padding: 3px 10px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.1);
`;

const CodeText = styled(Text)`
  color: #ffffff;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 3px;
`;

const Handle = styled(View)`
  width: ${HANDLE_WIDTH}px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border-top-left-radius: 12px;
  border-bottom-left-radius: 12px;
  background-color: rgba(13, 16, 15, 0.6);
`;

const Rail = styled(View)`
  width: ${RAIL_WIDTH}px;
  padding: 10px 0;
  align-items: center;
  gap: 12px;
  background-color: rgba(13, 16, 15, 0.6);
  border-top-left-radius: 16px;
  border-bottom-left-radius: 16px;
`;

const EmojiStrip = styled(View)`
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
`;

const EmojiText = styled(Text)`
  font-size: 17px;
`;

const RailButton = styled(TouchableOpacity)<{ $tone: "surface" | "primary" | "danger" }>`
  width: 34px;
  height: 34px;
  border-radius: 17px;
  align-items: center;
  justify-content: center;
  background-color: ${({ $tone, theme }) =>
    $tone === "danger" ? "#C0392B" : $tone === "primary" ? theme.colors.primary : "rgba(255,255,255,0.1)"};
`;

const Badge = styled(View)`
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  background-color: #e5484d;
`;

const BadgeText = styled(Text)`
  color: #ffffff;
  font-size: 9px;
  font-weight: 800;
`;

const OffscreenHost = styled(View)`
  position: absolute;
  left: -1000px;
  top: -1000px;
  opacity: 0;
`;

const StillTile = styled(View)`
  width: 240px;
  height: 320px;
  background-color: #10110f;
`;

const ChatBackdrop = styled(TouchableOpacity)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
`;

const ChatSheet = styled(View)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 58%;
  background-color: ${({ theme }) => theme.colors.surface};
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
`;

const ChatHeader = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const ChatTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  font-weight: 700;
`;

const ChatRow = styled(View)<{ $mine: boolean }>`
  align-items: ${({ $mine }) => ($mine ? "flex-end" : "flex-start")};
`;

const ChatBubble = styled(View)<{ $mine: boolean }>`
  max-width: 78%;
  padding: 7px 11px;
  border-radius: 14px;
  background-color: ${({ $mine, theme }) => ($mine ? theme.colors.primary : theme.colors.surfaceRaised)};
`;

const ChatText = styled(Text)<{ $mine: boolean }>`
  color: ${({ $mine, theme }) => ($mine ? theme.colors.textOnPrimary : theme.colors.textPrimary)};
  font-size: 14px;
`;

const ChatInputRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 18px 12px;
`;

const ChatInput = styled(TextInput)`
  flex: 1;
  height: 40px;
  border-radius: 20px;
  padding: 0px 16px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SendButton = styled(TouchableOpacity)`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const PreviewBackdrop = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.88);
`;

const PreviewClose = styled(TouchableOpacity)`
  position: absolute;
  top: 20px;
  right: 20px;
  width: 38px;
  height: 38px;
  border-radius: 19px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.14);
`;

const PreviewImage = styled.Image``;

const PreviewActions = styled(View)`
  flex-direction: row;
  gap: 12px;
  margin-top: 16px;
`;

const PreviewButton = styled(TouchableOpacity)<{ $primary?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 999px;
  background-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : "rgba(255,255,255,0.14)")};
`;

const PreviewButtonText = styled(Text)`
  color: #ffffff;
  font-weight: 700;
  font-size: 14px;
`;
