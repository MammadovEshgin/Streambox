import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileRpcPayload,
  buildProfileRowPayload,
  formatBirthdayForDatabase,
  isLocalFileUri,
} from "../src/utils/profileSyncPayload";
import type { PersistedSettings } from "../src/settings/settingsStorage";

// Minimal settings factory — only the profile/asset fields matter here.
function settings(overrides: Partial<PersistedSettings> = {}): PersistedSettings {
  return {
    themeId: "emerald-noir",
    language: "en",
    personaPresentation: "auto",
    profileName: "Eshgin",
    profileBio: "",
    profileLocation: "",
    profileBirthday: "",
    joinedDate: "2026-01-01T00:00:00.000Z",
    profileImageUri: null,
    bannerImageUri: null,
    profileImageStoragePath: null,
    bannerImageStoragePath: null,
    profileImageVersion: 0,
    bannerImageVersion: 0,
    ...overrides,
  } as unknown as PersistedSettings;
}

test("a device with degraded image state can NOT wipe remote asset pointers (the vanished-images bug)", () => {
  // The sync RPC treats a PRESENT-but-null avatarPath/bannerPath key as an
  // explicit "set NULL". The old builder included the keys whenever the local
  // URI wasn't a file:// — so after a reinstall/cleared cache, any ordinary
  // settings sync (e.g. a theme change) nulled avatar_path/banner_path in
  // user_profiles and the images vanished on every device.
  const degraded = settings({
    profileImageUri: null,
    bannerImageUri: "https://project.supabase.co/storage/signed-url", // stale remote URI
    profileImageStoragePath: null,
    bannerImageStoragePath: null,
  });

  const rpc = buildProfileRpcPayload(degraded);
  assert.equal("avatarPath" in rpc, false, "avatarPath must be omitted, not null");
  assert.equal("bannerPath" in rpc, false, "bannerPath must be omitted, not null");
  assert.equal("avatarVersion" in rpc, false);
  assert.equal("bannerVersion" in rpc, false);

  const row = buildProfileRowPayload(degraded);
  assert.equal("avatar_path" in row, false);
  assert.equal("banner_path" in row, false);
});

test("held storage paths are still synced with their versions", () => {
  const healthy = settings({
    profileImageUri: "file:///data/user/0/app/files/streambox/profile-image.jpg",
    bannerImageUri: "file:///data/user/0/app/files/streambox/banner-image.jpg",
    profileImageStoragePath: "uid/avatars/avatar-1719000000000.jpg",
    bannerImageStoragePath: "uid/banners/banner-1719000000001.jpg",
    profileImageVersion: 3,
    bannerImageVersion: 2,
  });

  const rpc = buildProfileRpcPayload(healthy);
  assert.equal(rpc.avatarPath, "uid/avatars/avatar-1719000000000.jpg");
  assert.equal(rpc.avatarVersion, 3);
  assert.equal(rpc.bannerPath, "uid/banners/banner-1719000000001.jpg");
  assert.equal(rpc.bannerVersion, 2);

  const row = buildProfileRowPayload(healthy);
  assert.equal(row.avatar_path, "uid/avatars/avatar-1719000000000.jpg");
  assert.equal(row.banner_version, 2);
});

test("mixed state syncs only the pointer that is actually held", () => {
  const mixed = settings({
    profileImageStoragePath: "uid/avatars/avatar-1719000000000.jpg",
    profileImageVersion: 1,
    bannerImageStoragePath: null,
  });

  const rpc = buildProfileRpcPayload(mixed);
  assert.equal(rpc.avatarPath, "uid/avatars/avatar-1719000000000.jpg");
  assert.equal("bannerPath" in rpc, false);
});

test("profile fields still flow through the payloads", () => {
  const s = settings({ profileName: "Eshgin", profileBirthday: "07/03/1999" });
  const rpc = buildProfileRpcPayload(s);
  assert.equal(rpc.displayName, "Eshgin");
  assert.equal(rpc.birthday, "1999-03-07");
  const row = buildProfileRowPayload(s);
  assert.equal(row.display_name, "Eshgin");
});

test("formatBirthdayForDatabase validates real dates and rejects junk", () => {
  assert.equal(formatBirthdayForDatabase("07/03/1999"), "1999-03-07");
  assert.equal(formatBirthdayForDatabase(""), null);
  assert.equal(formatBirthdayForDatabase("31/02/2000"), null);
  assert.equal(formatBirthdayForDatabase("not-a-date"), null);
});

test("isLocalFileUri only accepts file:// strings", () => {
  assert.equal(isLocalFileUri("file:///x/y.jpg"), true);
  assert.equal(isLocalFileUri("https://x/y.jpg"), false);
  assert.equal(isLocalFileUri(null), false);
  assert.equal(isLocalFileUri(undefined), false);
});
