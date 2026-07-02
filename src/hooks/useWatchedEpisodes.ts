import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppSettings } from "../settings/AppSettingsContext";
import {
  enqueueEpisodeProgressBatch,
  enqueueEpisodeProgressSync,
  type EpisodeProgressQueueItem,
} from "../services/userDataSync";
import { WATCHED_EPISODES_STORAGE_KEY } from "../services/userDataStorage";

export type SeasonEpisodeStateChange = {
  seasonNumber: number;
  episodeNumbers: number[];
  watched: boolean;
};

export function useWatchedEpisodes() {
  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>({});
  const watchedEpisodesRef = useRef<Record<string, boolean>>({});
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  useEffect(() => {
    watchedEpisodesRef.current = watchedEpisodes;
  }, [watchedEpisodes]);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(WATCHED_EPISODES_STORAGE_KEY)
      .then((data) => {
        if (!isMounted) {
          return;
        }
        if (!data) {
          watchedEpisodesRef.current = {};
          setWatchedEpisodes({});
          return;
        }

        try {
          const parsed = JSON.parse(data) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const next = parsed as Record<string, boolean>;
            watchedEpisodesRef.current = next;
            setWatchedEpisodes(next);
          } else {
            watchedEpisodesRef.current = {};
            setWatchedEpisodes({});
          }
        } catch (error) {
          console.error("Failed to parse watched episodes", error);
          watchedEpisodesRef.current = {};
          setWatchedEpisodes({});
        }
      })
      .catch((error) => console.error("Failed to load watched episodes", error));

    return () => {
      isMounted = false;
    };
  }, [storageRevision]);

  const getEpisodeKey = useCallback((seriesId: string | number, seasonNumber: number, episodeNumber: number) => {
    return `${seriesId}_${seasonNumber}_${episodeNumber}`;
  }, []);

  const isEpisodeWatched = useCallback(
    (seriesId: string | number, seasonNumber: number, episodeNumber: number) => {
      const key = getEpisodeKey(seriesId, seasonNumber, episodeNumber);
      return !!watchedEpisodes[key];
    },
    [getEpisodeKey, watchedEpisodes]
  );

  const persistWatchedEpisodes = useCallback(
    async (nextState: Record<string, boolean>) => {
      watchedEpisodesRef.current = nextState;
      setWatchedEpisodes(nextState);
      await AsyncStorage.setItem(WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(nextState));
      notifyStorageChanged();
    },
    [notifyStorageChanged]
  );

  const toggleEpisodeWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumber: number) => {
      const key = getEpisodeKey(seriesId, seasonNumber, episodeNumber);
      const wasWatched = !!watchedEpisodesRef.current[key];
      const nextWatched = !wasWatched;
      const nextState = { ...watchedEpisodesRef.current };

      if (nextWatched) {
        nextState[key] = true;
      } else {
        delete nextState[key];
      }

      await persistWatchedEpisodes(nextState);
      
      await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, nextWatched, {
        source: "episode_toggle",
      });
    },
    [getEpisodeKey, persistWatchedEpisodes]
  );

  const markSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      const nextState = { ...watchedEpisodesRef.current };
      for (const episodeNumber of episodeNumbers) {
        nextState[getEpisodeKey(seriesId, seasonNumber, episodeNumber)] = true;
      }
      await persistWatchedEpisodes(nextState);

      for (const episodeNumber of episodeNumbers) {
        await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, true, {
          source: "season_mark_watched",
        });
      }
    },
    [getEpisodeKey, persistWatchedEpisodes]
  );

  const unmarkSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      const nextState = { ...watchedEpisodesRef.current };
      for (const episodeNumber of episodeNumbers) {
        delete nextState[getEpisodeKey(seriesId, seasonNumber, episodeNumber)];
      }
      await persistWatchedEpisodes(nextState);

      for (const episodeNumber of episodeNumbers) {
        await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, false, {
          source: "season_unmark_watched",
        });
      }
    },
    [getEpisodeKey, persistWatchedEpisodes]
  );

  // Batch variant for the season-log modal: every marked/unmarked season lands
  // in ONE local write and ONE queued sync batch, instead of a persist plus a
  // queue round-trip per episode per season.
  const applySeasonEpisodeStates = useCallback(
    async (seriesId: string | number, changes: SeasonEpisodeStateChange[]) => {
      if (changes.length === 0) {
        return;
      }

      const nextState = { ...watchedEpisodesRef.current };
      const queueItems: EpisodeProgressQueueItem[] = [];
      for (const { seasonNumber, episodeNumbers, watched } of changes) {
        for (const episodeNumber of episodeNumbers) {
          const key = getEpisodeKey(seriesId, seasonNumber, episodeNumber);
          if (watched) {
            nextState[key] = true;
          } else {
            delete nextState[key];
          }
          queueItems.push({
            seriesTmdbId: Number(seriesId),
            seasonNumber,
            episodeNumber,
            isWatched: watched,
            audit: { source: watched ? "season_mark_watched" : "season_unmark_watched" },
          });
        }
      }

      await persistWatchedEpisodes(nextState);
      await enqueueEpisodeProgressBatch(queueItems);
    },
    [getEpisodeKey, persistWatchedEpisodes]
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
