import { useMemo } from "react";

import { LIKED_SERIES_STORAGE_KEY } from "../services/userDataStorage";
import { useSyncedMediaIdList } from "./useSyncedMediaIdList";

export function useLikedSeries() {
  const syncedList = useSyncedMediaIdList({
    storageKey: LIKED_SERIES_STORAGE_KEY,
    listKind: "liked",
    mediaType: "tv",
  });

  return useMemo(
    () => ({
      likedSeries: syncedList.items,
      isLoading: syncedList.isLoading,
      isLiked: syncedList.isIncluded,
      toggleLikedSeries: syncedList.toggle,
      reload: syncedList.reload,
    }),
    [syncedList]
  );
}
