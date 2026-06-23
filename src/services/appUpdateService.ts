import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

import { markThrottledCheck, shouldRunThrottledCheck } from "./liveOpsStorage";

const LAST_UPDATE_CHECK_KEY = "@streambox/live-ops/last-update-check-v1";
// Tracks which running bundle we've already shown (or suppressed) the update
// prompt for. Keyed by the running update's id so it changes both when a fresh
// APK is installed (new embedded bundle) and right after an OTA is applied.
const LAST_LAUNCHED_BUNDLE_KEY = "@streambox/live-ops/last-launched-bundle-v1";

// Suppress the "Restart now" modal for the first check after the running bundle
// changes. Showing it seconds after someone installs the APK — or right after
// they just applied an update — is jarring and pointless: the bundle they're on
// is already current. We swallow exactly that one check, then resume normal
// prompting on the next launch. Returns true when the prompt should be skipped.
async function shouldSuppressForFreshBundle(): Promise<boolean> {
  try {
    const currentId = Updates.updateId ?? "embedded";
    const lastId = await AsyncStorage.getItem(LAST_LAUNCHED_BUNDLE_KEY);
    if (lastId === currentId) {
      return false;
    }
    await AsyncStorage.setItem(LAST_LAUNCHED_BUNDLE_KEY, currentId);
    return true;
  } catch {
    // On a storage error, behave normally rather than permanently muting updates.
    return false;
  }
}
// 5 minutes. Decoder rotations are now auto-recovered every 30 min by the
// Oracle VM cron; checking in-app this often means the OTA reaches the user
// within minutes of being published, instead of waiting on a cold launch.
export const APP_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type PendingAppUpdate = {
  fetchedAt: number;
};

export async function checkForPendingAppUpdate(options: { force?: boolean } = {}) {
  if (__DEV__ || !Updates.isEnabled) {
    return null;
  }

  // Freshly installed APK (or just-applied OTA): don't nag to restart on the
  // very first launch of the new bundle. Mark the throttle too so a quick
  // background/foreground in this same session doesn't sneak the prompt back in.
  if (await shouldSuppressForFreshBundle()) {
    await markThrottledCheck(LAST_UPDATE_CHECK_KEY);
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
