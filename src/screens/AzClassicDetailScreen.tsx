import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled, { useTheme } from "styled-components/native";

import { getAzClassicById } from "../api/azClassics";
import type { CastMember, CrewMember } from "../api/tmdb";
import { getTmdbImageUrl } from "../api/tmdb";
import { CachedRemoteImage } from "../components/common/CachedRemoteImage";
import { CastCrewSection } from "../components/detail/CastCrewSection";
import { HomeStackParamList } from "../navigation/types";

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const HeroWrap = styled.View`
  width: 100%;
  height: 420px;
`;

const HeroImage = styled(CachedRemoteImage)`
  width: 100%;
  height: 100%;
`;

const HeroPlaceholder = styled.View`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
`;

const HeroShade = styled(LinearGradient)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 260px;
`;

const BackButton = styled.Pressable`
  position: absolute;
  left: 16px;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.5);
`;

const Body = styled.View`
  padding: 0 16px 40px;
  margin-top: -70px;
`;

const Title = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 26px;
  line-height: 31px;
  letter-spacing: -0.6px;
`;

const MetaRow = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: 0.2px;
`;

const PlayButton = styled.Pressable<{ $disabled: boolean }>`
  margin-top: 18px;
  height: 50px;
  border-radius: 3px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: ${({ $disabled, theme }) => ($disabled ? theme.colors.surfaceRaised : theme.colors.primary)};
  border-width: ${({ $disabled }) => ($disabled ? "1px" : "0px")};
  border-color: ${({ theme }) => theme.colors.border};
`;

const PlayButtonText = styled.Text<{ $disabled: boolean }>`
  margin-left: 8px;
  color: ${({ $disabled, theme }) => ($disabled ? theme.colors.textSecondary : theme.colors.textOnPrimary)};
  font-family: Outfit_700Bold;
  font-size: 16px;
  letter-spacing: 0.2px;
`;

const SectionTitle = styled.Text`
  margin-top: 26px;
  margin-bottom: 9px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 22px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const SynopsisText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 15px;
  line-height: 23px;
`;

const CastWrap = styled.View`
  height: 200px;
`;

const MissingRoot = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.background};
`;

const MissingText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

function formatRuntime(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

type AzClassicDetailProps = NativeStackScreenProps<HomeStackParamList, "AzClassicDetail">;

export function AzClassicDetailScreen({ route, navigation }: AzClassicDetailProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const movie = getAzClassicById(route.params.id);

  const cast = useMemo<CastMember[]>(
    () =>
      (movie?.cast ?? []).map((member, index) => ({
        id: index,
        name: member.name,
        character: member.character ?? "",
        profilePath: member.photoPath,
        gender: null,
      })),
    [movie]
  );

  const crew = useMemo<CrewMember[]>(
    () =>
      (movie?.crew ?? []).map((member, index) => ({
        id: index,
        name: member.name,
        job: member.role ?? "",
        department: member.department ?? "",
        profilePath: member.photoPath,
      })),
    [movie]
  );

  if (!movie) {
    return (
      <MissingRoot>
        <BackButton style={{ top: insets.top + 8 }} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={18} color="#FFFFFF" />
        </BackButton>
        <MissingText>{t("azClassic.notFound")}</MissingText>
      </MissingRoot>
    );
  }

  const posterUri = getTmdbImageUrl(movie.posterPath, "w780");
  const runtimeLabel = formatRuntime(movie.runtimeMinutes);
  const metaParts = [
    movie.year ? String(movie.year) : null,
    runtimeLabel,
    movie.genres.length > 0 ? movie.genres.join(", ") : null,
  ].filter(Boolean);
  const canPlay = Boolean(movie.youtubeId);

  const handlePlay = () => {
    if (!movie.youtubeId) {
      return;
    }
    navigation.navigate("Player", {
      mediaType: "movie",
      tmdbId: movie.tmdbId ? String(movie.tmdbId) : "",
      title: movie.title,
      year: movie.year ? String(movie.year) : null,
      videoId: movie.youtubeId,
      playbackSource: "youtube",
    });
  };

  return (
    <Root>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <HeroWrap>
          {posterUri ? (
            <HeroImage uri={posterUri} contentFit="cover" />
          ) : (
            <HeroPlaceholder>
              <Feather name="film" size={44} color={theme.colors.textSecondary} />
            </HeroPlaceholder>
          )}
          <HeroShade colors={["rgba(0,0,0,0)", theme.colors.background]} />
        </HeroWrap>

        <Body>
          <Title numberOfLines={3}>{movie.title}</Title>
          {metaParts.length > 0 ? <MetaRow>{metaParts.join("  ·  ")}</MetaRow> : null}

          <PlayButton $disabled={!canPlay} disabled={!canPlay} onPress={handlePlay}>
            <Feather
              name={canPlay ? "play" : "slash"}
              size={18}
              color={canPlay ? theme.colors.textOnPrimary : theme.colors.textSecondary}
            />
            <PlayButtonText $disabled={!canPlay}>
              {canPlay ? t("azClassic.playOnYoutube") : t("azClassic.unavailable")}
            </PlayButtonText>
          </PlayButton>

          <SectionTitle>{t("detail.synopsis")}</SectionTitle>
          <SynopsisText>{movie.synopsis || t("detail.noSynopsisAvailable")}</SynopsisText>

          {cast.length > 0 || crew.length > 0 ? (
            <>
              <SectionTitle>{t("detail.castCrew")}</SectionTitle>
              <CastWrap>
                <CastCrewSection cast={cast} crew={crew} />
              </CastWrap>
            </>
          ) : null}
        </Body>
      </ScrollView>

      <BackButton style={{ top: insets.top + 8 }} onPress={() => navigation.goBack()}>
        <Feather name="arrow-left" size={18} color="#FFFFFF" />
      </BackButton>
    </Root>
  );
}
