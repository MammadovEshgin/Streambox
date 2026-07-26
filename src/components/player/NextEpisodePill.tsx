import { Feather } from "@expo/vector-icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "styled-components/native";

import { getTmdbImageUrl } from "../../api/tmdb";
import type { EpisodeSummary } from "../../hooks/useNextEpisode";
import {
  AUTO_ADVANCE_COUNTDOWN_SECONDS,
  isNextEpisodePillVisible,
  type NextEpisodeCountdownState,
} from "../../utils/playerProgress";

// End-of-episode "Up next" panel — vertically centered on the right edge (clear
// of the Android bottom system bar). A still-image preview, the episode title,
// and two actions: a ghost "Watch credits" while auto-advancing and a solid
// "Play now" whose fill sweeps in time with the countdown. Small 4px radii to
// sit flush with the player chrome; the theme accent ties it to the app.

type Props = {
  countdown: NextEpisodeCountdownState;
  nextEpisode: EpisodeSummary;
  onPlayNext: () => void;
  onCancel: () => void;
};

export function NextEpisodePill({ countdown, nextEpisode, onPlayNext, onCancel }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const counting = countdown.phase === "counting";
  const sweep = useSharedValue(0);

  // Advance the fill one linear second per reducer tick so it tracks the
  // countdown exactly (robust against JS-timer drift); reset when not counting.
  useEffect(() => {
    if (countdown.phase !== "counting") {
      sweep.value = 0;
      return;
    }
    const target =
      (AUTO_ADVANCE_COUNTDOWN_SECONDS - countdown.secondsLeft + 1) / AUTO_ADVANCE_COUNTDOWN_SECONDS;
    sweep.value = withTiming(Math.min(target, 1), { duration: 1000, easing: Easing.linear });
  }, [countdown.phase, countdown.secondsLeft, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({ width: `${sweep.value * 100}%` }));

  if (!isNextEpisodePillVisible(countdown)) return null;

  const still = getTmdbImageUrl(nextEpisode.stillPath, "w300");
  const episodeLabel = nextEpisode.name
    ? `${t("playerAutonomy.episodeShort", { number: nextEpisode.episodeNumber })} · ${nextEpisode.name}`
    : t("playerAutonomy.episodeShort", { number: nextEpisode.episodeNumber });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Reanimated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.card}>
        <View style={styles.preview}>
          {still ? (
            <Image source={{ uri: still }} style={styles.previewImg} resizeMode="cover" />
          ) : (
            <View style={styles.previewFallback}>
              <Feather name="film" size={20} color="rgba(255,255,255,0.4)" />
            </View>
          )}
          <View style={[styles.kickerPill, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.kickerText} numberOfLines={1}>
              {counting
                ? t("playerAutonomy.nextEpisodeIn", { seconds: countdown.secondsLeft })
                : t("playerAutonomy.upNext")}
            </Text>
          </View>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {episodeLabel}
        </Text>
        {nextEpisode.runtimeMinutes ? (
          <Text style={styles.meta}>{nextEpisode.runtimeMinutes}m</Text>
        ) : null}

        <View style={styles.buttonRow}>
          {counting ? (
            <Pressable style={styles.ghostButton} onPress={onCancel}>
              <Text style={styles.ghostLabel} numberOfLines={1}>
                {t("playerAutonomy.watchCredits")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.primaryButton} onPress={onPlayNext}>
            {counting ? (
              <Reanimated.View style={[styles.primarySweep, { backgroundColor: theme.colors.primary }, sweepStyle]} />
            ) : null}
            <View style={styles.primaryContent}>
              <Feather name="play" size={13} color="#0B0D0C" />
              <Text style={styles.primaryLabel} numberOfLines={1}>
                {t("playerAutonomy.playNow")}
              </Text>
            </View>
          </Pressable>
        </View>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Vertically centered against the right edge; a modest right inset keeps it
  // clear of rounded corners / gesture areas without hiding behind them.
  wrap: {
    position: "absolute",
    right: 24,
    top: 0,
    bottom: 0,
    zIndex: 30,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  card: {
    width: 240,
    borderRadius: 4,
    backgroundColor: "rgba(10,12,11,0.93)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  preview: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "#161B18",
  },
  previewImg: { width: "100%", height: "100%" },
  previewFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  kickerPill: {
    position: "absolute",
    left: 8,
    top: 8,
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: "88%",
  },
  kickerText: {
    color: "#0B0D0C",
    fontFamily: "Outfit_700Bold",
    fontSize: 10.5,
    letterSpacing: 0.3,
  },
  title: {
    color: "#F6F7F4",
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    lineHeight: 17,
    marginTop: 10,
  },
  meta: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    marginTop: 3,
  },
  buttonRow: { flexDirection: "row", marginTop: 12, gap: 8 },
  ghostButton: {
    flex: 1,
    height: 36,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  ghostLabel: { color: "#fff", fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  primaryButton: {
    flex: 1.1,
    height: 36,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  primarySweep: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.35 },
  primaryContent: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  primaryLabel: { color: "#0B0D0C", fontFamily: "Outfit_700Bold", fontSize: 12.5 },
});
