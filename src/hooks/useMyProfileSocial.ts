import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";

import { getCurrentUserId, getPublicProfile } from "../api/social";
import {
  getUnreadBadge,
  refreshUnreadBadge,
  subscribeUnreadBadge,
} from "../services/notificationBadge";
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
  const [unread, setUnread] = useState(getUnreadBadge());
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

  // Unread badge comes from the shared app-wide store (also drives the Profile
  // tab badge), so the bell and the tab always agree.
  useEffect(() => subscribeUnreadBadge(setUnread), []);

  // Refresh counts whenever the profile is focused (or refresh()); resync the
  // unread badge from the server and warm the Notifications/Activity first-page
  // caches so those screens open instantly (no-op once warm).
  useEffect(() => {
    if (!isFocused || !userId) return;
    let cancelled = false;
    void warmSocialFeedCaches().catch(() => undefined);
    void refreshUnreadBadge();
    void (async () => {
      try {
        const profile = await getPublicProfile(userId);
        if (cancelled) return;
        if (profile) {
          setUsername(profile.username);
          setFollowers(profile.counts.followers);
          setFollowing(profile.counts.following);
        }
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
