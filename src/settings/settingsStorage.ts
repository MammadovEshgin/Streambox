import { DEFAULT_LANGUAGE, normalizeAppLanguage, type AppLanguage } from "../localization/types";
import { resolveThemeId, type ThemeId } from "../theme/Theme";

export type PersonaPresentation = "male" | "female";

export type PersistedSettings = {
  themeId: ThemeId;
  language: AppLanguage;
  personaPresentation: PersonaPresentation;
  profileName: string;
  profileBio: string;
  profileLocation: string;
  profileBirthday: string;
  joinedDate: string;
  profileImageUri: string | null;
  bannerImageUri: string | null;
  profileImageStoragePath: string | null;
  bannerImageStoragePath: string | null;
  profileImageVersion: number;
  bannerImageVersion: number;
};

export const APP_SETTINGS_STORAGE_KEY = "@streambox/app-settings-v1";
export const DEFAULT_PROFILE_NAME = "My Profile";
export const DEFAULT_PERSONA_PRESENTATION: PersonaPresentation = "male";

export function normalizePersonaPresentation(value: unknown): PersonaPresentation {
  return value === "female" ? "female" : "male";
}

export function createDefaultSettings(defaultThemeId: ThemeId): PersistedSettings {
  return {
    themeId: defaultThemeId,
    language: DEFAULT_LANGUAGE,
    personaPresentation: DEFAULT_PERSONA_PRESENTATION,
    profileName: DEFAULT_PROFILE_NAME,
    profileBio: "",
    profileLocation: "",
    profileBirthday: "",
    joinedDate: "",
    profileImageUri: null,
    bannerImageUri: null,
    profileImageStoragePath: null,
    bannerImageStoragePath: null,
    profileImageVersion: 0,
    bannerImageVersion: 0,
  };
}

export function normalizeSettings(
  parsed: Partial<PersistedSettings> | null | undefined,
  defaultThemeId: ThemeId
): PersistedSettings {
  return {
    themeId: resolveThemeId(parsed?.themeId, defaultThemeId),
    language: normalizeAppLanguage(parsed?.language),
    personaPresentation: normalizePersonaPresentation(parsed?.personaPresentation),
    profileName: parsed?.profileName?.trim() || DEFAULT_PROFILE_NAME,
    profileBio: parsed?.profileBio ?? "",
    profileLocation: parsed?.profileLocation ?? "",
    profileBirthday: parsed?.profileBirthday ?? "",
    joinedDate: parsed?.joinedDate ?? "",
    profileImageUri: parsed?.profileImageUri ?? null,
    bannerImageUri: parsed?.bannerImageUri ?? null,
    profileImageStoragePath: parsed?.profileImageStoragePath ?? null,
    bannerImageStoragePath: parsed?.bannerImageStoragePath ?? null,
    profileImageVersion:
      typeof parsed?.profileImageVersion === "number" && Number.isFinite(parsed.profileImageVersion)
        ? Math.max(0, Math.trunc(parsed.profileImageVersion))
        : 0,
    bannerImageVersion:
      typeof parsed?.bannerImageVersion === "number" && Number.isFinite(parsed.bannerImageVersion)
        ? Math.max(0, Math.trunc(parsed.bannerImageVersion))
        : 0,
  };
}
