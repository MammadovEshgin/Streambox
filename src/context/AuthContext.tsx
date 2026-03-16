import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Session, User } from "@supabase/supabase-js";

import { clearLocalUserDataCache, logSupabaseUserEvent } from "../services/userDataSync";
import { supabase } from "../services/supabase";

const LAST_ACTIVE_KEY = "@streambox/last-active-ts";
const FIRST_OPEN_KEY = "@streambox/first-open-complete-v6";
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
          await supabase.auth.signOut();
          await AsyncStorage.removeItem(LAST_ACTIVE_KEY);
          await clearLocalUserDataCache();
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
    // Clear session immediately for instant UI response
    setSession(null);

    // Run all cleanup in parallel in the background without blocking the UI transition
    const runCleanup = async () => {
      try {
        const cleanup = [
          AsyncStorage.removeItem(LAST_ACTIVE_KEY).catch(() => undefined),
          AsyncStorage.removeItem(FIRST_OPEN_KEY).catch(() => undefined),
          clearLocalUserDataCache().catch(() => undefined),
          supabase.auth.signOut().catch(() => undefined),
        ];

        if (session) {
          cleanup.push(
            logSupabaseUserEvent(
              "auth",
              "signed_out",
              { source: "manual_sign_out" },
              { entityType: "session", entityKey: session.user.id, flushImmediately: true }
            ).catch(() => undefined)
          );
        }

        await Promise.all(cleanup);
      } catch (err) {
        console.error("Sign out cleanup failed:", err);
      }
    };

    // We intentionally do NOT await runCleanup here to make it "instant" from the UI perspective
    void runCleanup();
  }, [session]);

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


