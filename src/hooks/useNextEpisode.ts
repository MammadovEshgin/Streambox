import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { VideoPlayer } from "expo-video";

import { getSeriesDetails, getSeriesSeasonEpisodes, type SeriesSeason } from "../api/tmdb";
import {
  createNextEpisodeCountdownState,
  nextEpisodeCountdownReducer,
  shouldShowNextEpisode,
} from "../utils/playerProgress";

const AUTO_PLAY_STORAGE_KEY = "@streambox/auto-play-next";

export type EpisodeSummary = {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  stillPath: string | null;
  runtimeMinutes: number | null;
};

type Params = {
  player: VideoPlayer;
  /** True only on the native series path (not trailers/YouTube). */
  enabled: boolean;
  seriesId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  onSwitchEpisode: (seasonNumber: number, episodeNumber: number) => void;
};

// ---------------------------------------------------------------------------
// Next-episode autonomy for the native series player. Resolves the next episode
// once per target (episode+1 in the season, else season+1 episode 1, else none
// — no pill), drives the pill/countdown via the pure reducer off the player's
// 1s ticks, and persists the auto-play toggle. Season chips for the in-player
// picker come free from the series-details fetch.
// ---------------------------------------------------------------------------
export function useNextEpisode({
  player,
  enabled,
  seriesId,
  seasonNumber,
  episodeNumber,
  onSwitchEpisode,
}: Params) {
  const [nextEpisode, setNextEpisode] = useState<EpisodeSummary | null>(null);
  const [seasons, setSeasons] = useState<SeriesSeason[]>([]);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [countdown, dispatch] = useReducer(nextEpisodeCountdownReducer, undefined, createNextEpisodeCountdownState);

  const autoPlayRef = useRef(autoPlayEnabled);
  autoPlayRef.current = autoPlayEnabled;
  const inZoneRef = useRef(false);
  const targetKey = `${seriesId}:${seasonNumber ?? ""}:${episodeNumber ?? ""}`;

  // Load the persisted auto-play preference once (default ON).
  useEffect(() => {
    void AsyncStorage.getItem(AUTO_PLAY_STORAGE_KEY).then((raw) => {
      if (raw === "false") setAutoPlayEnabled(false);
    });
  }, []);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlayEnabled((current) => {
      const next = !current;
      void AsyncStorage.setItem(AUTO_PLAY_STORAGE_KEY, next ? "true" : "false").catch(() => undefined);
      return next;
    });
  }, []);

  // Season list for the picker (independent of next-episode resolution).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getSeriesDetails(String(seriesId))
      .then((details) => {
        if (!cancelled) setSeasons(details.seasons.filter((s) => s.seasonNumber > 0 && s.episodeCount > 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, seriesId]);

  // Resolve the next episode for the current target; reset the pill state.
  useEffect(() => {
    inZoneRef.current = false;
    dispatch({ type: "reset" });
    if (!enabled || typeof seasonNumber !== "number" || typeof episodeNumber !== "number") {
      setNextEpisode(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const episodes = await getSeriesSeasonEpisodes(String(seriesId), seasonNumber);
        let next = episodes.find((e) => e.episodeNumber === episodeNumber + 1) ?? null;
        if (!next) {
          const details = await getSeriesDetails(String(seriesId));
          const nextSeason = details.seasons.find(
            (s) => s.seasonNumber === seasonNumber + 1 && s.episodeCount > 0
          );
          if (nextSeason) {
            const rolloverEpisodes = await getSeriesSeasonEpisodes(String(seriesId), nextSeason.seasonNumber);
            next = rolloverEpisodes.find((e) => e.episodeNumber === 1) ?? rolloverEpisodes[0] ?? null;
          }
        }
        if (cancelled) return;
        setNextEpisode(
          next
            ? {
                seasonNumber: next.seasonNumber,
                episodeNumber: next.episodeNumber,
                name: next.name,
                stillPath: next.stillPath,
                runtimeMinutes: next.runtimeMinutes,
              }
            : null
        );
      } catch {
        if (!cancelled) setNextEpisode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, seriesId, seasonNumber, episodeNumber]);

  const playNext = useCallback(() => {
    if (nextEpisode) onSwitchEpisode(nextEpisode.seasonNumber, nextEpisode.episodeNumber);
  }, [nextEpisode, onSwitchEpisode]);
  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;

  // Drive the pill off the player's ticks (+ immediate on playToEnd).
  useEffect(() => {
    if (!enabled || !nextEpisode) return;

    const evaluate = (positionSeconds: number, durationSeconds: number) => {
      const inZone = shouldShowNextEpisode({ positionSeconds, durationSeconds });
      if (inZone && !inZoneRef.current) {
        inZoneRef.current = true;
        dispatch({ type: "show", autoPlay: autoPlayRef.current });
      } else if (!inZone && inZoneRef.current) {
        inZoneRef.current = false;
        dispatch({ type: "hide" });
      }
    };

    try {
      player.timeUpdateEventInterval = 1;
    } catch {
      /* torn down */
    }

    const timeSub = player.addListener("timeUpdate", (ev: { currentTime?: number }) => {
      const position = typeof ev?.currentTime === "number" ? ev.currentTime : NaN;
      if (!Number.isFinite(position)) return;
      let duration = 0;
      try {
        duration = player.duration;
      } catch {
        /* torn down */
      }
      evaluate(position, duration);
    });

    const endSub = player.addListener("playToEnd", () => {
      inZoneRef.current = true;
      dispatch({ type: "show", autoPlay: autoPlayRef.current });
    });

    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [player, enabled, nextEpisode, targetKey]);

  // 1s countdown ticks while auto-advancing.
  useEffect(() => {
    if (countdown.phase !== "counting") return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(timer);
  }, [countdown.phase]);

  // Countdown completed → switch.
  useEffect(() => {
    if (countdown.phase === "fired") {
      playNextRef.current();
      dispatch({ type: "reset" });
    }
  }, [countdown.phase]);

  const cancelCountdown = useCallback(() => dispatch({ type: "cancel" }), []);

  return {
    nextEpisode,
    seasons,
    countdown,
    autoPlayEnabled,
    toggleAutoPlay,
    cancelCountdown,
    playNext,
  };
}
