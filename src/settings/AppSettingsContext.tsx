import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { enqueueProfileAssetSync, enqueueProfileSettingsSync } from "../services/userDataSync";
import { createTheme, DEFAULT_THEME_ID, type AppTheme, type ThemeId } from "../theme/Theme";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_PROFILE_NAME,
  createDefaultSettings,
  normalizeSettings,
  type PersistedSettings,
} from "./settingsStorage";

export type { PersistedSettings } from "./settingsStorage";
export { APP_SETTINGS_STORAGE_KEY, DEFAULT_PROFILE_NAME } from "./settingsStorage";

type AppSettingsContextValue = {
  activeTheme: AppTheme;
  themeId: ThemeId;
  profileName: string;
  profileBio: string;
  profileLocation: string;
  profileBirthday: string;
  joinedDate: string;
  profileImageUri: string | null;
  bannerImageUri: string | null;
  isReady: boolean;
  storageRevision: number;
  setThemeId: (themeId: ThemeId) => Promise<void>;
  setProfileName: (profileName: string) => Promise<void>;
  setProfileBio: (bio: string) => Promise<void>;
  setProfileLocation: (location: string) => Promise<void>;
  setProfileBirthday: (birthday: string) => Promise<void>;
  updateProfile: (profile: ProfileSettingsUpdate) => Promise<void>;
  setJoinedDate: (date: string) => Promise<void>;
  setProfileImageUri: (profileImageUri: string | null) => Promise<void>;
  setBannerImageUri: (bannerImageUri: string | null) => Promise<void>;
  reloadPersistedSettings: () => Promise<void>;
  notifyStorageChanged: () => void;
};

type ProfileSettingsUpdate = Partial<
  Pick<PersistedSettings, "profileName" | "profileBio" | "profileLocation" | "profileBirthday">
>;

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<PersistedSettings>(() => createDefaultSettings(DEFAULT_THEME_ID));
  const settingsRef = useRef(settings);
  const [isReady, setIsReady] = useState(false);
  const [storageRevision, setStorageRevision] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const hydrateSettings = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY);
      const next = raw
        ? normalizeSettings(JSON.parse(raw) as Partial<PersistedSettings>, DEFAULT_THEME_ID)
        : createDefaultSettings(DEFAULT_THEME_ID);
      settingsRef.current = next;
      setSettings(next);
    } catch {
      const fallback = createDefaultSettings(DEFAULT_THEME_ID);
      settingsRef.current = fallback;
      setSettings(fallback);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        await hydrateSettings();
        if (!settingsRef.current.joinedDate) {
          const now = new Date().toISOString();
          const updated: PersistedSettings = { ...settingsRef.current, joinedDate: now };
          settingsRef.current = updated;
          setSettings(updated);
          await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
        }
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [hydrateSettings]);

  const notifyStorageChanged = useCallback(() => {
    setStorageRevision((current) => current + 1);
  }, []);

  const persist = useCallback(
    async (
      partial: Partial<PersistedSettings>,
      options?: {
        syncRemote?: boolean;
        auditMetadata?: Record<string, unknown>;
      }
    ) => {
      const next: PersistedSettings = {
        ...settingsRef.current,
        ...partial,
      };

      settingsRef.current = next;
      setSettings(next);
      await AsyncStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      notifyStorageChanged();

      if (options?.syncRemote === false) {
        return;
      }

      void enqueueProfileSettingsSync(next, options?.auditMetadata ?? {});
    },
    [notifyStorageChanged]
  );

  const setThemeId = useCallback(async (themeId: ThemeId) => {
    await persist({ themeId }, { auditMetadata: { source: "theme_picker" } });
  }, [persist]);

  const setProfileName = useCallback(async (profileName: string) => {
    await persist(
      {
        profileName: profileName.trim() || DEFAULT_PROFILE_NAME,
      },
      { auditMetadata: { source: "profile_edit", fields: ["profileName"] } }
    );
  }, [persist]);

  const setProfileBio = useCallback(async (bio: string) => {
    await persist({ profileBio: bio }, { auditMetadata: { source: "profile_edit", fields: ["profileBio"] } });
  }, [persist]);

  const setProfileLocation = useCallback(async (location: string) => {
    await persist(
      { profileLocation: location },
      { auditMetadata: { source: "profile_edit", fields: ["profileLocation"] } }
    );
  }, [persist]);

  const setProfileBirthday = useCallback(async (birthday: string) => {
    await persist(
      { profileBirthday: birthday },
      { auditMetadata: { source: "profile_edit", fields: ["profileBirthday"] } }
    );
  }, [persist]);

  const updateProfile = useCallback(async (profile: ProfileSettingsUpdate) => {
    const changedFields: string[] = [];
    if (profile.profileName !== undefined) changedFields.push("profileName");
    if (profile.profileBio !== undefined) changedFields.push("profileBio");
    if (profile.profileLocation !== undefined) changedFields.push("profileLocation");
    if (profile.profileBirthday !== undefined) changedFields.push("profileBirthday");

    await persist(
      {
        ...(profile.profileName !== undefined
          ? { profileName: profile.profileName.trim() || DEFAULT_PROFILE_NAME }
          : {}),
        ...(profile.profileBio !== undefined ? { profileBio: profile.profileBio } : {}),
        ...(profile.profileLocation !== undefined ? { profileLocation: profile.profileLocation.trim() } : {}),
        ...(profile.profileBirthday !== undefined ? { profileBirthday: profile.profileBirthday.trim() } : {}),
      },
      { auditMetadata: { source: "profile_edit", fields: changedFields } }
    );
  }, [persist]);

  const setJoinedDate = useCallback(async (date: string) => {
    await persist({ joinedDate: date }, { auditMetadata: { source: "profile_seed", fields: ["joinedDate"] } });
  }, [persist]);

  const setProfileImageUri = useCallback(async (profileImageUri: string | null) => {
    const previousSettings = settingsRef.current;
    await persist({ profileImageUri }, { syncRemote: false });
    void enqueueProfileAssetSync(
      "avatar",
      profileImageUri,
      previousSettings.profileImageStoragePath,
      previousSettings.profileImageVersion
    );
  }, [persist]);

  const setBannerImageUri = useCallback(async (bannerImageUri: string | null) => {
    const previousSettings = settingsRef.current;
    await persist({ bannerImageUri }, { syncRemote: false });
    void enqueueProfileAssetSync(
      "banner",
      bannerImageUri,
      previousSettings.bannerImageStoragePath,
      previousSettings.bannerImageVersion
    );
  }, [persist]);

  const reloadPersistedSettings = useCallback(async () => {
    await hydrateSettings();
    notifyStorageChanged();
  }, [hydrateSettings, notifyStorageChanged]);

  const value = useMemo<AppSettingsContextValue>(() => ({
    activeTheme: createTheme(settings.themeId),
    themeId: settings.themeId,
    profileName: settings.profileName,
    profileBio: settings.profileBio,
    profileLocation: settings.profileLocation,
    profileBirthday: settings.profileBirthday,
    joinedDate: settings.joinedDate,
    profileImageUri: settings.profileImageUri,
    bannerImageUri: settings.bannerImageUri,
    isReady,
    storageRevision,
    setThemeId,
    setProfileName,
    setProfileBio,
    setProfileLocation,
    setProfileBirthday,
    updateProfile,
    setJoinedDate,
    setProfileImageUri,
    setBannerImageUri,
    reloadPersistedSettings,
    notifyStorageChanged,
  }), [
    isReady,
    notifyStorageChanged,
    reloadPersistedSettings,
    setBannerImageUri,
    setJoinedDate,
    setProfileBio,
    setProfileBirthday,
    setProfileImageUri,
    setProfileLocation,
    setProfileName,
    setThemeId,
    settings,
    storageRevision,
    updateProfile,
  ]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider.");
  }

  return context;
}
