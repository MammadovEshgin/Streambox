import { useCallback } from "react";

import type { SeriesDetails } from "../api/tmdb";
import { useWatchHistory } from "./useWatchHistory";
import { isSeasonFullyWatched, type WatchedEpisodeMap } from "../utils/watchedEpisodes";

/**
 * Keeps watch history in step with the watched-episode map.
 *
 * StreamBox records "watched" in two places — the episode map behind the tick
 * marks on SeriesDetail, and watch history behind the Profile watched list and
 * Stats. Only the season-log modal ever wrote both, so ticking episodes (by
 * hand, or automatically at the end of playback) lit a season up as watched on
 * the detail screen while the Profile list stayed empty. That divergence is the
 * bug this hook closes: whenever a season crosses the fully-watched line, its
 * history entry — and the series title entry the Profile grid actually lists —
 * is created or dropped to match.
 *
 * Removal is deliberately limited to entries this path could have produced
 * (watchPrecision "none", i.e. undated). A season the user explicitly dated in
 * the log modal is their record; un-ticking one episode must not delete it.
 */
export function useSeasonWatchHistorySync() {
  const {
    getWatchHistoryEntry,
    getSeriesSeasonWatchEntry,
    saveSeriesSeasonToWatchHistory,
    saveSeriesToWatchHistory,
    removeSeriesSeasonFromWatchHistory,
  } = useWatchHistory();

  return useCallback(
    async (details: SeriesDetails, episodeState: WatchedEpisodeMap, seasonNumber: number) => {
      const season = details.seasons.find((item) => item.seasonNumber === seasonNumber);
      if (!season || season.episodeCount <= 0) return;

      const auditDetails = {
        title: details.title,
        imdbId: details.imdbId,
        posterPath: details.posterPath,
        year: details.firstAirDate ? details.firstAirDate.slice(0, 4) : null,
      };

      const fullyWatched = isSeasonFullyWatched(
        episodeState,
        details.id,
        seasonNumber,
        season.episodeCount
      );
      const existingEntry = getSeriesSeasonWatchEntry(details.id, seasonNumber);

      if (fullyWatched && !existingEntry) {
        await saveSeriesSeasonToWatchHistory(details, season, Date.now(), "none", auditDetails);
        if (!getWatchHistoryEntry(details.id, "tv")) {
          await saveSeriesToWatchHistory(details, Date.now(), auditDetails, { precision: "none" });
        }
        return;
      }

      if (!fullyWatched && existingEntry?.watchPrecision === "none") {
        await removeSeriesSeasonFromWatchHistory(details.id, seasonNumber, auditDetails);
      }
    },
    [
      getSeriesSeasonWatchEntry,
      getWatchHistoryEntry,
      removeSeriesSeasonFromWatchHistory,
      saveSeriesSeasonToWatchHistory,
      saveSeriesToWatchHistory,
    ]
  );
}
