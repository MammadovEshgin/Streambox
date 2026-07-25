import { supabase } from "../services/supabase";
import type { ActivityEventType, ActivityItem } from "../utils/activityFeed";
import type { MediaType } from "./tmdb";

// ---------------------------------------------------------------------------
// Social platform API — typed wrappers over the SECURITY DEFINER RPCs and the
// two directly-readable tables (user_notifications, watch_invites) added in
// migration 20260725120000_social_follow_platform.sql.
//
// Every RPC surfaces a stable `hint` token on failure (rate_limited, taken,
// cooldown, not_mutual, …); normalizeSocialError preserves it so screens can
// localize the message instead of parsing English. All reads project a curated
// public surface — no raw user rows cross this boundary.
// ---------------------------------------------------------------------------

export class SocialRpcError extends Error {
  code: string | null;
  hint: string | null;
  constructor(message: string, code: string | null, hint: string | null) {
    super(message);
    this.name = "SocialRpcError";
    this.code = code;
    this.hint = hint;
  }
}

type PostgrestErrorish = {
  message?: string;
  code?: string | null;
  hint?: string | null;
  details?: string | null;
} | null;

function normalizeSocialError(error: PostgrestErrorish): SocialRpcError {
  return new SocialRpcError(
    error?.message ?? "Something went wrong",
    error?.code ?? null,
    error?.hint ?? null
  );
}

async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function getCurrentUserId(): Promise<string | null> {
  return currentUserId();
}

// ── Shared shapes ───────────────────────────────────────────────────────────
export type UserSummary = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarPath: string | null;
  avatarVersion: number;
};

type UserSummaryRow = {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_path: string | null;
  avatar_version: number | null;
};

function mapUserSummary(row: UserSummaryRow): UserSummary {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    avatarVersion: row.avatar_version ?? 0,
  };
}

// ── Usernames ───────────────────────────────────────────────────────────────
export type SocialProfileRow = {
  id: string;
  display_name: string;
  username: string | null;
  username_changed_at: string | null;
  bio: string;
  location_text: string;
  avatar_path: string | null;
  banner_path: string | null;
  avatar_version: number;
  banner_version: number;
};

export async function setMyUsername(username: string): Promise<SocialProfileRow> {
  const { data, error } = await supabase.rpc("set_my_username", { p_username: username });
  if (error) throw normalizeSocialError(error);
  return data as SocialProfileRow;
}

// ── Public profiles ─────────────────────────────────────────────────────────
export type PublicProfileCounts = {
  watched: number;
  watchlist: number;
  liked: number;
  followers: number;
  following: number;
};

export type PublicProfile = {
  userId: string;
  displayName: string;
  username: string | null;
  bio: string;
  location: string;
  avatarPath: string | null;
  bannerPath: string | null;
  avatarVersion: number;
  bannerVersion: number;
  joinedAt: string;
  isSelf: boolean;
  isFollowing: boolean;
  followsMe: boolean;
  counts: PublicProfileCounts;
};

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("get_public_profile", { p_user_id: userId });
  if (error) throw normalizeSocialError(error);
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const counts = (raw.counts ?? {}) as Partial<PublicProfileCounts>;
  return {
    userId: String(raw.userId),
    displayName: String(raw.displayName ?? ""),
    username: (raw.username as string | null) ?? null,
    bio: String(raw.bio ?? ""),
    location: String(raw.location ?? ""),
    avatarPath: (raw.avatarPath as string | null) ?? null,
    bannerPath: (raw.bannerPath as string | null) ?? null,
    avatarVersion: Number(raw.avatarVersion ?? 0),
    bannerVersion: Number(raw.bannerVersion ?? 0),
    joinedAt: String(raw.joinedAt ?? ""),
    isSelf: Boolean(raw.isSelf),
    isFollowing: Boolean(raw.isFollowing),
    followsMe: Boolean(raw.followsMe),
    counts: {
      watched: Number(counts.watched ?? 0),
      watchlist: Number(counts.watchlist ?? 0),
      liked: Number(counts.liked ?? 0),
      followers: Number(counts.followers ?? 0),
      following: Number(counts.following ?? 0),
    },
  };
}

export type PublicListKind = "watched" | "watchlist" | "liked";

export type PublicListItem = {
  mediaType: MediaType;
  tmdbId: number;
  title: string | null;
  posterPath: string | null;
  activityAt: string;
};

export async function getUserPublicList(params: {
  userId: string;
  list: PublicListKind;
  media?: MediaType | null;
  before?: string | null;
  limit?: number;
}): Promise<PublicListItem[]> {
  const { data, error } = await supabase.rpc("get_user_public_list", {
    p_user_id: params.userId,
    p_list: params.list,
    p_media: params.media ?? null,
    p_before: params.before ?? null,
    p_limit: params.limit ?? 40,
  });
  if (error) throw normalizeSocialError(error);
  const rows = (data ?? []) as {
    media_type: MediaType;
    tmdb_id: number;
    title: string | null;
    poster_path: string | null;
    activity_at: string;
  }[];
  return rows.map((row) => ({
    mediaType: row.media_type,
    tmdbId: Number(row.tmdb_id),
    title: row.title,
    posterPath: row.poster_path,
    activityAt: row.activity_at,
  }));
}

// ── People search ───────────────────────────────────────────────────────────
export type PeopleSearchResult = UserSummary & { isFollowing: boolean };

export async function searchUsers(query: string): Promise<PeopleSearchResult[]> {
  const { data, error } = await supabase.rpc("search_users", { p_query: query });
  if (error) throw normalizeSocialError(error);
  const rows = (data ?? []) as (UserSummaryRow & { is_following: boolean })[];
  return rows.map((row) => ({ ...mapUserSummary(row), isFollowing: Boolean(row.is_following) }));
}

// ── Follow graph ────────────────────────────────────────────────────────────
export async function followUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("follow_user", { p_user_id: userId });
  if (error) throw normalizeSocialError(error);
}

export async function unfollowUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("unfollow_user", { p_user_id: userId });
  if (error) throw normalizeSocialError(error);
}

export type FollowListKind = "followers" | "following";

export type FollowListEntry = UserSummary & {
  isFollowing: boolean;
  followsMe: boolean;
  createdAt: string;
};

export async function getFollowList(params: {
  userId: string;
  kind: FollowListKind;
  before?: string | null;
  limit?: number;
}): Promise<FollowListEntry[]> {
  const { data, error } = await supabase.rpc("get_follow_list", {
    p_user_id: params.userId,
    p_kind: params.kind,
    p_before: params.before ?? null,
    p_limit: params.limit ?? 40,
  });
  if (error) throw normalizeSocialError(error);
  const rows = (data ?? []) as (UserSummaryRow & {
    is_following: boolean;
    follows_me: boolean;
    created_at: string;
  })[];
  return rows.map((row) => ({
    ...mapUserSummary(row),
    isFollowing: Boolean(row.is_following),
    followsMe: Boolean(row.follows_me),
    createdAt: row.created_at,
  }));
}

export async function getMutualFollows(): Promise<UserSummary[]> {
  const { data, error } = await supabase.rpc("get_mutual_follows");
  if (error) throw normalizeSocialError(error);
  return ((data ?? []) as UserSummaryRow[]).map(mapUserSummary);
}

// ── Activity feed ───────────────────────────────────────────────────────────
export async function getFollowingActivity(params?: {
  before?: string | null;
  beforeId?: number | null;
  limit?: number;
}): Promise<ActivityItem[]> {
  const { data, error } = await supabase.rpc("get_following_activity", {
    p_before: params?.before ?? null,
    p_before_id: params?.beforeId ?? null,
    p_limit: params?.limit ?? 50,
  });
  if (error) throw normalizeSocialError(error);
  const rows = (data ?? []) as {
    activity_id: number;
    actor_id: string;
    username: string | null;
    display_name: string;
    avatar_path: string | null;
    avatar_version: number | null;
    event_type: ActivityEventType;
    media_type: MediaType;
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    activityId: Number(row.activity_id),
    actorId: row.actor_id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    avatarVersion: row.avatar_version ?? 0,
    eventType: row.event_type,
    mediaType: row.media_type,
    tmdbId: Number(row.tmdb_id),
    title: row.title,
    posterPath: row.poster_path,
    createdAt: row.created_at,
  }));
}

// ── Notifications ───────────────────────────────────────────────────────────
export type NotificationType = "follow" | "watch_invite";

export type AppNotification = {
  id: number;
  type: NotificationType;
  actorId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: number;
  type: NotificationType;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: Number(row.id),
    type: row.type,
    actorId: row.actor_id,
    payload: row.payload ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function fetchNotifications(params?: {
  before?: string | null;
  limit?: number;
}): Promise<AppNotification[]> {
  let query = supabase
    .from("user_notifications")
    .select("id, type, actor_id, payload, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 40);
  if (params?.before) query = query.lt("created_at", params.before);
  const { data, error } = await query;
  if (error) throw normalizeSocialError(error);
  return ((data ?? []) as NotificationRow[]).map(mapNotification);
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw normalizeSocialError(error);
  return count ?? 0;
}

/** Mark specific notifications read; pass null/undefined to mark all read. */
export async function markNotificationsRead(ids?: number[] | null): Promise<number> {
  const { data, error } = await supabase.rpc("mark_notifications_read", {
    p_ids: ids ?? null,
  });
  if (error) throw normalizeSocialError(error);
  return Number(data ?? 0);
}

// ── Watch invites ───────────────────────────────────────────────────────────
export type WatchInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type WatchInvite = {
  id: string;
  fromUser: string;
  toUser: string;
  roomCode: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: string | null;
  imdbId: string | null;
  status: WatchInviteStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
};

type WatchInviteRow = {
  id: string;
  from_user: string;
  to_user: string;
  room_code: string;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  year: string | null;
  imdb_id: string | null;
  status: WatchInviteStatus;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
};

export function mapWatchInvite(row: WatchInviteRow): WatchInvite {
  return {
    id: row.id,
    fromUser: row.from_user,
    toUser: row.to_user,
    roomCode: row.room_code,
    mediaType: row.media_type,
    tmdbId: Number(row.tmdb_id),
    title: row.title,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    year: row.year,
    imdbId: row.imdb_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
  };
}

export async function sendWatchInvite(params: {
  toUser: string;
  roomCode: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  year?: string | null;
  imdbId?: string | null;
}): Promise<WatchInvite> {
  const { data, error } = await supabase.rpc("send_watch_invite", {
    p_to_user: params.toUser,
    p_room_code: params.roomCode,
    p_media_type: params.mediaType,
    p_tmdb_id: params.tmdbId,
    p_title: params.title,
    p_poster_path: params.posterPath ?? null,
    p_backdrop_path: params.backdropPath ?? null,
    p_year: params.year ?? null,
    p_imdb_id: params.imdbId ?? null,
  });
  if (error) throw normalizeSocialError(error);
  return mapWatchInvite(data as WatchInviteRow);
}

export async function respondWatchInvite(
  inviteId: string,
  accept: boolean
): Promise<WatchInvite> {
  const { data, error } = await supabase.rpc("respond_watch_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) throw normalizeSocialError(error);
  return mapWatchInvite(data as WatchInviteRow);
}

export async function cancelWatchInvite(inviteId: string): Promise<WatchInvite> {
  const { data, error } = await supabase.rpc("cancel_watch_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw normalizeSocialError(error);
  return mapWatchInvite(data as WatchInviteRow);
}

export async function getWatchInvite(inviteId: string): Promise<WatchInvite | null> {
  const { data, error } = await supabase.rpc("get_watch_invite", { p_invite_id: inviteId });
  if (error) throw normalizeSocialError(error);
  if (!data) return null;
  return mapWatchInvite(data as WatchInviteRow);
}

// ── Push tokens ─────────────────────────────────────────────────────────────
export async function registerPushToken(
  token: string,
  platform: "android" | "ios" = "android"
): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw normalizeSocialError(error);
}

export async function removePushToken(token: string): Promise<void> {
  const { error } = await supabase.from("user_push_tokens").delete().eq("token", token);
  if (error) throw normalizeSocialError(error);
}

// ── Avatar / banner URL resolution ──────────────────────────────────────────
// profile-assets is a PRIVATE bucket; peers' avatars/banners are readable via
// the profile_assets_peer_read policy (migration 20260725120000). Resolve to
// short-lived signed URLs, cached per session so poster rails don't re-sign on
// every render. Cache key includes the version so a new upload busts it.
const PROFILE_ASSETS_BUCKET = "profile-assets";
const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

type CachedSignedUrl = { url: string; expiresAt: number };
const signedUrlCache = new Map<string, CachedSignedUrl>();

export async function resolveProfileAssetUrl(
  path: string | null | undefined,
  version = 0
): Promise<string | null> {
  if (!path) return null;
  const key = `${path}@${version}`;
  const cached = signedUrlCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > now) {
    return cached.url;
  }
  try {
    const { data, error } = await supabase.storage
      .from(PROFILE_ASSETS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      signedUrlCache.set(key, { url: data.signedUrl, expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 });
      return data.signedUrl;
    }
  } catch {
    // fall through to public-url fallback
  }
  try {
    const { data } = supabase.storage.from(PROFILE_ASSETS_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}
