import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";
import {
  getHydratedMediaItemsFromCache,
  hydrateMediaIds,
} from "../../services/mediaHydration";
import { formatPlaybackTime, type ContinueWatchingEntry } from "../../utils/continueWatching";
import { CachedRemoteImage } from "../common/CachedRemoteImage";

const CardRoot = styled.Pressable`
  margin-top: 28px;
  flex-direction: row;
  align-items: center;
  border-radius: 16px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  padding: 10px;
`;

const PosterFrame = styled.View`
  width: 52px;
  height: 78px;
  border-radius: 10px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
`;

const PosterImage = styled(CachedRemoteImage)`
  width: 100%;
  height: 100%;
`;

const PosterFallback = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Info = styled.View`
  flex: 1;
  margin-left: 12px;
  margin-right: 10px;
`;

const Eyebrow = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 10px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
`;

const Title = styled.Text`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 15px;
  line-height: 19px;
  letter-spacing: -0.2px;
`;

const Meta = styled.Text`
  margin-top: 3px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
`;

const ProgressTrack = styled.View`
  margin-top: 8px;
  height: 3px;
  border-radius: 2px;
  overflow: hidden;
  background-color: ${({ theme }) => theme.colors.surfaceRaised};
`;

const ProgressFill = styled.View<{ $ratio: number }>`
  width: ${({ $ratio }) => Math.round($ratio * 100)}%;
  height: 100%;
  border-radius: 2px;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const ContinueButton = styled.Pressable`
  flex-direction: row;
  align-items: center;
  min-height: 38px;
  border-radius: 10px;
  padding: 9px 13px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.primary};
  background-color: ${({ theme }) => theme.colors.primarySoftStrong};
`;

const ContinueLabel = styled.Text`
  margin-left: 6px;
  color: ${({ theme }) => theme.colors.primary};
  font-family: Outfit_600SemiBold;
  font-size: 13px;
`;

type Props = {
  entry: ContinueWatchingEntry;
  onContinue: () => void;
  onPressCard: () => void;
};

export function ContinueWatchingCard({ entry, onContinue, onPressCard }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [posterPath, setPosterPath] = useState<string | null>(null);

  // The entry stores only playback identity; the poster comes from the shared
  // hydration cache (synchronously when warm, one cached TMDB fetch otherwise).
  useEffect(() => {
    let cancelled = false;
    const movieIds = entry.mediaType === "movie" ? [entry.tmdbId] : [];
    const seriesIds = entry.mediaType === "tv" ? [entry.tmdbId] : [];

    const cached = getHydratedMediaItemsFromCache(movieIds, seriesIds);
    if (cached[0]?.posterPath) {
      setPosterPath(cached[0].posterPath);
      return;
    }

    setPosterPath(null);
    hydrateMediaIds(movieIds, seriesIds)
      .then((items) => {
        if (!cancelled && items[0]?.posterPath) setPosterPath(items[0].posterPath);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.mediaType, entry.tmdbId]);

  const time = formatPlaybackTime(entry.positionSeconds);
  const meta =
    entry.mediaType === "tv" && entry.seasonNumber != null && entry.episodeNumber != null
      ? `${t("continueWatching.episodeTag", { season: entry.seasonNumber, episode: entry.episodeNumber })} • ${time}`
      : t("continueWatching.leftAt", { time });
  const progressRatio =
    entry.durationSeconds > 0 ? Math.min(1, entry.positionSeconds / entry.durationSeconds) : null;
  const posterUrl = getTmdbImageUrl(posterPath, "w185");

  return (
    <CardRoot onPress={onPressCard} accessibilityRole="button" accessibilityLabel={t("continueWatching.label")}>
      <PosterFrame>
        {posterUrl ? (
          <PosterImage uri={posterUrl} contentFit="cover" />
        ) : (
          <PosterFallback>
            <Feather name="film" size={18} color={theme.colors.textSecondary} />
          </PosterFallback>
        )}
      </PosterFrame>

      <Info>
        <Eyebrow>{t("continueWatching.label")}</Eyebrow>
        <Title numberOfLines={1}>{entry.title}</Title>
        <Meta numberOfLines={1}>{meta}</Meta>
        {progressRatio !== null && (
          <ProgressTrack>
            <ProgressFill $ratio={progressRatio} />
          </ProgressTrack>
        )}
      </Info>

      <ContinueButton
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel={t("continueWatching.cta")}
      >
        <Feather name="play" size={14} color={theme.colors.primary} />
        <ContinueLabel>{t("continueWatching.cta")}</ContinueLabel>
      </ContinueButton>
    </CardRoot>
  );
}
