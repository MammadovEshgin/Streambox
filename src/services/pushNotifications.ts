import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type * as NotificationsModule from "expo-notifications";

import { registerPushToken, removePushToken } from "../api/social";

// ---------------------------------------------------------------------------
// Android push (runtime 1.3.0). Every expo-notifications touchpoint is isolated
// here and degrades gracefully:
//   · Expo Go  → remote push was REMOVED in SDK 53+ and the library logs a hard
//     error the moment its remote APIs are touched. So in Expo Go we NEVER load
//     or call expo-notifications at all (type-only import + lazy require gated
//     on the execution environment) — the app runs clean, in-app notifications
//     are unaffected, only pushes are unavailable.
//   · permission denied → in-app notifications still work, pushes don't.
// Full remote-push testing needs a development build or the 1.3.0 APK.
//
// Permission is requested at a sensible moment (first open of the Notifications
// screen), NOT at launch — see NotificationsScreen.
// ---------------------------------------------------------------------------

export const ANDROID_SOCIAL_CHANNEL_ID = "social";

// Expo Go reports StoreClient; a dev build / standalone APK does not.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let cachedModule: typeof NotificationsModule | null | undefined;

/** The expo-notifications module, or null in Expo Go / if unavailable. */
function getNotifications(): typeof NotificationsModule | null {
  if (isExpoGo) return null;
  if (cachedModule === undefined) {
    try {
      // Only reached outside Expo Go, where the remote APIs actually work.
      cachedModule = require("expo-notifications") as typeof NotificationsModule;
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule ?? null;
}

let handlerConfigured = false;

/** Foreground presentation for social pushes (banner + list, no noisy sound). */
export function configureNotificationHandler(): void {
  const Notifications = getNotifications();
  if (!Notifications || handlerConfigured) return;
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
  const Notifications = getNotifications();
  if (!Notifications || Platform.OS !== "android") return;
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
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId ??
    undefined
  );
}

export type PushRegistrationResult =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported" };

/**
 * Request permission (Android 13 POST_NOTIFICATIONS), acquire the Expo push
 * token, and register it server-side. No-op ("unsupported") in Expo Go. Safe to
 * call repeatedly.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  const Notifications = getNotifications();
  if (!Notifications) return { status: "unsupported" };

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

const NOOP_SUBSCRIPTION = { remove: () => undefined };

/** Fires when the user taps a push. The app host routes on data.type. */
export function addNotificationResponseListener(
  handler: (data: PushTapData) => void
): { remove: () => void } {
  const Notifications = getNotifications();
  if (!Notifications) return NOOP_SUBSCRIPTION;
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as PushTapData | undefined;
    if (data) handler(data);
  });
}

/** Fires while the app is foregrounded and a push arrives. */
export function addForegroundNotificationListener(
  handler: (data: PushTapData) => void
): { remove: () => void } {
  const Notifications = getNotifications();
  if (!Notifications) return NOOP_SUBSCRIPTION;
  return Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as PushTapData | undefined;
    if (data) handler(data);
  });
}

/** The push that opened a cold-started app, if any (routed after nav is ready). */
export async function getInitialNotificationData(): Promise<PushTapData | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification.request.content.data as PushTapData | undefined;
    return data ?? null;
  } catch {
    return null;
  }
}
