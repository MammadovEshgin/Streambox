import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";

import {
  fetchUnreadNotificationCount,
  getCurrentUserId,
  getPublicProfile,
} from "../api/social";
import { warmSocialFeedCaches } from "../services/socialFeedCache";
import { userInboxService } from "../services/userInboxService";

// Small profile-header data source for the signed-in user: username + follower/
// following counts + unread notification badge. Refreshes on focus and keeps the
// unread badge live via the realtime inbox (which it also starts, idempotently).

export type MyProfileSocial = {
  userId: string | null;
  username: string | null;
  followers: number;
  following: number;
  unread: number;
  refresh: () => void;
};

export function useMyProfileSocial(): MyProfileSocial {
  const isFocused = useIsFocused();
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);

  // Resolve the current user id and start the app-wide inbox once known.
  useEffect(() => {
    let cancelled = false;
    void getCurrentUserId().then((id) => {
      if (cancelled) return;
      setUserId(id);
      if (id) userInboxService.start(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live unread badge: bump on every incoming notification.
  useEffect(() => {
    const unsubscribe = userInboxService.addListener({
      onNotification: () => setUnread((count) => count + 1),
    });
    return unsubscribe;
  }, []);

  // Refresh counts + unread whenever the profile is focused (or refresh()).
  // Also warm the Notifications/Activity first-page caches so those screens
  // open instantly from here (no-op once warm).
  useEffect(() => {
    if (!isFocused || !userId) return;
    let cancelled = false;
    void warmSocialFeedCaches().catch(() => undefined);
    void (async () => {
      try {
        const [profile, unreadCount] = await Promise.all([
          getPublicProfile(userId),
          fetchUnreadNotificationCount(),
        ]);
        if (cancelled) return;
        if (profile) {
          setUsername(profile.username);
          setFollowers(profile.counts.followers);
          setFollowing(profile.counts.following);
        }
        setUnread(unreadCount);
      } catch {
        // keep last-known values
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFocused, userId, tick]);

  return {
    userId,
    username,
    followers,
    following,
    unread,
    refresh: () => setTick((value) => value + 1),
  };
}
