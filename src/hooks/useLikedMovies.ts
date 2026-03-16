import { useMemo } from "react";

import { LIKED_MOVIES_STORAGE_KEY } from "../services/userDataStorage";
import { useSyncedMediaIdList } from "./useSyncedMediaIdList";

export function useLikedMovies() {
  const syncedList = useSyncedMediaIdList({
    storageKey: LIKED_MOVIES_STORAGE_KEY,
    listKind: "liked",
    mediaType: "movie",
  });

  return useMemo(
    () => ({
      likedMovies: syncedList.items,
      isLoading: syncedList.isLoading,
      isLiked: syncedList.isIncluded,
      toggleLikedMovie: syncedList.toggle,
      reload: syncedList.reload,
    }),
    [syncedList]
  );
}
