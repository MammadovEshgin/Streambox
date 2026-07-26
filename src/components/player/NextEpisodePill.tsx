import { Feather } from "@expo/vector-icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing,
  FadeInUp,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { getTmdbImageUrl } from "../../api/tmdb";
import type { EpisodeSummary } from "../../hooks/useNextEpisode";
import {
  AUTO_ADVANCE_COUNTDOWN_SECONDS,
  isNextEpisodePillVisible,
  type NextEpisodeCountdownState,
} from "../../utils/playerProgress";

// End-of-episode card (bottom-right, Netflix/HBO pattern): next-episode still +
// title, a "Watch credits" ghost action while auto-advancing, and a solid
// primary button with a linear sweep that tracks the countdown. After cancel
// (or with auto-play off) the same card stays as a manual "Play now" button.

type Props = {
  countdown: NextEpisodeCountdownState;
  nextEpisode: EpisodeSummary;
  onPlayNext: () => void;
  onCancel: () => void;
};

export function NextEpisodePill({ countdown, nextEpisode, onPlayNext, onCancel }: Props) {
  const { t } = useTranslation();
  const counting = countdown.phase === "counting";
  const sweep = useSharedValue(0);

  // Advance the sweep one linear second per reducer tick so it stays in lock
  // step with the countdown (robust against JS-timer drift); reset on stop.
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
    <Reanimated.View
      entering={FadeInUp.duration(240)}
      exiting={FadeOut.duration(160)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <View style={styles.thumb}>
            {still ? (
              <Image source={{ uri: still }} style={styles.thumbImg} resizeMode="cover" />
            ) : (
              <Feather name="film" size={18} color="rgba(255,255,255,0.4)" />
            )}
          </View>
          <View style={styles.infoText}>
            <Text style={styles.kicker} numberOfLines={1}>
              {counting
                ? t("playerAutonomy.nextEpisodeIn", { seconds: countdown.secondsLeft })
                : t("playerAutonomy.upNext")}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {episodeLabel}
            </Text>
            {nextEpisode.runtimeMinutes ? (
              <Text style={styles.meta}>{nextEpisode.runtimeMinutes}m</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.buttonRow}>
          {counting ? (
            <Pressable style={styles.ghostButton} onPress={onCancel}>
              <Text style={styles.ghostLabel} numberOfLines={1}>
                {t("playerAutonomy.watchCredits")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.primaryButton} onPress={onPlayNext}>
            {counting ? <Reanimated.View style={[styles.primarySweep, sweepStyle]} /> : null}
            <View style={styles.primaryContent}>
              <Feather name="play" size={14} color="#0B0D0C" />
              <Text style={styles.primaryLabel} numberOfLines={1}>
                {t("playerAutonomy.playNow")}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 30,
  },
  card: {
    width: 296,
    borderRadius: 14,
    backgroundColor: "rgba(12,14,13,0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  infoRow: { flexDirection: "row" },
  thumb: {
    width: 104,
    height: 58,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1B211E",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: 104, height: 58 },
  infoText: { flex: 1, marginLeft: 12, justifyContent: "center" },
  kicker: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10.5,
    letterSpacing: 0.6,
  },
  title: {
    color: "#F6F7F4",
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    lineHeight: 17,
    marginTop: 3,
  },
  meta: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  buttonRow: { flexDirection: "row", marginTop: 12, gap: 8 },
  ghostButton: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  ghostLabel: { color: "#fff", fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  primaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  primarySweep: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(11,13,12,0.22)",
  },
  primaryContent: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  primaryLabel: { color: "#0B0D0C", fontFamily: "Outfit_700Bold", fontSize: 12.5 },
});
