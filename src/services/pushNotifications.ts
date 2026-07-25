import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { registerPushToken, removePushToken } from "../api/social";

// ---------------------------------------------------------------------------
// Android push (runtime 1.3.0). One small service that isolates every
// expo-notifications touchpoint and degrades gracefully:
//   · permission denied  → in-app notifications still work, pushes don't;
//   · Expo Go on Android  → remote push was dropped in SDK 53+, so
//     getExpoPushTokenAsync throws; we return "unsupported" and move on
//     (local notifications + the whole in-app inbox are unaffected).
// Full remote-push testing needs a dev build or the eventual 1.3.0 APK.
//
// Permission is requested at a sensible moment (first open of the Notifications
// screen), NOT at launch — see NotificationsScreen.
// ---------------------------------------------------------------------------

export const ANDROID_SOCIAL_CHANNEL_ID = "social";

let handlerConfigured = false;

/** Foreground presentation for social pushes (banner + list, no noisy sound). */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_SOCIAL_CHANNEL_ID, {
      name: "Social",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    // Channel setup is best-effort; a failure never blocks the app.
  }
}

function resolveProjectId(): string | undefined {
  try {
    // expo-constants ships with expo; require lazily so this module stays
    // importable even where it is momentarily unavailable.
    const Constants = require("expo-constants").default;
    return (
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      undefined
    );
  } catch {
    return undefined;
  }
}

export type PushRegistrationResult =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported" };

/**
 * Request permission (Android 13 POST_NOTIFICATIONS), acquire the Expo push
 * token, and register it server-side. Safe to call repeatedly.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  try {
    if (!Device.isDevice) return { status: "unsupported" };

    configureNotificationHandler();
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (finalStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }
    if (finalStatus !== "granted") return { status: "denied" };

    const projectId = resolveProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;
    if (!token) return { status: "unsupported" };

    await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
    return { status: "registered", token };
  } catch {
    // Expo Go (no remote push), simulator, or a transient failure.
    return { status: "unsupported" };
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  try {
    await removePushToken(token);
  } catch {
    // best-effort on sign-out
  }
}

export type PushTapData = {
  type?: "follow" | "watch_invite";
  actorId?: string;
  inviteId?: string;
  [key: string]: unknown;
};

/** Fires when the user taps a push. The app host routes on data.type. */
export function addNotificationResponseListener(
  handler: (data: PushTapData) => void
): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as PushTapData | undefined;
    if (data) handler(data);
  });
}

/** Fires while the app is foregrounded and a push arrives. */
export function addForegroundNotificationListener(
  handler: (data: PushTapData) => void
): { remove: () => void } {
  return Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as PushTapData | undefined;
    if (data) handler(data);
  });
}

/** The push that opened a cold-started app, if any (routed after nav is ready). */
export async function getInitialNotificationData(): Promise<PushTapData | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification.request.content.data as PushTapData | undefined;
    return data ?? null;
  } catch {
    return null;
  }
}
