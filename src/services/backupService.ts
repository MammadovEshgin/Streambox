import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import {
  createProfileImageBackup,
  restoreProfileImageFromBackup,
  type ProfileImageBackupPayload,
} from "./profileImageService";
import { APP_SETTINGS_STORAGE_KEY, DEFAULT_PROFILE_NAME, type PersistedSettings } from "../settings/AppSettingsContext";
import { DEFAULT_THEME_ID } from "../theme/Theme";

const FIRST_OPEN_STORAGE_KEY = "@streambox/first-open-complete-v6";
const WATCHLIST_STORAGE_KEY = "streambox/watchlist";
const SERIES_WATCHLIST_STORAGE_KEY = "streambox/series-watchlist";
const LIKED_MOVIES_STORAGE_KEY = "streambox/liked-movies";
const LIKED_SERIES_STORAGE_KEY = "streambox/liked-series";
const WATCH_HISTORY_STORAGE_KEY = "streambox/watch-history";
const RECENTLY_WATCHED_STORAGE_KEY = "streambox/recently-watched";
const WATCHED_EPISODES_STORAGE_KEY = "@watched_episodes";
const MOVIE_OF_DAY_CURRENT_STORAGE_KEY = "streambox/movie-of-day/current";
const MOVIE_OF_DAY_HISTORY_STORAGE_KEY = "streambox/movie-of-day/history";

const STREAMBOX_BACKUP_STORAGE_KEYS = [
  FIRST_OPEN_STORAGE_KEY,
  APP_SETTINGS_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  SERIES_WATCHLIST_STORAGE_KEY,
  LIKED_MOVIES_STORAGE_KEY,
  LIKED_SERIES_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  RECENTLY_WATCHED_STORAGE_KEY,
  WATCHED_EPISODES_STORAGE_KEY,
  MOVIE_OF_DAY_CURRENT_STORAGE_KEY,
  MOVIE_OF_DAY_HISTORY_STORAGE_KEY,
] as const;

type StreamBoxStorageKey = (typeof STREAMBOX_BACKUP_STORAGE_KEYS)[number];

type StreamBoxBackup = {
  appName: "StreamBox";
  schemaVersion: 1;
  exportedAt: string;
  storage: Partial<Record<StreamBoxStorageKey, string>>;
  profileImage?: ProfileImageBackupPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePersistedSettings(raw: string | undefined): PersistedSettings | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      themeId: parsed.themeId ?? DEFAULT_THEME_ID,
      profileName: typeof parsed.profileName === "string" ? parsed.profileName : DEFAULT_PROFILE_NAME,
      profileBio: typeof parsed.profileBio === "string" ? parsed.profileBio : "",
      profileLocation: typeof parsed.profileLocation === "string" ? parsed.profileLocation : "",
      profileBirthday: typeof parsed.profileBirthday === "string" ? parsed.profileBirthday : "",
      joinedDate: typeof parsed.joinedDate === "string" ? parsed.joinedDate : "",
      profileImageUri: typeof parsed.profileImageUri === "string" ? parsed.profileImageUri : null,
      bannerImageUri: typeof parsed.bannerImageUri === "string" ? parsed.bannerImageUri : null,
      profileImageStoragePath: typeof parsed.profileImageStoragePath === "string" ? parsed.profileImageStoragePath : null,
      bannerImageStoragePath: typeof parsed.bannerImageStoragePath === "string" ? parsed.bannerImageStoragePath : null,
      profileImageVersion: typeof parsed.profileImageVersion === "number" ? parsed.profileImageVersion : 0,
      bannerImageVersion: typeof parsed.bannerImageVersion === "number" ? parsed.bannerImageVersion : 0,
    } satisfies PersistedSettings;
  } catch {
    return null;
  }
}

function resolveBackupFileUri() {
  const rootDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!rootDirectory) {
    throw new Error("Backup storage is unavailable on this device.");
  }

  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `${rootDirectory}streambox-backup-${timestamp}.json`;
}

async function createBackupPayload(): Promise<StreamBoxBackup> {
  const entries = await AsyncStorage.multiGet([...STREAMBOX_BACKUP_STORAGE_KEYS]);
  const storage = entries.reduce<Partial<Record<StreamBoxStorageKey, string>>>((accumulator, [key, value]) => {
    if (value !== null) {
      accumulator[key as StreamBoxStorageKey] = value;
    }
    return accumulator;
  }, {});

  const settings = parsePersistedSettings(storage[APP_SETTINGS_STORAGE_KEY]);
  const profileImage = settings?.profileImageUri
    ? await createProfileImageBackup(settings.profileImageUri)
    : null;

  return {
    appName: "StreamBox",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    storage,
    ...(profileImage ? { profileImage } : {}),
  };
}

function parseBackup(raw: string): StreamBoxBackup {
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed) || parsed.appName !== "StreamBox" || parsed.schemaVersion !== 1 || !isRecord(parsed.storage)) {
    throw new Error("This file is not a valid StreamBox backup.");
  }

  const storage = Object.entries(parsed.storage).reduce<Partial<Record<StreamBoxStorageKey, string>>>((accumulator, [key, value]) => {
    if (
      STREAMBOX_BACKUP_STORAGE_KEYS.includes(key as StreamBoxStorageKey)
      && typeof value === "string"
    ) {
      accumulator[key as StreamBoxStorageKey] = value;
    }
    return accumulator;
  }, {});

  const profileImage = isRecord(parsed.profileImage)
    && typeof parsed.profileImage.base64 === "string"
    && typeof parsed.profileImage.fileExtension === "string"
    ? {
        base64: parsed.profileImage.base64,
        fileExtension: parsed.profileImage.fileExtension,
      }
    : undefined;

  return {
    appName: "StreamBox",
    schemaVersion: 1,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date(0).toISOString(),
    storage,
    ...(profileImage ? { profileImage } : {}),
  };
}

export async function exportStreamBoxBackupFile() {
  const payload = await createBackupPayload();
  const fileUri = resolveBackupFileUri();

  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return {
    fileUri,
    exportedAt: payload.exportedAt,
  };
}

export async function pickStreamBoxBackupFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/json", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) {
    return null;
  }

  return result.assets?.[0]?.uri ?? null;
}

export async function importStreamBoxBackupFile(fileUri: string) {
  const raw = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const payload = parseBackup(raw);
  const nextStorage = { ...payload.storage };

  if (payload.profileImage) {
    const settings = parsePersistedSettings(nextStorage[APP_SETTINGS_STORAGE_KEY]);
    if (settings) {
      const restoredProfileImageUri = await restoreProfileImageFromBackup(payload.profileImage);
      nextStorage[APP_SETTINGS_STORAGE_KEY] = JSON.stringify({
        ...settings,
        profileImageUri: restoredProfileImageUri,
        profileImageStoragePath: settings.profileImageStoragePath,
        bannerImageStoragePath: settings.bannerImageStoragePath,
        profileImageVersion: settings.profileImageVersion,
        bannerImageVersion: settings.bannerImageVersion,
      } satisfies PersistedSettings);
    }
  }

  const setPairs = STREAMBOX_BACKUP_STORAGE_KEYS.reduce<Array<[string, string]>>((accumulator, key) => {
    const value = nextStorage[key];
    if (typeof value === "string") {
      accumulator.push([key, value]);
    }
    return accumulator;
  }, []);

  const removeKeys = STREAMBOX_BACKUP_STORAGE_KEYS.filter((key) => nextStorage[key] == null);

  if (removeKeys.length > 0) {
    await AsyncStorage.multiRemove(removeKeys);
  }

  if (setPairs.length > 0) {
    await AsyncStorage.multiSet(setPairs);
  }

  return {
    restoredKeys: setPairs.length,
    exportedAt: payload.exportedAt,
  };
}





