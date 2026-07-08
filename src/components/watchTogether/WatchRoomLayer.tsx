import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import Reanimated, { FadeIn, FadeOut, FadeOutUp } from "react-native-reanimated";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import ViewShot from "react-native-view-shot";
import styled from "styled-components/native";
import { useTheme } from "styled-components/native";
import type { VideoPlayer } from "expo-video";

import { FaceCamOverlay } from "./FaceCamOverlay";
import { PolaroidCard } from "./PolaroidCard";
import { useWatchRoomSession } from "../../hooks/useWatchRoomSession";
import { getWebRtc } from "../../services/webrtcCompat";
import { uploadCameraStill, uploadPolaroid, saveWatchMemory } from "../../services/watchMemories";

const STILL_STREAM_STYLE = { width: "100%" as const, height: "100%" as const };

const REACTION_EMOJIS = ["😂", "❤️", "😮", "😢", "🔥", "👏"];
const PARTNER_STILL_TIMEOUT_MS = 5000;

export type WatchRoomLayerProps = {
  player: VideoPlayer | null;
  code: string;
  nickname: string;
  onExit: () => void;
};

export function WatchRoomLayer({ player, code, nickname, onExit }: WatchRoomLayerProps) {
  const theme = useTheme();
  const session = useWatchRoomSession({ player, code, nickname });
  const RTCView = getWebRtc()?.RTCView;

  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const selfStillShotRef = useRef<ViewShot>(null);
  const polaroidShotRef = useRef<ViewShot>(null);
  const authorRef = useRef(false);
  const [selfStillUri, setSelfStillUri] = useState<string | null>(null);
  const [polaroidPreview, setPolaroidPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const partnerNickname = session.partner?.nickname ?? null;

  // Best-effort still from the local camera tile. On devices where the native
  // video surface can't be rasterized this returns null and the polaroid is
  // composed without a face — it still looks intentional.
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

  // Local user taps capture → become the author, ask the partner, contribute.
  const initiateCapture = useCallback(() => {
    if (capturing) return;
    authorRef.current = true;
    setCapturing(true);
    session.requestCapture();
    void contributeStill();
  }, [capturing, contributeStill, session]);

  // Partner asked for a capture → contribute a still (they author the polaroid).
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

  // Author composes the polaroid once both stills are in (or after a timeout).
  useEffect(() => {
    if (!authorRef.current || polaroidPreview || !capturing) return;
    const build = async () => {
      // small delay so the still <Image>s inside the polaroid have loaded
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        const uri = await captureRef(polaroidShotRef, { format: "png", quality: 1 });
        setPolaroidPreview(uri);
        if (session.room) {
          const path = await uploadPolaroid(session.room.id, uri).catch(() => null);
          if (path) {
            await saveWatchMemory({
              roomId: session.room.id,
              mediaType: session.room.mediaType,
              tmdbId: session.room.tmdbId,
              title: session.room.title,
              positionSeconds: player?.currentTime ?? 0,
              imagePath: path,
              participantNicknames: [nickname, partnerNickname].filter(Boolean) as string[],
              participantUserIds: session.members.map((member) => member.userId),
            }).catch(() => undefined);
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

  return (
    <Root pointerEvents="box-none">
      <FaceCamOverlay
        localStream={session.localStream}
        remoteStream={session.remoteStream}
        selfNickname={nickname}
        partnerNickname={partnerNickname}
        cameraEnabled={session.cameraEnabled}
        partnerConnected={session.bothPresent}
      />

      {/* Floating reactions */}
      <ReactionsLayer pointerEvents="none">
        {session.reactions.map((reaction) => (
          <Reanimated.View key={reaction.id} entering={FadeIn.duration(200)} exiting={FadeOutUp.duration(1600)}>
            <FloatingEmoji>{reaction.emoji}</FloatingEmoji>
          </Reanimated.View>
        ))}
      </ReactionsLayer>

      {/* Lobby / waiting state */}
      {!session.bothPresent ? (
        <Reanimated.View entering={FadeIn} exiting={FadeOut} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
          <Waiting pointerEvents="box-none">
            <WaitingCard>
              <WaitingTitle>Waiting for your partner…</WaitingTitle>
              <WaitingSub>Share this code</WaitingSub>
              <CodePill>
                <CodeText>{code}</CodeText>
              </CodePill>
            </WaitingCard>
          </Waiting>
        </Reanimated.View>
      ) : null}

      {/* Bottom control bar */}
      <Controls pointerEvents="box-none">
        <ReactionRow>
          {REACTION_EMOJIS.map((emoji) => (
            <TouchableOpacity key={emoji} onPress={() => session.sendReaction(emoji)} activeOpacity={0.7}>
              <ReactionButton>
                <ReactionEmoji>{emoji}</ReactionEmoji>
              </ReactionButton>
            </TouchableOpacity>
          ))}
        </ReactionRow>

        <ActionRow>
          <CircleButton onPress={session.toggleMic} $active={session.micEnabled}>
            <Feather name={session.micEnabled ? "mic" : "mic-off"} size={18} color={theme.colors.textOnPrimary} />
          </CircleButton>
          <CircleButton onPress={session.toggleCamera} $active={session.cameraEnabled}>
            <Feather name={session.cameraEnabled ? "video" : "video-off"} size={18} color={theme.colors.textOnPrimary} />
          </CircleButton>
          <CircleButton onPress={session.switchCamera} $active>
            <Feather name="refresh-cw" size={18} color={theme.colors.textOnPrimary} />
          </CircleButton>
          <CaptureButton onPress={initiateCapture} disabled={capturing} activeOpacity={0.8}>
            {capturing ? <Feather name="loader" size={20} color="#fff" /> : <Feather name="camera" size={20} color="#fff" />}
          </CaptureButton>
          <CircleButton onPress={() => setChatOpen(true)} $active>
            <Feather name="message-circle" size={18} color={theme.colors.textOnPrimary} />
          </CircleButton>
          <CircleButton onPress={handleExit} $danger>
            <Feather name="phone-off" size={18} color="#fff" />
          </CircleButton>
        </ActionRow>
      </Controls>

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
          backdropPath={session.room?.backdropPath ?? null}
          title={session.room?.title ?? ""}
          timecodeSeconds={player?.currentTime ?? 0}
          dateEpochMs={Date.now()}
          selfStillUri={selfStillUri}
          partnerStillUri={session.partnerStill?.uri ?? null}
          selfNickname={nickname}
          partnerNickname={partnerNickname}
        />
      </OffscreenHost>

      {/* Chat sheet */}
      <Modal visible={chatOpen} transparent animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <ChatBackdrop activeOpacity={1} onPress={() => setChatOpen(false)} />
        <ChatSheet>
          <ChatHeader>
            <ChatTitle>Chat</ChatTitle>
            <TouchableOpacity onPress={() => setChatOpen(false)}>
              <Feather name="x" size={20} color={theme.colors.textSecondary} />
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
              <Feather name="send" size={18} color={theme.colors.textOnPrimary} />
            </SendButton>
          </ChatInputRow>
        </ChatSheet>
      </Modal>

      {/* Polaroid preview */}
      <Modal visible={Boolean(polaroidPreview)} transparent animationType="fade" onRequestClose={dismissPreview}>
        <PreviewBackdrop>
          <PreviewCard>
            {polaroidPreview ? <PreviewImage source={{ uri: polaroidPreview }} /> : null}
            <PreviewActions>
              <PreviewButton onPress={sharePolaroid} $primary>
                <Feather name="share-2" size={18} color="#fff" />
                <PreviewButtonText>Share</PreviewButtonText>
              </PreviewButton>
              <PreviewButton onPress={dismissPreview}>
                <PreviewButtonText>Done</PreviewButtonText>
              </PreviewButton>
            </PreviewActions>
          </PreviewCard>
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

const ReactionsLayer = styled(View)`
  position: absolute;
  left: 24px;
  bottom: 120px;
  flex-direction: row;
  gap: 6px;
`;

const FloatingEmoji = styled(Text)`
  font-size: 34px;
`;

const Waiting = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const WaitingCard = styled(View)`
  align-items: center;
  padding: 20px 28px;
  border-radius: 20px;
  background-color: rgba(13, 16, 15, 0.82);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.12);
`;

const WaitingTitle = styled(Text)`
  color: #f6f7f4;
  font-size: 16px;
  font-weight: 700;
`;

const WaitingSub = styled(Text)`
  color: #b2b8b1;
  font-size: 12px;
  margin-top: 10px;
`;

const CodePill = styled(View)`
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.08);
`;

const CodeText = styled(Text)`
  color: #ffffff;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 6px;
`;

const Controls = styled(View)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0px 16px 18px 16px;
  align-items: center;
`;

const ReactionRow = styled(View)`
  flex-direction: row;
  gap: 8px;
  margin-bottom: 12px;
`;

const ReactionButton = styled(View)`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: rgba(13, 16, 15, 0.6);
`;

const ReactionEmoji = styled(Text)`
  font-size: 20px;
`;

const ActionRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

const CircleButton = styled(TouchableOpacity)<{ $active?: boolean; $danger?: boolean }>`
  width: 46px;
  height: 46px;
  border-radius: 23px;
  align-items: center;
  justify-content: center;
  background-color: ${({ $danger, $active, theme }) =>
    $danger ? "#C0392B" : $active ? theme.colors.primary : "rgba(255,255,255,0.14)"};
`;

const CaptureButton = styled(TouchableOpacity)`
  width: 58px;
  height: 58px;
  border-radius: 29px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
  border-width: 3px;
  border-color: #ffffff;
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
  height: 60%;
  background-color: ${({ theme }) => theme.colors.surface};
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
`;

const ChatHeader = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${({ theme }) => theme.colors.border};
`;

const ChatTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 16px;
  font-weight: 700;
`;

const ChatRow = styled(View)<{ $mine: boolean }>`
  align-items: ${({ $mine }) => ($mine ? "flex-end" : "flex-start")};
`;

const ChatBubble = styled(View)<{ $mine: boolean }>`
  max-width: 78%;
  padding: 8px 12px;
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
  height: 42px;
  border-radius: 21px;
  padding: 0px 16px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SendButton = styled(TouchableOpacity)`
  width: 42px;
  height: 42px;
  border-radius: 21px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const PreviewBackdrop = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.82);
`;

const PreviewCard = styled(View)`
  align-items: center;
`;

const PreviewImage = styled.Image`
  width: 300px;
  height: 420px;
  resize-mode: contain;
`;

const PreviewActions = styled(View)`
  flex-direction: row;
  gap: 12px;
  margin-top: 18px;
`;

const PreviewButton = styled(TouchableOpacity)<{ $primary?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  border-radius: 999px;
  background-color: ${({ $primary, theme }) => ($primary ? theme.colors.primary : "rgba(255,255,255,0.14)")};
`;

const PreviewButtonText = styled(Text)`
  color: #ffffff;
  font-weight: 700;
  font-size: 14px;
`;
