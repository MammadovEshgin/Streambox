import { Feather } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { getSeriesSeasonEpisodes, getTmdbImageUrl, type SeriesEpisode, type SeriesSeason } from "../../api/tmdb";

// In-player episode picker — a right-side drawer (NOT an RN Modal; that Android
// dual-window bug is documented in the repo). Season chips + episode rows with
// still thumbnail, number/title, runtime, a watched tick, and a "playing now"
// highlight. Tap an episode → switch in place. Landscape-friendly (~44% width).

const { width: SCREEN_W } = Dimensions.get("window");
const SHEET_W = Math.min(Math.max(SCREEN_W * 0.44, 300), 460);

type Props = {
  visible: boolean;
  onClose: () => void;
  seriesId: number;
  seasons: SeriesSeason[];
  currentSeason: number;
  currentEpisode: number;
  autoPlayEnabled: boolean;
  onToggleAutoPlay: () => void;
  isEpisodeWatched: (seriesId: number, season: number, episode: number) => boolean;
  onSelectEpisode: (season: number, episode: number) => void;
};

export function EpisodePickerSheet({
  visible,
  onClose,
  seriesId,
  seasons,
  currentSeason,
  currentEpisode,
  autoPlayEnabled,
  onToggleAutoPlay,
  isEpisodeWatched,
  onSelectEpisode,
}: Props) {
  const { t } = useTranslation();
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);
  const [episodes, setEpisodes] = useState<SeriesEpisode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) setSelectedSeason(currentSeason);
  }, [visible, currentSeason]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void getSeriesSeasonEpisodes(String(seriesId), selectedSeason)
      .then((rows) => {
        if (!cancelled) setEpisodes(rows);
      })
      .catch(() => {
        if (!cancelled) setEpisodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, seriesId, selectedSeason]);

  if (!visible) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { width: SHEET_W }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("playerAutonomy.episodes")}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.autoRow}>
          <Text style={styles.autoLabel}>{t("playerAutonomy.autoPlayNext")}</Text>
          <Switch value={autoPlayEnabled} onValueChange={onToggleAutoPlay} />
        </View>

        {seasons.length > 1 ? (
          <View style={styles.seasonRow}>
            <FlashList
              data={seasons}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(s) => String(s.seasonNumber)}
              renderItem={({ item }) => {
                const active = item.seasonNumber === selectedSeason;
                return (
                  <Pressable
                    style={[styles.seasonChip, active && styles.seasonChipActive]}
                    onPress={() => setSelectedSeason(item.seasonNumber)}
                  >
                    <Text style={[styles.seasonChipText, active && styles.seasonChipTextActive]}>
                      {t("playerAutonomy.season", { number: item.seasonNumber })}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        ) : null}

        <FlashList
          data={episodes}
          keyExtractor={(e) => `${e.seasonNumber}-${e.episodeNumber}`}
          extraData={`${currentSeason}-${currentEpisode}-${loading}`}
          renderItem={({ item }) => {
            const isCurrent = item.seasonNumber === currentSeason && item.episodeNumber === currentEpisode;
            const watched = isEpisodeWatched(seriesId, item.seasonNumber, item.episodeNumber);
            const still = getTmdbImageUrl(item.stillPath, "w300");
            return (
              <Pressable
                style={[styles.epRow, isCurrent && styles.epRowCurrent]}
                onPress={() => onSelectEpisode(item.seasonNumber, item.episodeNumber)}
                disabled={isCurrent}
              >
                <View style={styles.thumb}>
                  {still ? <Image source={{ uri: still }} style={styles.thumbImg} resizeMode="cover" /> : null}
                  {isCurrent ? (
                    <View style={styles.playingBadge}>
                      <Feather name="play" size={12} color="#fff" />
                    </View>
                  ) : null}
                </View>
                <View style={styles.epInfo}>
                  <Text style={styles.epTitle} numberOfLines={1}>
                    {t("playerAutonomy.episodeShort", { number: item.episodeNumber })}
                    {item.name ? ` · ${item.name}` : ""}
                  </Text>
                  <Text style={styles.epMeta} numberOfLines={1}>
                    {isCurrent ? t("playerAutonomy.playingNow") : ""}
                    {item.runtimeMinutes ? `${isCurrent ? " · " : ""}${item.runtimeMinutes}m` : ""}
                  </Text>
                </View>
                {watched ? <Feather name="check" size={16} color="#4ade80" /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 40, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    height: "100%",
    backgroundColor: "#0D100F",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.12)",
    paddingTop: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerTitle: { color: "#fff", fontFamily: "Outfit_700Bold", fontSize: 17 },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  autoLabel: { color: "#F6F7F4", fontFamily: "Outfit_500Medium", fontSize: 13 },
  seasonRow: { paddingVertical: 10, paddingLeft: 12, height: 52 },
  seasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  seasonChipActive: { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.4)" },
  seasonChipText: { color: "rgba(255,255,255,0.75)", fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  seasonChipTextActive: { color: "#fff" },
  epRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8 },
  epRowCurrent: { backgroundColor: "rgba(255,255,255,0.06)" },
  thumb: {
    width: 64,
    height: 40,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#1B211E",
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: 64, height: 40 },
  playingBadge: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  epInfo: { flex: 1 },
  epTitle: { color: "#F6F7F4", fontFamily: "Outfit_600SemiBold", fontSize: 13 },
  epMeta: { color: "rgba(255,255,255,0.55)", fontFamily: "Outfit_400Regular", fontSize: 11, marginTop: 2 },
});
