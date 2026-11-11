import { useCallback, useEffect, useRef, useState } from "react";

import { useAppSettings } from "../settings/AppSettingsContext";
import { withLibraryLock } from "../services/libraryLocks";
import { libraryStorage } from "../services/libraryStorage";
import {
  enqueueEpisodeProgressBatch,
  type EpisodeProgressQueueItem,
} from "../services/userDataSync";
import { WATCHED_EPISODES_STORAGE_KEY } from "../services/userDataStorage";
import { buildEpisodeKey, type WatchedEpisodeMap } from "../utils/watchedEpisodes";

export type SeasonEpisodeStateChange = {
  seasonNumber: number;
  episodeNumbers: number[];
  watched: boolean;
};

function parseWatchedEpisodeMap(raw: string | null): WatchedEpisodeMap {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const map: WatchedEpisodeMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === true) map[key] = true;
  }
  return map;
}

type EpisodeMutation = { key: string; watched: boolean; item: EpisodeProgressQueueItem };

export function useWatchedEpisodes() {
  const [watchedEpisodes, setWatchedEpisodes] = useState<WatchedEpisodeMap>({});
  const watchedEpisodesRef = useRef<WatchedEpisodeMap>({});
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  useEffect(() => {
    watchedEpisodesRef.current = watchedEpisodes;
  }, [watchedEpisodes]);

  useEffect(() => {
    let isMounted = true;

    libraryStorage
      .getItem(WATCHED_EPISODES_STORAGE_KEY)
      .then((data) => {
        if (!isMounted) return;
        const next = parseWatchedEpisodeMap(data);
        watchedEpisodesRef.current = next;
        setWatchedEpisodes(next);
      })
      // Keep what is on screen; a failed read must never untick a season.
      .catch((error) => console.error("Failed to load watched episodes", error));

    return () => {
      isMounted = false;
    };
  }, [storageRevision]);

  const getEpisodeKey = useCallback(
    (seriesId: string | number, seasonNumber: number, episodeNumber: number) =>
      buildEpisodeKey(seriesId, seasonNumber, episodeNumber),
    []
  );

  const isEpisodeWatched = useCallback(
    (seriesId: string | number, seasonNumber: number, episodeNumber: number) => {
      const key = getEpisodeKey(seriesId, seasonNumber, episodeNumber);
      return !!watchedEpisodes[key];
    },
    [getEpisodeKey, watchedEpisodes]
  );

  // Every change is applied to the STORED map inside the shared library lock
  // (never to this hook's copy, which another screen or the cloud reconcile
  // may have outdated), and its sync ops are queued in the same lock.
  const applyEpisodeMutations = useCallback(
    async (buildMutations: (current: WatchedEpisodeMap) => EpisodeMutation[]): Promise<WatchedEpisodeMap> => {
      const nextState = await withLibraryLock(WATCHED_EPISODES_STORAGE_KEY, async () => {
        const current = parseWatchedEpisodeMap(await libraryStorage.getItem(WATCHED_EPISODES_STORAGE_KEY));
        const mutations = buildMutations(current);
        const next = { ...current };
        for (const { key, watched } of mutations) {
          if (watched) next[key] = true;
          else delete next[key];
        }
        await libraryStorage.setItem(WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(next));
        await enqueueEpisodeProgressBatch(mutations.map((mutation) => mutation.item));
        return next;
      });
      watchedEpisodesRef.current = nextState;
      setWatchedEpisodes(nextState);
      notifyStorageChanged();
      return nextState;
    },
    [notifyStorageChanged]
  );

  const buildMutation = useCallback(
    (seriesId: string | number, seasonNumber: number, episodeNumber: number, watched: boolean, source: string): EpisodeMutation => ({
      key: getEpisodeKey(seriesId, seasonNumber, episodeNumber),
      watched,
      item: { seriesTmdbId: Number(seriesId), seasonNumber, episodeNumber, isWatched: watched, audit: { source } },
    }),
    [getEpisodeKey]
  );

  // Returns the RESULTING map. Callers that must react to the new state (e.g.
  // reconciling a season's watch-history entry) cannot read `watchedEpisodes`
  // straight after awaiting this — their closure still holds the pre-toggle
  // render's value — so the post-write snapshot is handed back explicitly.
  const toggleEpisodeWatched = useCallback(
    (seriesId: string | number, seasonNumber: number, episodeNumber: number): Promise<WatchedEpisodeMap> =>
      applyEpisodeMutations((current) => {
        const wasWatched = !!current[getEpisodeKey(seriesId, seasonNumber, episodeNumber)];
        return [buildMutation(seriesId, seasonNumber, episodeNumber, !wasWatched, "episode_toggle")];
      }),
    [applyEpisodeMutations, buildMutation, getEpisodeKey]
  );

  const markSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      await applyEpisodeMutations(() =>
        episodeNumbers.map((episodeNumber) =>
          buildMutation(seriesId, seasonNumber, episodeNumber, true, "season_mark_watched")
        )
      );
    },
    [applyEpisodeMutations, buildMutation]
  );

  const unmarkSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      await applyEpisodeMutations(() =>
        episodeNumbers.map((episodeNumber) =>
          buildMutation(seriesId, seasonNumber, episodeNumber, false, "season_unmark_watched")
        )
      );
    },
    [applyEpisodeMutations, buildMutation]
  );

  // Batch variant for the season-log modal: every marked/unmarked season lands
  // in ONE local write and ONE queued sync batch, instead of a persist plus a
  // queue round-trip per episode per season.
  const applySeasonEpisodeStates = useCallback(
    async (seriesId: string | number, changes: SeasonEpisodeStateChange[]) => {
      if (changes.length === 0) {
        return;
      }

      await applyEpisodeMutations(() =>
        changes.flatMap(({ seasonNumber, episodeNumbers, watched }) =>
          episodeNumbers.map((episodeNumber) =>
            buildMutation(
              seriesId,
              seasonNumber,
              episodeNumber,
              watched,
              watched ? "season_mark_watched" : "season_unmark_watched"
            )
          )
        )
      );
    },
    [applyEpisodeMutations, buildMutation]
  );

  return {
    watchedEpisodes,
    isEpisodeWatched,
    toggleEpisodeWatched,
    markSeasonWatched,
    unmarkSeasonWatched,
    applySeasonEpisodeStates,
  };
}
