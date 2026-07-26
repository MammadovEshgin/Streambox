import { fetchNotifications, getFollowingActivity, type AppNotification } from "../api/social";
import type { ActivityItem } from "../utils/activityFeed";

// ---------------------------------------------------------------------------
// Session-scoped first-page caches for the Notifications + Activity screens.
//
// On mobile networks the first Supabase round-trip after a cold connection can
// take seconds (see docs/AUDIT_2026-07-20.md), which made both screens sit on
// a spinner even when the result was empty. Screens render the cached first
// page instantly and reconcile with a background refresh; ProfileScreen warms
// both caches on mount (the only screen the two entry points live on), so the
// common path never shows a spinner at all.
//
// The cache is keyed to the signed-in user: App.tsx forwards session changes
// via setSocialFeedCacheUser, which drops everything on sign-out/user switch
// so one account's inbox can never flash for another.
// ---------------------------------------------------------------------------

let cacheUserId: string | null = null;
let notificationsFirstPage: AppNotification[] | null = null;
let activityFirstPage: ActivityItem[] | null = null;
let warmInFlight = false;

export function setSocialFeedCacheUser(userId: string | null): void {
  if (userId === cacheUserId) return;
  cacheUserId = userId;
  notificationsFirstPage = null;
  activityFirstPage = null;
}

export function getCachedNotifications(): AppNotification[] | null {
  return notificationsFirstPage;
}

export function setCachedNotifications(rows: AppNotification[]): void {
  if (cacheUserId === null) return;
  notificationsFirstPage = rows;
}

export function getCachedActivity(): ActivityItem[] | null {
  return activityFirstPage;
}

export function setCachedActivity(rows: ActivityItem[]): void {
  if (cacheUserId === null) return;
  activityFirstPage = rows;
}

/** Fill whichever cache is still cold; no-op while a warm-up is in flight. */
export async function warmSocialFeedCaches(): Promise<void> {
  if (warmInFlight || cacheUserId === null) return;
  if (notificationsFirstPage !== null && activityFirstPage !== null) return;
  warmInFlight = true;
  const startedFor = cacheUserId;
  try {
    const [notifications, activity] = await Promise.allSettled([
      notificationsFirstPage === null ? fetchNotifications({ limit: 50 }) : Promise.resolve(null),
      activityFirstPage === null ? getFollowingActivity({ limit: 50 }) : Promise.resolve(null),
    ]);
    if (startedFor !== cacheUserId) return; // user changed mid-flight
    if (notifications.status === "fulfilled" && notifications.value) {
      notificationsFirstPage = notifications.value;
    }
    if (activity.status === "fulfilled" && activity.value) {
      activityFirstPage = activity.value;
    }
  } finally {
    warmInFlight = false;
  }
}
