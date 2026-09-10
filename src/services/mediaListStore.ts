import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MediaType } from "../api/tmdb";
import {
  parseStoredMediaIds,
  removeMediaIdFromList,
  normalizeMediaListId,
} from "../utils/mediaIdList";
import { SERIES_WATCHLIST_STORAGE_KEY, WATCHLIST_STORAGE_KEY } from "./userDataStorage";
import { enqueueMediaLibraryBatch, type UserMediaSyncDetails } from "./userDataSync";

/**
 * Shared mutation lock for the stored media id lists (watchlist / liked).
 *
 * Every mutation of a given storage key — from any mounted hook instance, and
 * from the watch-history save path below — has to queue behind this. Mutations
 * re-read storage inside the lock and apply the change to THAT list, never to a
 * caller's in-memory copy: writing `[...items, id]` from component state is how
 * an instance mounted before an import or another screen's toggle silently
 * erased everything added since it mounted (the vanished-watchlist bug).
 */
const listMutationChains = new Map<string, Promise<void>>();

export function withMediaListMutationLock<T>(storageKey: string, task: () => Promise<T>): Promise<T> {
  const previous = listMutationChains.get(storageKey) ?? Promise.resolve();
  const run = previous.then(task, task);
  listMutationChains.set(
    storageKey,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export function getWatchlistStorageKey(mediaType: MediaType): string {
  return mediaType === "tv" ? SERIES_WATCHLIST_STORAGE_KEY : WATCHLIST_STORAGE_KEY;
}

export type WatchlistPruneRequest = {
  mediaType: MediaType;
  tmdbId: number | string;
  details?: UserMediaSyncDetails | null;
};

/**
 * Drop titles from the watchlist once they have been watched.
 *
 * The watchlist answers "what do I still want to see?", so a title that has
 * just been logged as watched — by the manual log sheet, by the season modal,
 * or by the player's auto-mark — no longer belongs in it. Leaving it there
 * meant a viewer had to remember to remove every film by hand, and the count on
 * the profile kept climbing past titles they had already seen.
 *
 * Returns the ids that were actually removed (already-absent ids are a no-op),
 * so the caller only has to notify listeners when something changed.
 */
export async function pruneWatchedFromWatchlist(
  requests: WatchlistPruneRequest[]
): Promise<WatchlistPruneRequest[]> {
  if (requests.length === 0) {
    return [];
  }

  // Group by storage key so each list is read and written exactly once, even
  // when a batch (e.g. the season modal) targets many titles at once.
  const byKey = new Map<string, WatchlistPruneRequest[]>();
  for (const request of requests) {
    const key = getWatchlistStorageKey(request.mediaType);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(request);
    } else {
      byKey.set(key, [request]);
    }
  }

  const removed: WatchlistPruneRequest[] = [];

  for (const [storageKey, bucket] of byKey) {
    const removedFromList = await withMediaListMutationLock(storageKey, async () => {
      let list = parseStoredMediaIds(await AsyncStorage.getItem(storageKey));
      const changed: WatchlistPruneRequest[] = [];

      for (const request of bucket) {
        const mutation = removeMediaIdFromList(list, normalizeMediaListId(request.tmdbId));
        if (mutation.changed) {
          list = mutation.next;
          changed.push(request);
        }
      }

      if (changed.length > 0) {
        await AsyncStorage.setItem(storageKey, JSON.stringify(list));
      }

      return changed;
    });

    removed.push(...removedFromList);
  }

  if (removed.length > 0) {
    await enqueueMediaLibraryBatch(
      removed.map((request) => ({
        operation: "delete" as const,
        listKind: "watchlist" as const,
        mediaType: request.mediaType,
        tmdbId: normalizeMediaListId(request.tmdbId),
        details: request.details,
      }))
    );
  }

  return removed;
}
