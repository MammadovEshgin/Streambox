import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Session, User } from "@supabase/supabase-js";

import {
  clearLocalUserDataCache,
  drainSupabaseUserDataSync,
  logSupabaseUserEvent,
  syncCurrentLocalUserSnapshotToSupabase,
} from "../services/userDataSync";
import { clearFranchiseCache } from "../api/franchises";
import { clearManagedRemoteImageCaches } from "../services/remoteImageCache";
import { clearPersistedRuntimeCaches } from "../services/runtimeCache";
import { signOutFromGoogle } from "../services/auth";
import { clearSupabaseAuthStorage, supabase } from "../services/supabase";
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

function isInvalidRefreshTokenError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { message?: string; code?: string } : null;
  const message = candidate?.message?.toLowerCase() ?? "";
  return candidate?.code === "refresh_token_not_found"
    || candidate?.code === "refresh_token_already_used"
    || (message.includes("invalid refresh token") && message.includes("refresh token"));
}

// True when the session's access token has already expired. supabase-js stores
// expires_at in SECONDS.
function isAccessTokenExpired(session: Session): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 <= Date.now();
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const signOutPromiseRef = useRef<Promise<void> | null>(null);
  const { reloadPersistedSettings } = useAppSettings();

  // Tokens only. Used by every INVOLUNTARY auth loss (dead refresh token,
  // init failure, inactivity guard): the user did not ask to leave, so their
  // lists, settings and the pending sync queue stay on-device — whatever the
  // cloud was missing survives, and it all reconciles when they sign back in.
  // Wiping user data on these paths is how an auth hiccup after an update
  // erased a whole liked list that had never fully reached the cloud.
  const purgeAuthTokensOnly = useCallback(async () => {
    await Promise.allSettled([
      clearSupabaseAuthStorage(),
      signOutFromGoogle(),
      AsyncStorage.removeItem(LAST_ACTIVE_KEY),
    ]);
  }, []);

  // Full device cleanup — EXPLICIT sign-out only. The sync queue is preserved
  // even here: its ops are tagged per user, so an un-flushed delete survives
  // the wipe and executes when its owner signs back in (bootstrap drops the
  // queue if a different account signs in instead).
  const clearDeviceAuthState = useCallback(async () => {
    await Promise.allSettled([
      clearSupabaseAuthStorage(),
      signOutFromGoogle(),
      AsyncStorage.removeItem(LAST_ACTIVE_KEY),
      clearLocalUserDataCache({ preserveSyncQueue: true }),
      clearFranchiseCache(),
      clearManagedRemoteImageCaches(),
      clearPersistedRuntimeCaches(),
      reloadPersistedSettings(),
    ]);
  }, [reloadPersistedSettings]);

  useEffect(() => {
    let active = true;

    async function init() {
      const {
        data: { session: initialSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        if (isInvalidRefreshTokenError(sessionError)) {
          // Involuntary: the token died, the user didn't leave. Keep their data.
          await purgeAuthTokensOnly();
          if (active) {
            setSession(null);
            setIsLoading(false);
          }
          return;
        }

        throw sessionError;
      }

      if (initialSession) {
        const expired = await isSessionExpiredByInactivity();
        if (expired) {
          await logSupabaseUserEvent(
            "auth",
            "session_expired",
            { source: "inactivity_guard" },
            { entityType: "session", entityKey: initialSession.user.id, flushImmediately: true }
          ).catch(() => undefined);
          // Best-effort push, then drop ONLY the session. Data + queue stay:
          // this fires precisely when someone returns after a month away — the
          // worst possible moment to gamble their lists on one network call.
          await drainSupabaseUserDataSync(initialSession.user.id).catch(() => undefined);
          await syncCurrentLocalUserSnapshotToSupabase(initialSession.user.id).catch(() => undefined);
          await purgeAuthTokensOnly();
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

    void init().catch(async (error) => {
      console.warn("Auth initialization failed:", error);
      // A transient init failure must never cost the user their local data —
      // drop the session only; everything reconciles on the next sign-in.
      await purgeAuthTokensOnly();
      if (active) {
        setSession(null);
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      try {
        // Cold start can recover a stale session from storage whose access
        // token already expired and whose refresh token is dead. With
        // autoRefreshToken disabled, supabase-js still emits it as SIGNED_IN
        // without refreshing or removing it. Accepting it would render the app
        // as logged-in and make the next Supabase call emit
        // "Invalid Refresh Token: Refresh Token Not Found". Drop it instead —
        // init()'s getSession() purges the stored token, and a genuinely
        // refreshable session is re-delivered here as TOKEN_REFRESHED.
        if (nextSession && event !== "SIGNED_OUT" && isAccessTokenExpired(nextSession)) {
          setSession(null);
          return;
        }

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
      } catch (err) {
        // A throw here propagates back into supabase-js's subscriber loop,
        // which console.errors it. Keep auth-state handling self-contained.
        if (__DEV__) console.warn("Auth state change handler failed:", err);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [purgeAuthTokensOnly]);

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
          // Drain (not a single 25-op flush) so the whole backlog reaches the
          // cloud before local data is wiped; anything that still can't flush
          // survives the wipe in the preserved queue.
          await drainSupabaseUserDataSync(activeSession.user.id).catch(() => undefined);
          await syncCurrentLocalUserSnapshotToSupabase(activeSession.user.id).catch(() => undefined);
          await logSupabaseUserEvent(
            "auth",
            "signed_out",
            { source: "manual_sign_out" },
            { entityType: "session", entityKey: activeSession.user.id, flushImmediately: true }
          ).catch(() => undefined);
        }

        await Promise.allSettled([
          supabase.auth.signOut({ scope: "local" }),
          clearDeviceAuthState(),
        ]);
        setSession(null);
      } catch (err) {
        console.error("Sign out cleanup failed:", err);
        throw err;
      } finally {
        signOutPromiseRef.current = null;
      }
    })();

    await signOutPromiseRef.current;
  }, [clearDeviceAuthState, session]);

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


