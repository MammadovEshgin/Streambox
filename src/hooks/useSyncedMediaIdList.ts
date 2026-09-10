import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MediaType } from "../api/tmdb";
import { useAppSettings } from "../settings/AppSettingsContext";
import { enqueueMediaLibrarySync, type UserMediaSyncDetails } from "../services/userDataSync";
import {
  listIncludesMediaId,
  normalizeMediaListId,
  parseStoredMediaIds,
  removeMediaIdFromList,
  toggleMediaIdInList,
} from "../utils/mediaIdList";
import { withMediaListMutationLock } from "../services/mediaListStore";

type SyncedListKind = "watchlist" | "liked";

type UseSyncedMediaIdListOptions = {
  storageKey: string;
  listKind: SyncedListKind;
  mediaType: MediaType;
};

// The per-key mutation lock lives in services/mediaListStore so the
// watch-history save path serializes against these hooks on the same key:
// marking a title watched removes it from the watchlist, and that write must
// not interleave with a toggle happening on another screen.

export function useSyncedMediaIdList({ storageKey, listKind, mediaType }: UseSyncedMediaIdListOptions) {
  const [items, setItems] = useState<(number | string)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const loadItems = useCallback(async () => {
    try {
      const rawValue = await AsyncStorage.getItem(storageKey);
      setItems(parseStoredMediaIds(rawValue));
    } finally {
      setIsLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, storageRevision]);

  const isIncluded = useCallback((id: number | string) => listIncludesMediaId(items, id), [items]);

  const toggle = useCallback(
    async (id: number | string, details?: UserMediaSyncDetails | null) => {
      const normalizedId = normalizeMediaListId(id);
      const existed = await withMediaListMutationLock(storageKey, async () => {
        const current = parseStoredMediaIds(await AsyncStorage.getItem(storageKey));
        const mutation = toggleMediaIdInList(current, normalizedId);
        await AsyncStorage.setItem(storageKey, JSON.stringify(mutation.next));
        setItems(mutation.next);
        return mutation.existed;
      });
      // Always notify: every other mounted instance reloads from storage, so
      // stale copies never linger long enough to mislead the UI.
      notifyStorageChanged();
      await enqueueMediaLibrarySync({
        operation: existed ? "delete" : "upsert",
        listKind,
        mediaType,
        tmdbId: normalizedId,
        details,
      });
    },
    [listKind, mediaType, notifyStorageChanged, storageKey]
  );

  const remove = useCallback(
    async (id: number | string, details?: UserMediaSyncDetails | null) => {
      const normalizedId = normalizeMediaListId(id);
      const removed = await withMediaListMutationLock(storageKey, async () => {
        const current = parseStoredMediaIds(await AsyncStorage.getItem(storageKey));
        const mutation = removeMediaIdFromList(current, normalizedId);
        if (!mutation.changed) {
          return false;
        }
        await AsyncStorage.setItem(storageKey, JSON.stringify(mutation.next));
        setItems(mutation.next);
        return true;
      });

      if (!removed) {
        return;
      }

      notifyStorageChanged();
      await enqueueMediaLibrarySync({
        operation: "delete",
        listKind,
        mediaType,
        tmdbId: normalizedId,
        details,
      });
    },
    [listKind, mediaType, notifyStorageChanged, storageKey]
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
