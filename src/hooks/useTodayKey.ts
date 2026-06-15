import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { getLocalDateFreshnessKey } from "../services/contentFreshness";

/**
 * Returns the local calendar date (YYYY-MM-DD) and re-renders the caller the
 * moment that date changes — i.e. right after local midnight. Used by hubs
 * with "movie/series of the day" picks so the UI rolls over without requiring
 * the user to background+foreground the app.
 *
 * Re-checks the date on every app foreground too, so a phone that was asleep
 * across the date boundary still updates correctly when it wakes up.
 */
export function useTodayKey(): string {
  const [key, setKey] = useState(getLocalDateFreshnessKey);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sync = () => {
      if (cancelled) {
        return;
      }
      const next = getLocalDateFreshnessKey();
      setKey((prev) => (prev === next ? prev : next));
    };

    const scheduleMidnight = () => {
      const now = new Date();
      // Wake one second after midnight to avoid clock-drift races where the
      // timer fires while the calendar still reads the previous day.
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
        0
      );
      const delay = Math.max(1000, next.getTime() - now.getTime());
      timer = setTimeout(() => {
        sync();
        scheduleMidnight();
      }, delay);
    };

    scheduleMidnight();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        sync();
      }
    });

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, []);

  return key;
}
