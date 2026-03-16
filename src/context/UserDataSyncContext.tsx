import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "../context/AuthContext";
import { bootstrapSupabaseUserData, flushSupabaseUserDataSync } from "../services/userDataSync";
import { useAppSettings } from "../settings/AppSettingsContext";

type UserDataSyncContextValue = {
  isReady: boolean;
};

const UserDataSyncContext = createContext<UserDataSyncContextValue | null>(null);

export function UserDataSyncProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { notifyStorageChanged, reloadPersistedSettings } = useAppSettings();
  const [isReady, setIsReady] = useState(!user);

  useEffect(() => {
    let active = true;

    async function runBootstrap() {
      if (!user) {
        if (active) {
          setIsReady(true);
        }
        return;
      }

      if (active) {
        setIsReady(false);
      }

      try {
        await bootstrapSupabaseUserData();
        await reloadPersistedSettings();
        notifyStorageChanged();
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    }

    void runBootstrap();

    return () => {
      active = false;
    };
  }, [notifyStorageChanged, reloadPersistedSettings, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let appState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const cameToForeground = appState.match(/inactive|background/) && nextState === "active";
      appState = nextState;

      if (!cameToForeground) {
        return;
      }

      void flushSupabaseUserDataSync(user.id).then(async () => {
        await reloadPersistedSettings();
        notifyStorageChanged();
      });
    });

    return () => {
      subscription.remove();
    };
  }, [notifyStorageChanged, reloadPersistedSettings, user]);

  const value = useMemo<UserDataSyncContextValue>(() => ({ isReady }), [isReady]);

  return <UserDataSyncContext.Provider value={value}>{children}</UserDataSyncContext.Provider>;
}

export function useUserDataSync() {
  const context = useContext(UserDataSyncContext);
  if (!context) {
    throw new Error("useUserDataSync must be used within UserDataSyncProvider.");
  }

  return context;
}
