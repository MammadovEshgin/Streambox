import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
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
import { uploadCameraStill, cacheMemoryFromLocalUri } from "../../services/watchMemories";
import { addLocalMemory } from "../../services/watchMemoryLocalStore";
import { syncPendingMemories } from "../../services/watchMemorySync";
import { generateUuidV4 } from "../../utils/uuid";

const REACTIONS = ["WTF?", "💖", "LOL:)", "Cringe🔪", "Red flag 🚩"];
// Budget for the partner's still: their side is a camera handoff + snap +
// upload on a possibly-cellular uplink — 5s proved routinely too tight. A
// decline (capture-unavailable) short-circuits the wait, so the timeout is
// only ever fully paid when the partner's side silently died.
const PARTNER_STILL_TIMEOUT_MS = 10_000;

const RAIL_WIDTH = 54;
const HANDLE_WIDTH = 22;

export type WatchRoomLayerProps = {
  player: VideoPlayer | null;
  code: string;
  nickname: string;
  onExit: () => void;
};

// A single reaction that floats up and fades, TikTok/IG-live style.
function FloatingReaction({ emoji }: { emoji: string }) {
  const progress = useSharedValue(0);
  const drift = useMemo(() => (Math.random() - 0.5) * 22, []);
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
  return (
    <Reanimated.View style={[{ position: "absolute", bottom: 0 }, style]}>
      <FloatChip>
        <FloatText numberOfLines={1}>{emoji}</FloatText>
      </FloatChip>
    </Reanimated.View>
  );
}

export function WatchRoomLayer({ player, code, nickname, onExit }: WatchRoomLayerProps) {
  const theme = useTheme();
  const session = useWatchRoomSession({ player, code, nickname });

  // Camera + mic access is requested in-app the first time you turn cameras on.
  // The permission hooks remember the granted state, so it never re-prompts once
  // allowed (and turning cameras off/on again won't ask again).
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const toggleCameras = useCallback(async () => {
    // Turning off never needs permission.
    if (session.camerasOn) {
      session.setCamerasOn(false);
      return;
    }
    let camera = cameraPermission;
    if (!camera?.granted) camera = await requestCameraPermission();
    let mic = micPermission;
    if (!mic?.granted) mic = await requestMicPermission();

    if (!camera?.granted || !mic?.granted) {
      Alert.alert(
        "Camera & microphone needed",
        camera?.canAskAgain === false || mic?.canAskAgain === false
          ? "Enable camera and microphone for StreamBox in your device Settings to share your face and voice."
          : "StreamBox needs camera and microphone access so you and your partner can see and hear each other."
      );
      return;
    }
    session.setCamerasOn(true);
  }, [session, cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const [chatOpen, setChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
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

  const polaroidShotRef = useRef<ViewShot>(null);
  const authorRef = useRef(false);
  const cameraViewRef = useRef<CameraView>(null);
  const photoResolveRef = useRef<((uri: string | null) => void) | null>(null);
  const [photoMode, setPhotoMode] = useState(false);
  const [selfStillUri, setSelfStillUri] = useState<string | null>(null);
  const [polaroidPreview, setPolaroidPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Mirror the partner's still / decline / presence into refs so the async
  // build flow can read the latest without re-subscribing (state closures
  // would be stale).
  const partnerStillRef = useRef(session.partnerStill);
  partnerStillRef.current = session.partnerStill;
  const captureDeclinedRef = useRef(session.captureDeclinedId);
  captureDeclinedRef.current = session.captureDeclinedId;
  const bothPresentRef = useRef(session.bothPresent);
  bothPresentRef.current = session.bothPresent;
  // The capture currently being composed; stills tagged with any other id are
  // leftovers from an earlier capture and never make it into the polaroid.
  const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [genres, setGenres] = useState<string[] | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);

  const partnerNickname = session.partner?.nickname ?? null;

  // "Partner left" is a different situation than "partner hasn't arrived yet"
  // — sync silently stopping with no explanation was the worst version of it.
  const [partnerLeft, setPartnerLeft] = useState(false);
  const hadPartnerRef = useRef(false);
  useEffect(() => {
    if (session.bothPresent) {
      hadPartnerRef.current = true;
      setPartnerLeft(false);
      return;
    }
    if (hadPartnerRef.current) {
      hadPartnerRef.current = false;
      setPartnerLeft(true);
      const timer = setTimeout(() => setPartnerLeft(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [session.bothPresent]);

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
          setTagline("tagline" in details ? details.tagline ?? null : null);
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
  // WebRTC renders the live face into an Android SurfaceView, which screenshot
  // APIs capture as black. So the polaroid photo is taken with expo-camera: we
  // briefly hand the camera from WebRTC to a hidden CameraView, snap a real
  // photo, then hand it back (the readiness handshake reconnects the video).
  const onPhotoCameraReady = useCallback(async () => {
    const resolve = photoResolveRef.current;
    try {
      // A short settle lets the sensor lock exposure before the shot.
      await new Promise((r) => setTimeout(r, 350));
      const photo = await cameraViewRef.current?.takePictureAsync({ quality: 0.85 });
      photoResolveRef.current = null;
      resolve?.(photo?.uri ?? null);
    } catch {
      photoResolveRef.current = null;
      resolve?.(null);
    }
  }, []);

  const captureSelfPhoto = useCallback(async (): Promise<string | null> => {
    let cam = cameraPermission;
    if (!cam?.granted) cam = await requestCameraPermission();
    if (!cam?.granted) return null;

    const restoreCameras = session.camerasOn;
    try {
      if (restoreCameras) {
        // Release the camera from WebRTC so expo-camera can open it.
        session.setCamerasOn(false);
        await new Promise((r) => setTimeout(r, 550));
      }
      return await new Promise<string | null>((resolve) => {
        photoResolveRef.current = resolve;
        setPhotoMode(true);
        // Safety net if the camera never signals ready.
        setTimeout(() => {
          if (photoResolveRef.current) {
            photoResolveRef.current = null;
            resolve(null);
          }
        }, 4500);
      });
    } finally {
      setPhotoMode(false);
      if (restoreCameras) setTimeout(() => session.setCamerasOn(true), 400);
    }
  }, [cameraPermission, requestCameraPermission, session]);

  // Author path: the photo only composes locally — nothing to upload. (The old
  // flow uploaded the author's still too; the partner never used it, and it
  // polluted their capture state.)
  const captureOwnStill = useCallback(async (): Promise<string | null> => {
    const uri = await captureSelfPhoto();
    if (uri) setSelfStillUri(uri);
    return uri;
  }, [captureSelfPhoto]);

  // Responder path: snap + upload + signal the still, tagged with the capture
  // it belongs to. Any failure declines instead, so the author composes right
  // away rather than waiting out the full timeout.
  const respondToCapture = useCallback(
    async (captureId: string) => {
      const uri = await captureSelfPhoto();
      const roomId = session.room?.id;
      if (uri && roomId) {
        const path = await uploadCameraStill(roomId, uri).catch(() => null);
        if (path) {
          session.sendCaptureStill(captureId, nickname, path);
          return;
        }
      }
      session.sendCaptureUnavailable(captureId);
    },
    [captureSelfPhoto, nickname, session]
  );

  // Author flow: take my photo, wait briefly for the partner's still (if a
  // partner is here and hasn't declined), then render the polaroid and save it
  // LOCALLY with an outbox payload. The cloud upload + row insert live in
  // syncPendingMemories, which retries after any failure or app kill — the
  // partner's copy no longer depends on one fire-and-forget attempt.
  const buildPolaroid = useCallback(
    async (captureId: string) => {
      try {
        if (bothPresentRef.current) {
          const deadline = Date.now() + PARTNER_STILL_TIMEOUT_MS;
          while (
            partnerStillRef.current?.captureId !== captureId &&
            captureDeclinedRef.current !== captureId &&
            Date.now() < deadline
          ) {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        // Let the polaroid re-render with the latest stills before snapshotting
        // (the partner still is a local file by now — see downloadMemoryStill).
        await new Promise((r) => setTimeout(r, 250));
        // Full-HD portrait polaroid.
        const uri = await captureRef(polaroidShotRef, { format: "png", quality: 1, width: 1080, height: 1451 });
        setPolaroidPreview(uri);

        const room = session.room;

        // Participants come from the durable membership table — presence can
        // flap at the exact capture moment, and a snapshot of the live roster
        // would silently cut the partner out of the saved memory forever.
        let participantUserIds = session.members.map((member) => member.userId);
        let participantNicknames = [nickname, partnerNickname].filter(Boolean) as string[];
        if (room) {
          const dbMembers = await session.fetchRoomMembers().catch(() => null);
          if (dbMembers && dbMembers.length > 0) {
            participantUserIds = dbMembers.map((member) => member.userId);
            participantNicknames = dbMembers.map((member) => member.nickname);
          }
        }

        // One id from birth: index entry, cached file and (later) cloud row all
        // share it — that is what makes the background sync idempotent.
        const localId = generateUuidV4();
        const cachedUri = (await cacheMemoryFromLocalUri(localId, uri).catch(() => null)) ?? uri;
        await addLocalMemory({
          localId,
          cloudId: null,
          title: room?.title ?? "",
          participantNicknames,
          createdAtEpochMs: Date.now(),
          imageLocalUri: cachedUri,
          imagePath: null,
          pending: room
            ? {
                roomId: room.id,
                mediaType: room.mediaType,
                tmdbId: room.tmdbId,
                positionSeconds: player?.currentTime ?? 0,
                participantUserIds,
              }
            : null,
        }).catch(() => undefined);

        // First sync attempt now; the outbox owns every retry after this.
        void syncPendingMemories();
      } finally {
        authorRef.current = false;
        setCapturing(false);
        setActiveCaptureId(null);
      }
    },
    [session, player, nickname, partnerNickname]
  );

  const initiateCapture = useCallback(async () => {
    if (capturing) return;
    // A late-arriving still from a PREVIOUS capture must never leak into this
    // one — start from a clean slate and tag everything with a fresh id.
    session.clearCapture();
    const captureId = generateUuidV4();
    setActiveCaptureId(captureId);
    authorRef.current = true;
    setCapturing(true);
    session.requestCapture(captureId);
    const ownStill = await captureOwnStill();
    if (!ownStill) {
      // Composing a polaroid of two placeholders helps nobody — say what broke.
      authorRef.current = false;
      setCapturing(false);
      setActiveCaptureId(null);
      session.clearCapture();
      Alert.alert(
        "Couldn't take your photo",
        "The camera didn't respond. Check that StreamBox still has camera access and try again."
      );
      return;
    }
    await buildPolaroid(captureId);
  }, [capturing, captureOwnStill, buildPolaroid, session]);

  useEffect(() => {
    const request = session.captureRequest;
    if (!request || authorRef.current) return;
    // Face-cam off is an explicit privacy choice — never let a capture request
    // silently photograph someone through the hidden camera. Decline instead.
    if (!session.camerasOn) {
      session.sendCaptureUnavailable(request.captureId);
      session.clearCapture();
      return;
    }
    setCapturing(true);
    void respondToCapture(request.captureId).finally(() => {
      setTimeout(() => setCapturing(false), 1500);
      session.clearCapture();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.captureRequest]);

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
        mediaState={session.mediaState}
        onRetry={session.restartMedia}
      />

      {/* Floating reactions */}
      <ReactionsAnchor pointerEvents="none">
        {session.reactions.map((reaction) => (
          <FloatingReaction key={reaction.id} emoji={reaction.emoji} />
        ))}
      </ReactionsAnchor>

      {/* Join failure / lobby / partner-left states */}
      {session.joinFailed ? (
        <Reanimated.View entering={FadeIn} exiting={FadeOut} style={waitingWrapStyle} pointerEvents="box-none">
          <WaitingCard>
            <WaitingTitle>Couldn't join the room</WaitingTitle>
            <RetryPill onPress={session.retryJoin} hitSlop={6}>
              <RetryPillText>Retry</RetryPillText>
            </RetryPill>
          </WaitingCard>
        </Reanimated.View>
      ) : !session.bothPresent ? (
        <Reanimated.View entering={FadeIn} exiting={FadeOut} style={waitingWrapStyle} pointerEvents="none">
          <WaitingCard>
            <WaitingTitle>{partnerLeft ? "Your partner left — sync is paused" : "Waiting for your partner"}</WaitingTitle>
            {partnerLeft ? null : (
              <CodePill>
                <CodeText>{code}</CodeText>
              </CodePill>
            )}
          </WaitingCard>
        </Reanimated.View>
      ) : null}

      {/* Right slide-in control rail */}
      <Reanimated.View style={[railWrapStyle, railStyle]}>
        {emojiOpen ? (
          <Reanimated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)}>
            <EmojiPop>
              {REACTIONS.map((reaction) => (
                <TouchableOpacity key={reaction} onPress={() => session.sendReaction(reaction)} hitSlop={6}>
                  <ReactionChip>
                    <ReactionChipText numberOfLines={1}>{reaction}</ReactionChipText>
                  </ReactionChip>
                </TouchableOpacity>
              ))}
            </EmojiPop>
          </Reanimated.View>
        ) : null}
        <GestureDetector gesture={railGesture}>
          <Handle>
            <Feather name="chevron-left" size={16} color="#EFF2ED" />
          </Handle>
        </GestureDetector>
        <Rail>
          <RailButton onPress={() => setEmojiOpen((v) => !v)} $tone={emojiOpen ? "primary" : "surface"}>
            <Feather name="smile" size={15} color={emojiOpen ? theme.colors.textOnPrimary : theme.colors.textPrimary} />
          </RailButton>
          <RailButton
            onPress={() => {
              setEmojiOpen(false);
              setChatOpen(true);
            }}
            $tone="surface"
          >
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
          <RailButton onPress={toggleCameras} $tone={session.camerasOn ? "primary" : "surface"}>
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

      {/* Hidden expo-camera used only to snap the self photo during capture
          (view-shot of the WebRTC SurfaceView comes back black on Android). */}
      {photoMode ? (
        <PhotoCaptureHost pointerEvents="none">
          <CameraView ref={cameraViewRef} facing="front" onCameraReady={onPhotoCameraReady} style={{ flex: 1 }} />
        </PhotoCaptureHost>
      ) : null}

      {/* Offscreen polaroid, snapshotted into the shareable memory image */}
      <OffscreenHost pointerEvents="none">
        <PolaroidCard
          viewShotRef={polaroidShotRef}
          title={session.room?.title ?? ""}
          tagline={tagline}
          posterPath={session.room?.posterPath ?? null}
          backdropPath={session.room?.backdropPath ?? null}
          selfStillUri={selfStillUri}
          partnerStillUri={
            session.partnerStill && session.partnerStill.captureId === activeCaptureId
              ? session.partnerStill.uri
              : null
          }
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
  width: 150px;
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

const RetryPill = styled(TouchableOpacity)`
  padding: 4px 12px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.16);
`;

const RetryPillText = styled(Text)`
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
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

// A vertical picker that pops to the left of the rail when the reaction button
// is tapped. Stays open so you can fire reactions repeatedly; closes on the
// icon.
const EmojiPop = styled(View)`
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-right: 8px;
  padding: 10px;
  border-radius: 18px;
  background-color: rgba(13, 16, 15, 0.85);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.12);
`;

const ReactionChip = styled(View)`
  padding: 7px 13px;
  border-radius: 999px;
  align-items: center;
  background-color: rgba(255, 255, 255, 0.08);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.14);
`;

const ReactionChipText = styled(Text)`
  color: #eff2ed;
  font-size: 13px;
  font-weight: 700;
`;

// Floating reaction — the short text drifting up over the video.
const FloatChip = styled(View)`
  padding: 5px 11px;
  border-radius: 999px;
  background-color: rgba(13, 16, 15, 0.7);
`;

const FloatText = styled(Text)`
  color: #ffffff;
  font-size: 15px;
  font-weight: 800;
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

// Off-screen (but full-opacity, so the sensor actually renders) host for the
// capture-only CameraView.
const PhotoCaptureHost = styled(View)`
  position: absolute;
  left: -2000px;
  top: -2000px;
  width: 220px;
  height: 300px;
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
