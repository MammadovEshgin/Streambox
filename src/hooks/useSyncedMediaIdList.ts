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
import { libraryStorage } from "../services/libraryStorage";
import { withMediaListMutationLock } from "../services/mediaListStore";

type SyncedListKind = "watchlist" | "liked";

type UseSyncedMediaIdListOptions = {
  storageKey: string;
  listKind: SyncedListKind;
  mediaType: MediaType;
};

// The per-key mutation lock lives in services/libraryLocks so the
// watch-history save path and the cloud reconcile serialize against these
// hooks on the same key: marking a title watched removes it from the
// watchlist, and that write must not interleave with a toggle happening on
// another screen. The sync op is queued INSIDE the lock, together with the
// local write, so the reconcile never sees one without the other.

export function useSyncedMediaIdList({ storageKey, listKind, mediaType }: UseSyncedMediaIdListOptions) {
  const [items, setItems] = useState<(number | string)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { notifyStorageChanged, storageRevision } = useAppSettings();

  const loadItems = useCallback(async () => {
    try {
      const rawValue = await libraryStorage.getItem(storageKey);
      setItems(parseStoredMediaIds(rawValue));
    } catch (error) {
      // Keep what is on screen; a failed read must never blank the list.
      console.warn(`[library] failed to read ${storageKey}:`, error);
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
      await withMediaListMutationLock(storageKey, async () => {
        const current = parseStoredMediaIds(await libraryStorage.getItem(storageKey));
        const mutation = toggleMediaIdInList(current, normalizedId);
        await libraryStorage.setItem(storageKey, JSON.stringify(mutation.next));
        setItems(mutation.next);
        await enqueueMediaLibrarySync({
          operation: mutation.existed ? "delete" : "upsert",
          listKind,
          mediaType,
          tmdbId: normalizedId,
          details,
        });
      });
      // Always notify: every other mounted instance reloads from storage, so
      // stale copies never linger long enough to mislead the UI.
      notifyStorageChanged();
    },
    [listKind, mediaType, notifyStorageChanged, storageKey]
  );

  const remove = useCallback(
    async (id: number | string, details?: UserMediaSyncDetails | null) => {
      const normalizedId = normalizeMediaListId(id);
      const removed = await withMediaListMutationLock(storageKey, async () => {
        const current = parseStoredMediaIds(await libraryStorage.getItem(storageKey));
        const mutation = removeMediaIdFromList(current, normalizedId);
        if (!mutation.changed) {
          return false;
        }
        await libraryStorage.setItem(storageKey, JSON.stringify(mutation.next));
        setItems(mutation.next);
        await enqueueMediaLibrarySync({
          operation: "delete",
          listKind,
          mediaType,
          tmdbId: normalizedId,
          details,
        });
        return true;
      });

      if (removed) {
        notifyStorageChanged();
      }
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
