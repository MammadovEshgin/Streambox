import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Polygon, Rect } from "react-native-svg";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../api/tmdb";
import { withAlpha } from "../theme/Theme";
import { WatchRoomService } from "../services/watchRoomService";
import { WATCH_TOGETHER_NICKNAME_STORAGE_KEY } from "../services/userDataStorage";
import type { HomeStackParamList } from "../navigation/types";
import {
  isValidNickname,
  isValidRoomCode,
  normalizeNickname,
  normalizeRoomCode,
  type WatchRoomMedia,
} from "../utils/watchRoom";

type Props = NativeStackScreenProps<HomeStackParamList, "WatchRoomSetup">;

type Mode = "create" | "join";

const SCRIPT = "Caveat_700Bold";
const TYPEWRITER = "SpecialElite_400Regular";

// A row of glowing marquee bulbs that scales to fill its width.
function MarqueeBulbs({ color, count = 11 }: { color: string; count?: number }) {
  const W = 264;
  const bulbs = Array.from({ length: count });
  return (
    <Svg width="100%" height={12} viewBox={`0 0 ${W} 12`}>
      {bulbs.flatMap((_, i) => {
        const cx = ((i + 0.5) * W) / count;
        return [
          <Circle key={`h${i}`} cx={cx} cy={6} r={4.5} fill={color} opacity={0.22} />,
          <Circle key={`c${i}`} cx={cx} cy={6} r={2} fill={color} />,
        ];
      })}
    </Svg>
  );
}

// A short film-perforation strip for the empty (join) screen.
function Sprockets({ color }: { color: string }) {
  const holes = Array.from({ length: 12 });
  return (
    <Svg width={176} height={10} viewBox="0 0 176 10">
      {holes.map((_, i) => (
        <Rect key={i} x={4 + i * 14.5} y={2} width={8} height={6} rx={1.5} fill={color} opacity={0.5} />
      ))}
    </Svg>
  );
}

function StarMark({ size = 12, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="12,1 15,9 23,9 16,14 19,23 12,17 5,23 8,14 1,9 9,9" fill={color} />
    </Svg>
  );
}

export function WatchRoomScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const media = route.params?.media;
  const deepLinkCode = route.params?.code ? normalizeRoomCode(route.params.code) : "";
  const [mode, setMode] = useState<Mode>(
    route.params?.mode ?? (deepLinkCode ? "join" : media ? "create" : "join")
  );
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState(deepLinkCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serviceRef = useRef<WatchRoomService | null>(null);
  if (!serviceRef.current) serviceRef.current = new WatchRoomService();

  useMemo(() => {
    void AsyncStorage.getItem(WATCH_TOGETHER_NICKNAME_STORAGE_KEY).then((saved) => {
      if (saved) setNickname(saved);
    });
  }, []);

  // ── Ambient motion: breathing projector glow + a slow light-sweep ──
  const glow = useSharedValue(1);
  const sweep = useSharedValue(0);
  const twinkle = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1.28, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    sweep.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.ease) }), -1, false);
    twinkle.value = withDelay(
      600,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: 1400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
  }, [glow, sweep, twinkle]);

  const glowStyle = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }], opacity: 0.16 * glow.value }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -220 + sweep.value * 440 }, { rotate: "18deg" }],
    opacity: sweep.value < 0.15 || sweep.value > 0.85 ? 0 : 0.5,
  }));
  const twinkleStyle = useAnimatedStyle(() => ({ opacity: twinkle.value }));

  const canSubmit = isValidNickname(nickname) && (mode === "create" ? Boolean(media) : isValidRoomCode(code));

  const goToSession = (
    roomCode: string,
    roomMedia: WatchRoomMedia,
    nick: string,
    castNames?: string[]
  ) => {
    navigation.replace("Player", {
      mediaType: roomMedia.mediaType,
      tmdbId: String(roomMedia.tmdbId),
      title: roomMedia.title,
      // Thread the resolver's match fields through so the player resolves the
      // right title (not just by fuzzy title match).
      imdbId: roomMedia.imdbId ?? undefined,
      originalTitle: roomMedia.originalTitle ?? undefined,
      year: roomMedia.year ?? undefined,
      castNames,
      seasonNumber: roomMedia.seasonNumber ?? undefined,
      episodeNumber: roomMedia.episodeNumber ?? undefined,
      watchRoomCode: roomCode,
      watchRoomNickname: nick,
    });
  };

  const handleSubmit = async () => {
    const nick = normalizeNickname(nickname);
    if (!isValidNickname(nick)) {
      setError("Pick a name for tonight (1–20 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await AsyncStorage.setItem(WATCH_TOGETHER_NICKNAME_STORAGE_KEY, nick);
      const service = serviceRef.current!;

      if (mode === "create") {
        if (!media) return;
        const room = await service.createRoom(media, nick);
        goToSession(room.code, media, nick, media.castNames);
      } else {
        const room = await service.joinRoom(normalizeRoomCode(code), nick);
        goToSession(
          room.code,
          {
            mediaType: room.mediaType,
            tmdbId: room.tmdbId,
            title: room.title,
            posterPath: room.posterPath,
            backdropPath: room.backdropPath,
            seasonNumber: room.seasonNumber,
            episodeNumber: room.episodeNumber,
            imdbId: room.imdbId,
            year: room.year,
            originalTitle: room.originalTitle,
          },
          nick
        );
      }
    } catch (err: any) {
      const message: string = err?.message ?? "";
      if (message.includes("full")) setError("That room is already full.");
      else if (message.includes("not found") || message.includes("expired")) setError("Room not found or expired.");
      else setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const feature = media?.backdropPath ?? media?.posterPath ?? null;
  const featureImg = feature ? getTmdbImageUrl(feature, "w780") : null;

  return (
    <Root>
      {/* Theater ambience */}
      <Backdrop colors={["#17120E", "#0D100F", "#070908"]} locations={[0, 0.45, 1]} />
      {featureImg ? (
        <AmbientWrap pointerEvents="none">
          <Image source={{ uri: featureImg }} style={{ flex: 1 }} contentFit="cover" blurRadius={40} />
          <Backdrop
            colors={[withAlpha(theme.colors.background, 0.3), theme.colors.background]}
            locations={[0, 0.9]}
          />
        </AmbientWrap>
      ) : null}
      <ProjectorGlow style={glowStyle} $color={theme.colors.primary} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 28, paddingHorizontal: 22 }}
      >
        {/* Top bar */}
        <TopBar>
          <RoundBtn onPress={() => navigation.goBack()} hitSlop={12}>
            <Feather name="chevron-left" size={22} color={theme.colors.textPrimary} />
          </RoundBtn>
          <MetaTag>PRIVATE SCREENING</MetaTag>
          <View style={{ width: 38 }} />
        </TopBar>

        {/* Marquee header */}
        <Animated.View entering={FadeInDown.duration(600).springify().damping(15)}>
          <BulbRow>
            <MarqueeBulbs color={theme.colors.gold} />
          </BulbRow>
          <Kicker>now showing</Kicker>
          <MarqueeTitle>WATCH{"\n"}TOGETHER</MarqueeTitle>
          <TitleRule $color={theme.colors.gold} />
        </Animated.View>

        {/* The screen */}
        <Animated.View entering={FadeInUp.duration(520).delay(160)}>
          <ScreenFrame $border={withAlpha(theme.colors.gold, 0.28)} style={{ aspectRatio: 16 / 9 }}>
            {featureImg ? (
              <Image source={{ uri: featureImg }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
              <EmptyScreen>
                <MaterialCommunityIcons name="movie-open-outline" size={30} color={withAlpha(theme.colors.textPrimary, 0.5)} />
                <Sprockets color={theme.colors.textTertiary} />
              </EmptyScreen>
            )}
            <ScreenScrim colors={["transparent", "rgba(6,8,7,0.15)", "rgba(6,8,7,0.92)"]} locations={[0, 0.5, 1]} />

            {/* projector light-sweep */}
            <SweepClip pointerEvents="none">
              <Sweep style={sweepStyle}>
                <LinearGradient
                  colors={["transparent", "rgba(255,255,255,0.14)", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ flex: 1 }}
                />
              </Sweep>
            </SweepClip>

            <ScreenLabel>
              <MaterialCommunityIcons name="ticket-confirmation" size={12} color={theme.colors.gold} />
              <ScreenLabelText>TONIGHT’S FEATURE</ScreenLabelText>
            </ScreenLabel>

            <ScreenCaption>
              {media ? (
                <>
                  <FeatureTitle numberOfLines={2}>{media.title}</FeatureTitle>
                  <FeatureMeta>
                    {media.year ? `${media.year}   ·   ` : ""}in sync, face to face
                  </FeatureMeta>
                </>
              ) : (
                <FeatureMeta>Enter a code below to take your seat.</FeatureMeta>
              )}
            </ScreenCaption>
          </ScreenFrame>
        </Animated.View>

        {/* Ticket tabs */}
        <Animated.View entering={FadeInUp.duration(500).delay(260)}>
          <Tabs>
            {media ? (
              <TicketTab active={mode === "create"} onPress={() => setMode("create")} theme={theme}>
                Host a room
              </TicketTab>
            ) : null}
            <TicketTab active={mode === "join"} onPress={() => setMode("join")} theme={theme}>
              Have a code
            </TicketTab>
          </Tabs>
        </Animated.View>

        {/* Form */}
        <Animated.View entering={FadeInUp.duration(500).delay(340)}>
          <FieldLabel>your name for tonight</FieldLabel>
          <FieldWrap>
            <Feather name="user" size={16} color={theme.colors.textTertiary} />
            <Field
              value={nickname}
              onChangeText={setNickname}
              placeholder="e.g. Night Owl"
              placeholderTextColor={theme.colors.textTertiary}
              maxLength={20}
              autoCapitalize="words"
            />
          </FieldWrap>

          {mode === "join" ? (
            <>
              <FieldLabel>room code</FieldLabel>
              <CodeWrap $border={withAlpha(theme.colors.gold, 0.35)}>
                <MaterialCommunityIcons name="ticket-outline" size={18} color={theme.colors.gold} />
                <CodeField
                  value={code}
                  onChangeText={(text) => setCode(normalizeRoomCode(text))}
                  placeholder="6-CHAR CODE"
                  placeholderTextColor={theme.colors.textTertiary}
                  autoCapitalize="characters"
                  maxLength={6}
                />
              </CodeWrap>
            </>
          ) : null}

          {error ? (
            <ErrorRow>
              <Feather name="alert-circle" size={13} color="#E9897B" />
              <ErrorText>{error}</ErrorText>
            </ErrorRow>
          ) : null}

          <PrimaryWrap>
            <Primary
              onPress={handleSubmit}
              disabled={!canSubmit || busy}
              $enabled={canSubmit && !busy}
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.textOnPrimary} />
              ) : (
                <>
                  <MaterialCommunityIcons name="ticket-confirmation-outline" size={18} color={theme.colors.textOnPrimary} />
                  <PrimaryText>{mode === "create" ? "Open the room" : "Take my seat"}</PrimaryText>
                </>
              )}
            </Primary>
          </PrimaryWrap>

          <FooterRow>
            <Animated.View style={twinkleStyle}>
              <StarMark size={10} color={theme.colors.gold} />
            </Animated.View>
            <FooterNote>Private room. Just the two of you.</FooterNote>
            <Animated.View style={twinkleStyle}>
              <StarMark size={10} color={theme.colors.gold} />
            </Animated.View>
          </FooterRow>
        </Animated.View>
      </ScrollView>
    </Root>
  );
}

// A pressable shaped like a torn ticket stub (perforation + ticket icon).
function TicketTab({
  active,
  onPress,
  theme,
  children,
}: {
  active: boolean;
  onPress: () => void;
  theme: any;
  children: string;
}) {
  return (
    <Stub
      onPress={onPress}
      $active={active}
      $activeBg={withAlpha(theme.colors.primary, 0.16)}
      $activeBorder={theme.colors.primary}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <MaterialCommunityIcons
        name="ticket-confirmation-outline"
        size={16}
        color={active ? theme.colors.primary : theme.colors.textTertiary}
      />
      <Perf $color={active ? withAlpha(theme.colors.primary, 0.5) : theme.colors.border} />
      <StubText $active={active} $activeColor={theme.colors.primary}>
        {children}
      </StubText>
    </Stub>
  );
}

const Root = styled(View)`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Backdrop = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const AmbientWrap = styled(View)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 360px;
  opacity: 0.5;
`;

const ProjectorGlow = styled(Animated.View)<{ $color: string }>`
  position: absolute;
  top: -140px;
  align-self: center;
  width: 320px;
  height: 320px;
  border-radius: 160px;
  background-color: ${({ $color }) => $color};
`;

const TopBar = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const RoundBtn = styled(Pressable)`
  width: 38px;
  height: 38px;
  border-radius: 19px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const MetaTag = styled(Text)`
  color: ${({ theme }) => theme.colors.textTertiary};
  font-family: ${TYPEWRITER};
  font-size: 11px;
  letter-spacing: 3px;
`;

const BulbRow = styled(View)`
  margin-top: 10px;
  padding: 0 24px;
`;

const Kicker = styled(Text)`
  margin-top: 8px;
  text-align: center;
  color: ${({ theme }) => theme.colors.gold};
  font-family: ${SCRIPT};
  font-size: 22px;
`;

const MarqueeTitle = styled(Text)`
  margin-top: 2px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.Display.fontFamily};
  font-size: 40px;
  line-height: 42px;
  letter-spacing: 6px;
  text-shadow: 0px 2px 18px ${({ theme }) => withAlpha(theme.colors.gold, 0.35)};
`;

const TitleRule = styled(View)<{ $color: string }>`
  align-self: center;
  width: 54px;
  height: 2px;
  margin-top: 12px;
  margin-bottom: 20px;
  border-radius: 1px;
  background-color: ${({ $color }) => $color};
`;

const ScreenFrame = styled(View)<{ $border: string }>`
  width: 100%;
  border-radius: 20px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ $border }) => $border};
`;

const EmptyScreen = styled(View)`
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const ScreenScrim = styled(LinearGradient)`
  position: absolute;
  inset: 0;
`;

const SweepClip = styled(View)`
  position: absolute;
  inset: 0;
  overflow: hidden;
`;

const Sweep = styled(Animated.View)`
  position: absolute;
  top: -40px;
  bottom: -40px;
  width: 120px;
`;

const ScreenLabel = styled(View)`
  position: absolute;
  top: 12px;
  left: 12px;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 999px;
  background-color: rgba(6, 8, 7, 0.55);
  border-width: 1px;
  border-color: ${({ theme }) => withAlpha(theme.colors.gold, 0.3)};
`;

const ScreenLabelText = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${TYPEWRITER};
  font-size: 9px;
  letter-spacing: 1.5px;
`;

const ScreenCaption = styled(View)`
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
`;

const FeatureTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.Display.fontFamily};
  font-size: 22px;
  line-height: 26px;
  letter-spacing: -0.4px;
`;

const FeatureMeta = styled(Text)`
  margin-top: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 12px;
  letter-spacing: 0.3px;
`;

const Tabs = styled(View)`
  flex-direction: row;
  gap: 10px;
  margin-top: 22px;
`;

const Stub = styled(Pressable)<{ $active: boolean; $activeBg: string; $activeBorder: string }>`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 13px 10px;
  border-radius: 14px;
  background-color: ${({ $active, $activeBg, theme }) => ($active ? $activeBg : theme.colors.glassFill)};
  border-width: 1px;
  border-color: ${({ $active, $activeBorder, theme }) => ($active ? $activeBorder : theme.colors.glassBorder)};
`;

const Perf = styled(View)<{ $color: string }>`
  width: 1px;
  height: 18px;
  border-left-width: 1px;
  border-style: dashed;
  border-color: ${({ $color }) => $color};
`;

const StubText = styled(Text)<{ $active: boolean; $activeColor: string }>`
  color: ${({ $active, $activeColor, theme }) => ($active ? $activeColor : theme.colors.textSecondary)};
  font-family: ${({ theme }) => theme.typography.Button.fontFamily};
  font-size: 13px;
`;

const FieldLabel = styled(Text)`
  margin-top: 22px;
  margin-bottom: 9px;
  color: ${({ theme }) => theme.colors.textTertiary};
  font-family: ${TYPEWRITER};
  font-size: 11px;
  letter-spacing: 1.5px;
`;

const FieldWrap = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 16px;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const Field = styled(TextInput)`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.BodyMedium.fontFamily};
  font-size: 15px;
`;

const CodeWrap = styled(View)<{ $border: string }>`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 18px;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-style: dashed;
  border-color: ${({ $border }) => $border};
`;

const CodeField = styled(TextInput)`
  flex: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${TYPEWRITER};
  font-size: 20px;
  letter-spacing: 8px;
`;

const ErrorRow = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
`;

const ErrorText = styled(Text)`
  color: #e9897b;
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 13px;
`;

const PrimaryWrap = styled(View)`
  margin-top: 26px;
`;

const Primary = styled(Pressable)<{ $enabled: boolean }>`
  height: 56px;
  border-radius: 30px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background-color: ${({ $enabled, theme }) => ($enabled ? theme.colors.primary : theme.colors.surfaceHigh)};
  shadow-color: ${({ theme }) => theme.colors.primary};
  shadow-opacity: ${({ $enabled }) => ($enabled ? 0.55 : 0)};
  shadow-radius: 20px;
  shadow-offset: 0px 10px;
  elevation: ${({ $enabled }) => ($enabled ? 12 : 0)};
`;

const PrimaryText = styled(Text)`
  color: ${({ theme }) => theme.colors.textOnPrimary};
  font-family: ${({ theme }) => theme.typography.Button.fontFamily};
  font-size: 16px;
  letter-spacing: 0.3px;
`;

const FooterRow = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
`;

const FooterNote = styled(Text)`
  color: ${({ theme }) => theme.colors.textTertiary};
  font-family: ${({ theme }) => theme.typography.MetaSmall.fontFamily};
  font-size: 12px;
`;
