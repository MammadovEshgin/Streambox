import type { PersistedSettings } from "../settings/settingsStorage";

// Pure builders for the profile/settings sync payloads. Extracted from
// userDataSync so the invariant behind the vanished-profile-images bug can be
// unit-tested: the sync RPC treats a PRESENT-but-null avatarPath/bannerPath
// key as an explicit "set NULL", so these builders must OMIT the asset keys
// entirely unless the device actually holds a storage path. A device whose
// local image state degraded (cleared cache, fresh install) must never be
// able to wipe the remote pointers through an ordinary settings sync.

export function isLocalFileUri(uri: string | null | undefined): uri is string {
  return typeof uri === "string" && uri.startsWith("file://");
}

export function formatBirthdayForDatabase(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;
  const day = Number(parts[0]); const month = Number(parts[1]); const year = Number(parts[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildProfileRpcPayload(s: PersistedSettings) {
  const payload: Record<string, unknown> = {
    displayName: s.profileName,
    bio: s.profileBio,
    location: s.profileLocation,
    birthday: formatBirthdayForDatabase(s.profileBirthday),
    joinedAt: s.joinedDate || new Date().toISOString(),
  };

  if (s.profileImageStoragePath) {
    payload.avatarPath = s.profileImageStoragePath;
    payload.avatarVersion = s.profileImageVersion;
  }

  if (s.bannerImageStoragePath) {
    payload.bannerPath = s.bannerImageStoragePath;
    payload.bannerVersion = s.bannerImageVersion;
  }

  return payload;
}

export function buildProfileRowPayload(s: PersistedSettings) {
  const payload: Record<string, unknown> = {
    display_name: s.profileName,
    bio: s.profileBio,
    location: s.profileLocation,
    location_text: s.profileLocation,
    birthday: formatBirthdayForDatabase(s.profileBirthday),
    joined_at: s.joinedDate || new Date().toISOString(),
  };

  if (s.profileImageStoragePath) {
    payload.avatar_path = s.profileImageStoragePath;
    payload.avatar_version = s.profileImageVersion;
  }

  if (s.bannerImageStoragePath) {
    payload.banner_path = s.bannerImageStoragePath;
    payload.banner_version = s.bannerImageVersion;
  }

  return payload;
}
