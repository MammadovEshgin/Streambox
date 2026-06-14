import * as Updates from "expo-updates";

import { markThrottledCheck, shouldRunThrottledCheck } from "./liveOpsStorage";

const LAST_UPDATE_CHECK_KEY = "@streambox/live-ops/last-update-check-v1";
export const APP_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type PendingAppUpdate = {
  fetchedAt: number;
};

export async function checkForPendingAppUpdate(options: { force?: boolean } = {}) {
  if (__DEV__ || !Updates.isEnabled) {
    return null;
  }

  if (!options.force) {
    const shouldCheck = await shouldRunThrottledCheck(LAST_UPDATE_CHECK_KEY, APP_UPDATE_CHECK_INTERVAL_MS);
    if (!shouldCheck) {
      return null;
    }
  }

  await markThrottledCheck(LAST_UPDATE_CHECK_KEY);

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      return null;
    }

    await Updates.fetchUpdateAsync();
    return {
      fetchedAt: Date.now(),
    } satisfies PendingAppUpdate;
  } catch (error) {
    console.warn("App update check failed:", error);
    return null;
  }
}

export async function applyFetchedAppUpdate() {
  if (__DEV__ || !Updates.isEnabled) {
    return;
  }

  await Updates.reloadAsync();
}
