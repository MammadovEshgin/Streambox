import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";

import type { MediaType } from "../api/tmdb";
import { CONTINUE_WATCHING_STORAGE_KEY } from "../services/userDataStorage";
import {
  getResumableSlotEntry,
  parseContinueWatchingState,
  type ContinueWatchingEntry,
} from "../utils/continueWatching";

/**
 * Read-only view of the continue-watching slot for one media kind. Reloads on
 * screen focus, so the hub card appears/disappears as playback sessions leave
 * or clear the slot. Returns null when there is nothing worth resuming.
 */
export function useContinueWatchingSlot(mediaType: MediaType): ContinueWatchingEntry | null {
  const [entry, setEntry] = useState<ContinueWatchingEntry | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(CONTINUE_WATCHING_STORAGE_KEY)
        .then((raw) => {
          if (cancelled) return;
          setEntry(getResumableSlotEntry(parseContinueWatchingState(raw), mediaType));
        })
        .catch(() => {
          if (!cancelled) setEntry(null);
        });
      return () => {
        cancelled = true;
      };
    }, [mediaType])
  );

  return entry;
}
