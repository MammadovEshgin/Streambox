import { useEffect, useRef } from "react";
import type { VideoPlayer } from "expo-video";

import { getMovieDetails, getSeriesDetails, type MediaType } from "../api/tmdb";
import { accumulateWatchedDelta } from "../utils/continueWatching";
import { shouldAutoMarkWatched } from "../utils/playerProgress";
import { withTimeout, WATCH_LOG_DETAILS_TIMEOUT_MS } from "../utils/watchLogging";
import { useSeasonWatchHistorySync } from "./useSeasonWatchHistorySync";
import { useWatchHistory } from "./useWatchHistory";
import { useWatchedEpisodes } from "./useWatchedEpisodes";

type UseAutoMarkWatchedParams = {
  player: VideoPlayer;
  /** True only while the resolved source plays natively (movies + episodes + watch rooms; excludes trailers/YouTube). */
  enabled: boolean;
  mediaType: MediaType;
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  /** What the player already knows, for logging without a details fetch. */
  title?: string;
  year?: string | number | null;
};

// ---------------------------------------------------------------------------
// Auto-mark-watched for the native player. Subscribes to the same 1s timeUpdate
// ticks as continue-watching, accumulates REAL engaged time via
// accumulateWatchedDelta (seeks don't count), and fires ONCE per player session
// when shouldAutoMarkWatched (>=95% + >=2min engaged) becomes true or the video
// plays to end. Reuses the exact manual mark-watched builders
// (saveMovieToWatchHistory / saveSeriesToWatchHistory + toggleEpisodeWatched)
// so the auto path produces identical rich entries. Idempotent against
// already-watched titles (upsert semantics).
// ---------------------------------------------------------------------------
export function useAutoMarkWatched({
  player,
  enabled,
  mediaType,
  tmdbId,
  seasonNumber,
  episodeNumber,
  title,
  year,
}: UseAutoMarkWatchedParams) {
  const { saveMovieToWatchHistory, saveSeriesToWatchHistory, saveFallbackToWatchHistory } = useWatchHistory();
  const { isEpisodeWatched, toggleEpisodeWatched, watchedEpisodes } = useWatchedEpisodes();
  const syncSeasonWatchHistory = useSeasonWatchHistorySync();

  const titleRef = useRef({ title, year });
  titleRef.current = { title, year };
  const firedRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastPositionRef = useRef<number | null>(null);
  const engagedSecondsRef = useRef(0);
  const durationRef = useRef(0);

  // Reset the once-per-session guard + counters whenever the target changes
  // (episode switch via setParams re-runs the player in place).
  const targetKey = `${mediaType}:${tmdbId}:${seasonNumber ?? ""}:${episodeNumber ?? ""}`;
  const saveRef = useRef({
    saveMovieToWatchHistory,
    saveSeriesToWatchHistory,
    saveFallbackToWatchHistory,
    isEpisodeWatched,
    toggleEpisodeWatched,
    syncSeasonWatchHistory,
    watchedEpisodes,
  });
  saveRef.current = {
    saveMovieToWatchHistory,
    saveSeriesToWatchHistory,
    saveFallbackToWatchHistory,
    isEpisodeWatched,
    toggleEpisodeWatched,
    syncSeasonWatchHistory,
    watchedEpisodes,
  };

  useEffect(() => {
    firedRef.current = false;
    inFlightRef.current = false;
    lastPositionRef.current = null;
    engagedSecondsRef.current = 0;
    durationRef.current = 0;
  }, [targetKey]);

  useEffect(() => {
    if (!enabled) return;

    const fire = () => {
      if (firedRef.current || inFlightRef.current) return;
      inFlightRef.current = true;
      firedRef.current = true;
      const watchedAt = Date.now();
      void (async () => {
        try {
          // Without details (offline, TMDB unreachable) the film is still
          // logged from what the player knows; before, the save waited for a
          // fetch that could fail on the last tick, and nothing was logged.
          const known = titleRef.current;
          const saveFallback = () =>
            known.title && known.title.trim().length > 0
              ? saveRef.current.saveFallbackToWatchHistory({ id: tmdbId, mediaType, title: known.title, year: known.year }, watchedAt)
              : Promise.reject(new Error("no details and no title to log"));
          if (mediaType === "movie") {
            let details: Awaited<ReturnType<typeof getMovieDetails>> | null = null;
            try {
              details = await withTimeout(getMovieDetails(String(tmdbId)), WATCH_LOG_DETAILS_TIMEOUT_MS);
            } catch {
              details = null;
            }
            if (details) await saveRef.current.saveMovieToWatchHistory(details, watchedAt);
            else await saveFallback();
          } else {
            // Mark the specific episode (set, not toggle) and upsert the series
            // into watch history the same way the episode-watched UI does.
            let episodeState = saveRef.current.watchedEpisodes;
            if (
              typeof seasonNumber === "number" &&
              typeof episodeNumber === "number" &&
              !saveRef.current.isEpisodeWatched(tmdbId, seasonNumber, episodeNumber)
            ) {
              episodeState = await saveRef.current.toggleEpisodeWatched(tmdbId, seasonNumber, episodeNumber);
            }
            let details: Awaited<ReturnType<typeof getSeriesDetails>> | null = null;
            try {
              details = await withTimeout(getSeriesDetails(String(tmdbId)), WATCH_LOG_DETAILS_TIMEOUT_MS);
            } catch {
              details = null;
            }
            if (!details) {
              // The episode tick is saved; log the series without details and
              // let the season reconcile run on the next watched episode.
              await saveFallback();
              return;
            }
            await saveRef.current.saveSeriesToWatchHistory(details, watchedAt);
            // Finishing the last episode of a season should log the SEASON too,
            // not just the series title — otherwise Stats and the season rail
            // stay blank for a season the user demonstrably finished.
            if (typeof seasonNumber === "number") {
              await saveRef.current.syncSeasonWatchHistory(details, episodeState, seasonNumber);
            }
          }
        } catch {
          // A failed fetch/save shouldn't wedge the session; allow a retry on a
          // later tick by clearing the fired guard.
          firedRef.current = false;
        } finally {
          inFlightRef.current = false;
        }
      })();
    };

    const evaluate = () => {
      if (
        shouldAutoMarkWatched({
          positionSeconds: lastPositionRef.current ?? 0,
          durationSeconds: durationRef.current,
          engagedSeconds: engagedSecondsRef.current,
        })
      ) {
        fire();
      }
    };

    try {
      player.timeUpdateEventInterval = 1;
    } catch {
      /* expo-video already torn down */
    }

    const timeSub = player.addListener("timeUpdate", (ev: { currentTime?: number }) => {
      const position = typeof ev?.currentTime === "number" ? ev.currentTime : NaN;
      if (!Number.isFinite(position) || position < 0) return;
      engagedSecondsRef.current += accumulateWatchedDelta(lastPositionRef.current, position);
      lastPositionRef.current = position;
      try {
        const duration = player.duration;
        if (Number.isFinite(duration) && duration > 0) durationRef.current = duration;
      } catch {
        /* expo-video already torn down */
      }
      evaluate();
    });

    const endSub = player.addListener("playToEnd", () => {
      // playToEnd also marks watched, subject to the same engagement floor.
      if (durationRef.current > 0 && lastPositionRef.current === null) {
        lastPositionRef.current = durationRef.current;
      }
      evaluate();
    });

    return () => {
      timeSub.remove();
      endSub.remove();
    };
  }, [player, enabled, mediaType, tmdbId, seasonNumber, episodeNumber]);
}
