import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "../context/AuthContext";
import {
  bootstrapSupabaseUserData,
  flushSupabaseUserDataSync,
  hasWarmBootstrappedUserData,
} from "../services/userDataSync";
import { useAppSettings } from "../settings/AppSettingsContext";

type UserDataSyncContextValue = {
  isReady: boolean;
};

const UserDataSyncContext = createContext<UserDataSyncContextValue | null>(null);

export function UserDataSyncProvider({ children }: PropsWithChildren) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { notifyStorageChanged, reloadPersistedSettings } = useAppSettings();
  const userId = user?.id ?? null;
  const [readyState, setReadyState] = useState<{ userId: string | null; ready: boolean }>({
    userId: null,
    ready: true,
  });
  const isReady = !userId || (readyState.userId === userId && readyState.ready);

  useEffect(() => {
    let active = true;

    async function runBootstrap() {
      if (isAuthLoading) {
        return;
      }

      if (!userId) {
        if (active) {
          setReadyState({ userId: null, ready: true });
        }
        return;
      }

      setReadyState({ userId, ready: false });
      const hasWarmLocalSnapshot = await hasWarmBootstrappedUserData(userId).catch(() => false);
      if (active) {
        setReadyState({ userId, ready: hasWarmLocalSnapshot });
      }

      try {
        await bootstrapSupabaseUserData();
        await reloadPersistedSettings();
        notifyStorageChanged();
      } catch (e) {
        console.error("[UserDataSync] bootstrap failed:", e);
      } finally {
        if (active) {
          setReadyState({ userId, ready: true });
        }
      }
    }

    void runBootstrap();

    return () => {
      active = false;
    };
  }, [isAuthLoading, notifyStorageChanged, reloadPersistedSettings, userId]);

  useEffect(() => {
    if (isAuthLoading || !userId) {
      return;
    }

    let appState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const cameToForeground = appState.match(/inactive|background/) && nextState === "active";
      const movedToBackground = appState === "active" && nextState.match(/inactive|background/);
      appState = nextState;

      if (movedToBackground) {
        void flushSupabaseUserDataSync(userId);
      }

      if (cameToForeground) {
        void flushSupabaseUserDataSync(userId).then(async () => {
          await reloadPersistedSettings();
          notifyStorageChanged();
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isAuthLoading, notifyStorageChanged, reloadPersistedSettings, userId]);

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
