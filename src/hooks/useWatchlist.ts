import { useMemo } from "react";

import { WATCHLIST_STORAGE_KEY } from "../services/userDataStorage";
import { useSyncedMediaIdList } from "./useSyncedMediaIdList";

export function useWatchlist() {
  const syncedList = useSyncedMediaIdList({
    storageKey: WATCHLIST_STORAGE_KEY,
    listKind: "watchlist",
    mediaType: "movie",
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
