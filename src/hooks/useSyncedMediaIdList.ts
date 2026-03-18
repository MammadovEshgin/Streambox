import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MediaType } from "../api/tmdb";
import { useAppSettings } from "../settings/AppSettingsContext";
import { enqueueMediaLibrarySync, type UserMediaSyncDetails } from "../services/userDataSync";

type SyncedListKind = "watchlist" | "liked";

type UseSyncedMediaIdListOptions = {
  storageKey: string;
  listKind: SyncedListKind;
  mediaType: MediaType;
  notifyStorageChanges?: boolean;
};

function parseStoredIds(rawValue: string | null): (number | string)[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is number | string => {
      if (typeof entry === "number") {
        return Number.isFinite(entry);
      }
      if (typeof entry === "string") {
        return entry.trim().length > 0;
      }
      return false;
    });
  } catch {
    return [];
  }
}

export function useSyncedMediaIdList({
  storageKey,
  listKind,
  mediaType,
  notifyStorageChanges = false,
}: UseSyncedMediaIdListOptions) {
  const [items, setItems] = useState<(number | string)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const loadItems = useCallback(async () => {
    try {
      const rawValue = await AsyncStorage.getItem(storageKey);
      setItems(parseStoredIds(rawValue));
    } finally {
      setIsLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, storageRevision]);

  const persistItems = useCallback(
    async (nextItems: (number | string)[]) => {
      setItems(nextItems);
      await AsyncStorage.setItem(storageKey, JSON.stringify(nextItems));
      if (notifyStorageChanges) {
        notifyStorageChanged();
      }
    },
    [notifyStorageChanged, notifyStorageChanges, storageKey]
  );

  const isIncluded = useCallback((id: number | string) => items.includes(id), [items]);

  const toggle = useCallback(
    async (id: number | string, details?: UserMediaSyncDetails | null) => {
      const exists = items.includes(id);
      const nextItems = exists ? items.filter((entry) => entry !== id) : [...items, id];
      await persistItems(nextItems);
      await enqueueMediaLibrarySync({
        operation: exists ? "delete" : "upsert",
        listKind,
        mediaType,
        tmdbId: id,
        details,
      });
    },
    [items, listKind, mediaType, persistItems]
  );

  const remove = useCallback(
    async (id: number | string, details?: UserMediaSyncDetails | null) => {
      if (!items.includes(id)) {
        return;
      }

      const nextItems = items.filter((entry) => entry !== id);
      await persistItems(nextItems);
      await enqueueMediaLibrarySync({
        operation: "delete",
        listKind,
        mediaType,
        tmdbId: id,
        details,
      });
    },
    [items, listKind, mediaType, persistItems]
  );

  return useMemo(
    () => ({
      items,
      isLoading,
      isIncluded,
      toggle,
      remove,
      reload: loadItems,
    }),
    [isIncluded, isLoading, items, loadItems, remove, toggle]
  );
}
