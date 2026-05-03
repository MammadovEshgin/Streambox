import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { isRuntimeCacheFresh, type CacheEntry } from "../services/runtimeCache";

type UseRuntimeCacheAutoRefreshOptions = {
  entry: CacheEntry<unknown> | null | undefined;
  maxAgeMs: number;
  getExpectedVersion?: () => string | null;
  enabled?: boolean;
  onRefresh: (hasCachedValue: boolean) => void | Promise<void>;
};

export function useRuntimeCacheAutoRefresh({
  entry,
  maxAgeMs,
  getExpectedVersion,
  enabled = true,
  onRefresh,
}: UseRuntimeCacheAutoRefreshOptions) {
  const lastRefreshAttemptAtRef = useRef(0);

  const maybeRefresh = useCallback(() => {
    if (!enabled) {
      return;
    }

    const expectedVersion = getExpectedVersion?.() ?? null;
    if (isRuntimeCacheFresh(entry, maxAgeMs, expectedVersion)) {
      return;
    }

    const now = Date.now();
    if (now - lastRefreshAttemptAtRef.current < 5000) {
      return;
    }

    lastRefreshAttemptAtRef.current = now;
    void onRefresh(Boolean(entry));
  }, [enabled, entry, getExpectedVersion, maxAgeMs, onRefresh]);

  useFocusEffect(
    useCallback(() => {
      maybeRefresh();
      return undefined;
    }, [maybeRefresh])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        maybeRefresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [maybeRefresh]);

  useEffect(() => {
    lastRefreshAttemptAtRef.current = 0;
  }, [entry?.updatedAt, entry?.version]);
}
