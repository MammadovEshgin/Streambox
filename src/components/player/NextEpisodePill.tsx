import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { EpisodeSummary } from "../../hooks/useNextEpisode";
import { isNextEpisodePillVisible, type NextEpisodeCountdownState } from "../../utils/playerProgress";

// In-player "Next Episode" pill (bottom-right, above the system controls). While
// auto-advancing it becomes a tap-to-cancel countdown; otherwise it's a manual
// "Next Episode" button. Series-only; the parent gates on a resolved next
// episode.

type Props = {
  countdown: NextEpisodeCountdownState;
  nextEpisode: EpisodeSummary;
  onPlayNext: () => void;
  onCancel: () => void;
};

export function NextEpisodePill({ countdown, nextEpisode, onPlayNext, onCancel }: Props) {
  const { t } = useTranslation();
  if (!isNextEpisodePillVisible(countdown)) return null;

  const counting = countdown.phase === "counting";
  const label = nextEpisode.name
    ? `${t("playerAutonomy.episodeShort", { number: nextEpisode.episodeNumber })} · ${nextEpisode.name}`
    : t("playerAutonomy.episodeShort", { number: nextEpisode.episodeNumber });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable style={styles.pill} onPress={counting ? onCancel : onPlayNext}>
        {counting ? (
          <>
            <Feather name="x" size={14} color="#fff" style={styles.icon} />
            <View>
              <Text style={styles.title}>
                {t("playerAutonomy.nextEpisodeIn", { seconds: countdown.secondsLeft })}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {t("playerAutonomy.cancel")}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Feather name="skip-forward" size={15} color="#fff" style={styles.icon} />
            <View>
              <Text style={styles.title}>{t("playerAutonomy.nextEpisode")}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 18,
    bottom: 84,
    zIndex: 30,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 260,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  icon: { marginRight: 10 },
  title: { color: "#fff", fontFamily: "Outfit_700Bold", fontSize: 13 },
  sub: { color: "rgba(255,255,255,0.7)", fontFamily: "Outfit_400Regular", fontSize: 11, maxWidth: 200 },
});
