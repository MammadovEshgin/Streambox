import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

import { useAppSettings } from "../settings/AppSettingsContext";
import { enqueueEpisodeProgressSync } from "../services/userDataSync";
import { WATCHED_EPISODES_STORAGE_KEY } from "../services/userDataStorage";

export function useWatchedEpisodes() {
  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>({});
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(WATCHED_EPISODES_STORAGE_KEY)
      .then((data) => {
        if (!isMounted) {
          return;
        }
        if (!data) {
          setWatchedEpisodes({});
          return;
        }

        try {
          const parsed = JSON.parse(data) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            setWatchedEpisodes(parsed as Record<string, boolean>);
          }
        } catch (error) {
          console.error("Failed to parse watched episodes", error);
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

  const toggleEpisodeWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumber: number) => {
      const key = getEpisodeKey(seriesId, seasonNumber, episodeNumber);
      
      let wasWatched = false;
      setWatchedEpisodes((prev) => {
        wasWatched = !!prev[key];
        const nextWatched = !wasWatched;
        const nextState = { ...prev };
        if (nextWatched) {
          nextState[key] = true;
        } else {
          delete nextState[key];
        }
        
        // Save to storage asynchronously
        AsyncStorage.setItem(WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(nextState))
          .then(() => notifyStorageChanged())
          .catch((error) => console.error("Failed to save watched episodes", error));
          
        return nextState;
      });

      const nextWatched = !wasWatched;
      
      await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, nextWatched, {
        source: "episode_toggle",
      });
    },
    [getEpisodeKey, notifyStorageChanged]
  );

  const markSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      setWatchedEpisodes((prev) => {
        const nextState = { ...prev };
        for (const episodeNumber of episodeNumbers) {
          nextState[getEpisodeKey(seriesId, seasonNumber, episodeNumber)] = true;
        }
        AsyncStorage.setItem(WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(nextState))
          .then(() => notifyStorageChanged())
          .catch((error) => console.error("Failed", error));
        return nextState;
      });

      for (const episodeNumber of episodeNumbers) {
        await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, true, {
          source: "season_mark_watched",
        });
      }
    },
    [getEpisodeKey, notifyStorageChanged]
  );

  const unmarkSeasonWatched = useCallback(
    async (seriesId: string | number, seasonNumber: number, episodeNumbers: number[]) => {
      setWatchedEpisodes((prev) => {
        const nextState = { ...prev };
        for (const episodeNumber of episodeNumbers) {
          delete nextState[getEpisodeKey(seriesId, seasonNumber, episodeNumber)];
        }
        AsyncStorage.setItem(WATCHED_EPISODES_STORAGE_KEY, JSON.stringify(nextState))
          .then(() => notifyStorageChanged())
          .catch((error) => console.error("Failed", error));
        return nextState;
      });

      for (const episodeNumber of episodeNumbers) {
        await enqueueEpisodeProgressSync(Number(seriesId), seasonNumber, episodeNumber, false, {
          source: "season_unmark_watched",
        });
      }
    },
    [getEpisodeKey, notifyStorageChanged]
  );

  return {
    watchedEpisodes,
    isEpisodeWatched,
    toggleEpisodeWatched,
    markSeasonWatched,
    unmarkSeasonWatched,
  };
}
