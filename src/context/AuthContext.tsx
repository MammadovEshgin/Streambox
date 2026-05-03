import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Session, User } from "@supabase/supabase-js";

import {
  clearLocalUserDataCache,
  flushSupabaseUserDataSync,
  logSupabaseUserEvent,
  syncCurrentLocalUserSnapshotToSupabase,
} from "../services/userDataSync";
import { clearFranchiseCache } from "../api/franchises";
import { clearFranchiseImageCache } from "../services/franchisePosterCache";
import { clearManagedRemoteImageCaches } from "../services/remoteImageCache";
import { clearPersistedRuntimeCaches } from "../services/runtimeCache";
import { signOutFromGoogle } from "../services/auth";
import { supabase } from "../services/supabase";
import { useAppSettings } from "../settings/AppSettingsContext";

const LAST_ACTIVE_KEY = "@streambox/last-active-ts";
const INACTIVITY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function stampActivity() {
  await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

async function isSessionExpiredByInactivity(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
  if (!raw) {
    return false;
  }

  return Date.now() - Number(raw) > INACTIVITY_LIMIT_MS;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const signOutPromiseRef = useRef<Promise<void> | null>(null);
  const { reloadPersistedSettings } = useAppSettings();

  useEffect(() => {
    let active = true;

    async function init() {
      const {
        data: { session: initialSession },
      } = await supabase.auth.getSession();

      if (initialSession) {
        const expired = await isSessionExpiredByInactivity();
        if (expired) {
          await logSupabaseUserEvent(
            "auth",
            "session_expired",
            { source: "inactivity_guard" },
            { entityType: "session", entityKey: initialSession.user.id, flushImmediately: true }
          ).catch(() => undefined);
          await syncCurrentLocalUserSnapshotToSupabase(initialSession.user.id).catch(() => undefined);
          await Promise.allSettled([
            supabase.auth.signOut(),
            signOutFromGoogle(),
          ]);
          await Promise.all([
            AsyncStorage.removeItem(LAST_ACTIVE_KEY),
            clearLocalUserDataCache(),
            clearFranchiseCache(),
            clearFranchiseImageCache(),
            clearManagedRemoteImageCaches(),
            clearPersistedRuntimeCaches(),
          ]);
          await reloadPersistedSettings().catch(() => undefined);
          if (active) {
            setSession(null);
            setIsLoading(false);
          }
          return;
        }

        await stampActivity();
      }

      if (active) {
        setSession(initialSession);
        setIsLoading(false);
      }
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession);

      if (nextSession) {
        await stampActivity();
      }

      if (event === "SIGNED_IN" && nextSession) {
        await logSupabaseUserEvent(
          "auth",
          "signed_in",
          { source: "auth_state_change" },
          { entityType: "session", entityKey: nextSession.user.id }
        ).catch(() => undefined);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const switchedState =
        (appStateRef.current.match(/inactive|background/) && nextState === "active")
        || (appStateRef.current === "active" && nextState.match(/inactive|background/));

      if (switchedState && session) {
        void stampActivity();
      }

      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [session]);

  const handleSignOut = useCallback(async () => {
    if (signOutPromiseRef.current) {
      await signOutPromiseRef.current;
      return;
    }

    const activeSession = session;
    signOutPromiseRef.current = (async () => {
      try {
        if (activeSession?.user.id) {
          await flushSupabaseUserDataSync(activeSession.user.id).catch(() => undefined);
          await syncCurrentLocalUserSnapshotToSupabase(activeSession.user.id).catch(() => undefined);
          await logSupabaseUserEvent(
            "auth",
            "signed_out",
            { source: "manual_sign_out" },
            { entityType: "session", entityKey: activeSession.user.id, flushImmediately: true }
          ).catch(() => undefined);
        }

        await Promise.allSettled([
          supabase.auth.signOut(),
          signOutFromGoogle(),
        ]);

        await Promise.all([
          AsyncStorage.removeItem(LAST_ACTIVE_KEY).catch(() => undefined),
          clearLocalUserDataCache().catch(() => undefined),
          clearFranchiseCache().catch(() => undefined),
          clearFranchiseImageCache().catch(() => undefined),
          clearManagedRemoteImageCaches().catch(() => undefined),
          clearPersistedRuntimeCaches().catch(() => undefined),
        ]);
        await reloadPersistedSettings().catch(() => undefined);
        setSession(null);
      } catch (err) {
        console.error("Sign out cleanup failed:", err);
        throw err;
      } finally {
        signOutPromiseRef.current = null;
      }
    })();

    await signOutPromiseRef.current;
  }, [reloadPersistedSettings, session]);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    isLoading,
    signOut: handleSignOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}


