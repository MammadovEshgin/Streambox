import { Platform } from "react-native";

/**
 * Thin, crash-proof wrapper around `expo-navigation-bar`.
 *
 * Why the guards: `expo-navigation-bar` is a native module. If the JS ever runs
 * on a binary that doesn't ship it (e.g. an older APK that later pulls this code
 * via OTA), the native bridge throws. We swallow every error so the player keeps
 * working regardless — the nav bar just stays visible on builds without the
 * module. On a build that includes it (Android), the bar is hidden immersively
 * during playback and restored afterwards.
 *
 * iOS / web have no Android navigation bar, so these are no-ops there.
 */

type NavigationBarModule = {
  setVisibilityAsync: (visibility: "visible" | "hidden") => Promise<void>;
};

let cachedModule: NavigationBarModule | null | undefined;

function getModule(): NavigationBarModule | null {
  if (Platform.OS !== "android") return null;
  if (cachedModule !== undefined) return cachedModule;

  try {
    // Lazy require so a missing native module can't crash app startup or the
    // Metro bundle on platforms/builds that don't ship it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedModule = require("expo-navigation-bar") as NavigationBarModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

/** Hide the Android system navigation bar (immersive). Safe to call anywhere. */
export async function hideSystemNavigationBar(): Promise<void> {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.setVisibilityAsync("hidden");
  } catch {
    // Build without the native module, or a transient native error — ignore.
  }
}

/** Restore the Android system navigation bar. Safe to call anywhere. */
export async function showSystemNavigationBar(): Promise<void> {
  const mod = getModule();
  if (!mod) return;
  try {
    await mod.setVisibilityAsync("visible");
  } catch {
    // See hideSystemNavigationBar — intentionally swallowed.
  }
}
