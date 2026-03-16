import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MediaType } from "../api/tmdb";
import { useAppSettings } from "../settings/AppSettingsContext";
import { enqueueMediaLibrarySync, type UserMediaSyncDetails } from "../services/userDataSync";
import { RECENTLY_WATCHED_STORAGE_KEY } from "../services/userDataStorage";

const MAX_ITEMS = 30;

type RecentlyWatchedEntry = {
  id: number;
  mediaType: MediaType;
  timestamp: number;
};

export function useRecentlyWatched() {
  const [entries, setEntries] = useState<RecentlyWatchedEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const loadEntries = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTLY_WATCHED_STORAGE_KEY);
      if (!raw) {
        setEntries([]);
        return;
      }

      const parsed = JSON.parse(raw) as RecentlyWatchedEntry[];
      setEntries(Array.isArray(parsed) ? parsed : []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries, storageRevision]);

  const addToRecentlyWatched = useCallback(
    async (id: number, mediaType: MediaType, details?: UserMediaSyncDetails | null) => {
      const filtered = entries.filter((entry) => !(entry.id === id && entry.mediaType === mediaType));
      const timestamp = Date.now();
      const nextEntries = [{ id, mediaType, timestamp }, ...filtered].slice(0, MAX_ITEMS);
      setEntries(nextEntries);
      await AsyncStorage.setItem(RECENTLY_WATCHED_STORAGE_KEY, JSON.stringify(nextEntries));
      notifyStorageChanged();
      await enqueueMediaLibrarySync({
        operation: "upsert",
        listKind: "recently_viewed",
        mediaType,
        tmdbId: id,
        details,
        occurredAt: new Date(timestamp).toISOString(),
      });
    },
    [entries, notifyStorageChanged]
  );

  const recentlyWatched = useMemo(() => [...entries].sort((left, right) => right.timestamp - left.timestamp), [entries]);

  return useMemo(
    () => ({
      recentlyWatched,
      isLoading,
      addToRecentlyWatched,
      reload: loadEntries,
    }),
    [recentlyWatched, isLoading, addToRecentlyWatched, loadEntries]
  );
}
