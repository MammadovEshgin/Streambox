import { useMemo } from "react";

import { SERIES_WATCHLIST_STORAGE_KEY } from "../services/userDataStorage";
import { useSyncedMediaIdList } from "./useSyncedMediaIdList";

export function useSeriesWatchlist() {
  const syncedList = useSyncedMediaIdList({
    storageKey: SERIES_WATCHLIST_STORAGE_KEY,
    listKind: "watchlist",
    mediaType: "tv",
    notifyStorageChanges: true,
  });

  return useMemo(
    () => ({
      watchlist: syncedList.items,
      isLoading: syncedList.isLoading,
      isInWatchlist: syncedList.isIncluded,
      toggleWatchlist: syncedList.toggle,
      removeFromWatchlist: syncedList.remove,
      reload: syncedList.reload,
    }),
    [syncedList]
  );
}
