import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../api/tmdb";
import { SafeContainer } from "../components/common/SafeContainer";
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

export function WatchRoomScreen({ route, navigation }: Props) {
  const theme = useTheme();
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

  const canSubmit = isValidNickname(nickname) && (mode === "create" ? Boolean(media) : isValidRoomCode(code));

  const goToSession = (roomCode: string, roomMedia: WatchRoomMedia, nick: string) => {
    navigation.replace("Player", {
      mediaType: roomMedia.mediaType,
      tmdbId: String(roomMedia.tmdbId),
      title: roomMedia.title,
      seasonNumber: roomMedia.seasonNumber ?? undefined,
      episodeNumber: roomMedia.episodeNumber ?? undefined,
      watchRoomCode: roomCode,
      watchRoomNickname: nick,
    });
  };

  const handleSubmit = async () => {
    const nick = normalizeNickname(nickname);
    if (!isValidNickname(nick)) {
      setError("Pick a nickname (1–20 characters).");
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
        goToSession(room.code, media, nick);
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
          },
          nick
        );
      }
    } catch (err: any) {
      const message: string = err?.message ?? "";
      if (message.includes("full")) setError("That room is already full.");
      else if (message.includes("nickname")) setError("That nickname is taken in this room.");
      else if (message.includes("not found") || message.includes("expired")) setError("Room not found or expired.");
      else setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const poster = media?.posterPath ? getTmdbImageUrl(media.posterPath, "w342") : null;

  return (
    <SafeContainer>
      <Header>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Feather name="chevron-left" size={26} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <HeaderTitle>Watch Together</HeaderTitle>
        <View style={{ width: 26 }} />
      </Header>

      <Content>
        <Hero>
          <Feather name="users" size={26} color={theme.colors.primary} />
          <HeroTitle>Watch in sync, face to face</HeroTitle>
          <HeroSub>Start a private room and invite one friend with a code.</HeroSub>
        </Hero>

        {media ? (
          <MovieCard>
            {poster ? <Poster source={{ uri: poster }} contentFit="cover" /> : <PosterFallback />}
            <MovieMeta>
              <MovieTitle numberOfLines={2}>{media.title}</MovieTitle>
              {media.year ? <MovieYear>{media.year}</MovieYear> : null}
            </MovieMeta>
          </MovieCard>
        ) : null}

        <Segment>
          {media ? (
            <SegmentButton $active={mode === "create"} onPress={() => setMode("create")}>
              <SegmentText $active={mode === "create"}>Start a room</SegmentText>
            </SegmentButton>
          ) : null}
          <SegmentButton $active={mode === "join"} onPress={() => setMode("join")}>
            <SegmentText $active={mode === "join"}>Join with code</SegmentText>
          </SegmentButton>
        </Segment>

        <FieldLabel>Your nickname for this session</FieldLabel>
        <Field
          value={nickname}
          onChangeText={setNickname}
          placeholder="e.g. Night Owl"
          placeholderTextColor={theme.colors.textTertiary}
          maxLength={20}
          autoCapitalize="words"
        />

        {mode === "join" ? (
          <>
            <FieldLabel>Room code</FieldLabel>
            <Field
              value={code}
              onChangeText={(text) => setCode(normalizeRoomCode(text))}
              placeholder="6-character code"
              placeholderTextColor={theme.colors.textTertiary}
              autoCapitalize="characters"
              maxLength={6}
              style={{ letterSpacing: 6, fontWeight: "700" }}
            />
          </>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Primary onPress={handleSubmit} disabled={!canSubmit || busy} $enabled={canSubmit && !busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <PrimaryText>{mode === "create" ? "Create room" : "Join room"}</PrimaryText>
          )}
        </Primary>
      </Content>
    </SafeContainer>
  );
}

const Header = styled(View)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
`;

const HeaderTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 17px;
  font-weight: 700;
`;

const Content = styled(View)`
  padding: 16px 20px;
`;

const Hero = styled(View)`
  align-items: center;
  padding: 10px 0 22px 0;
`;

const HeroTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 20px;
  font-weight: 800;
  margin-top: 10px;
`;

const HeroSub = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  margin-top: 6px;
  text-align: center;
`;

const MovieCard = styled(View)`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 14px;
  background-color: ${({ theme }) => theme.colors.surface};
  margin-bottom: 18px;
`;

const Poster = styled(Image)`
  width: 54px;
  height: 80px;
  border-radius: 8px;
`;

const PosterFallback = styled(View)`
  width: 54px;
  height: 80px;
  border-radius: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const MovieMeta = styled(View)`
  flex: 1;
`;

const MovieTitle = styled(Text)`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 15px;
  font-weight: 700;
`;

const MovieYear = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  margin-top: 2px;
`;

const Segment = styled(View)`
  flex-direction: row;
  gap: 8px;
  margin-bottom: 20px;
`;

const SegmentButton = styled(TouchableOpacity)<{ $active: boolean }>`
  flex: 1;
  padding: 12px;
  border-radius: 12px;
  align-items: center;
  background-color: ${({ $active, theme }) => ($active ? theme.colors.primarySoftStrong : theme.colors.surface)};
  border-width: 1px;
  border-color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.border)};
`;

const SegmentText = styled(Text)<{ $active: boolean }>`
  color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.textSecondary)};
  font-weight: 700;
  font-size: 13px;
`;

const FieldLabel = styled(Text)`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  margin-bottom: 8px;
  margin-top: 4px;
`;

const Field = styled(TextInput)`
  height: 50px;
  border-radius: 12px;
  padding: 0 16px;
  margin-bottom: 16px;
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-size: 15px;
`;

const ErrorText = styled(Text)`
  color: #e57373;
  font-size: 13px;
  margin-bottom: 12px;
`;

const Primary = styled(TouchableOpacity)<{ $enabled: boolean }>`
  height: 52px;
  border-radius: 26px;
  align-items: center;
  justify-content: center;
  margin-top: 6px;
  background-color: ${({ $enabled, theme }) => ($enabled ? theme.colors.primary : theme.colors.surfaceHigh)};
`;

const PrimaryText = styled(Text)`
  color: ${({ theme }) => theme.colors.textOnPrimary};
  font-size: 16px;
  font-weight: 800;
`;
