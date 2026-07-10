import "react-native-gesture-handler";
import "react-native-reanimated";

import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { SpecialElite_400Regular } from "@expo-google-fonts/special-elite";
import { Caveat_500Medium, Caveat_600SemiBold, Caveat_700Bold } from "@expo-google-fonts/caveat";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer, type Theme as NavigationTheme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import { StatusBar } from "expo-status-bar";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ThemeProvider } from "styled-components/native";
import styled from "styled-components/native";

import { LaunchSplash, SplashLoading } from "./src/components/common/LaunchSplash";
import { LiveOpsHost } from "./src/components/common/LiveOpsHost";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { UserDataSyncProvider, useUserDataSync } from "./src/context/UserDataSyncContext";
import { Navigation } from "./src/navigation/Navigation";
import i18n from "./src/localization/i18n";

// Deep link: streambox://room/<code> opens the Watch Together join sheet
// prefilled with the shared room code.
const watchTogetherLinking: any = {
  prefixes: ["streambox://"],
  config: {
    screens: {
      Discover: {
        screens: {
          WatchRoomSetup: "room/:code",
        },
      },
    },
  },
};
import { ForgotPasswordScreen } from "./src/screens/auth/ForgotPasswordScreen";
import { AuthScreen } from "./src/screens/auth/AuthScreen";
import { OtpVerificationScreen } from "./src/screens/auth/OtpVerificationScreen";
import { ResetPasswordScreen } from "./src/screens/auth/ResetPasswordScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { initialiseProviderConfigs } from "./src/services/providerConfigService";
import { flushTelemetry, initialiseTelemetry, trackAppError, trackEvent, trackPerformance } from "./src/services/telemetryService";
import { AppSettingsProvider, useAppSettings } from "./src/settings/AppSettingsContext";
import { migrateLegacyContentImageCaches } from "./src/services/remoteImageCache";
import { preloadPersistedMediaHydration } from "./src/services/mediaHydration";
import { clearPersistedRuntimeCaches, hydratePersistedRuntimeCachesIntoMemory } from "./src/services/runtimeCache";
import { runStorageMigrationsIfNeeded } from "./src/services/storageMigrations";

const FIRST_OPEN_KEY = "@streambox/first-open-complete-v6";
const SIGN_OUT_WELCOME_KEY = "@streambox/sign-out-welcome-v1";
const LAST_STARTUP_ERROR_KEY = "@streambox/last-startup-error-v1";
const FIRST_LAUNCH_FALLBACK_MS = 2200;
const FONT_LOAD_FALLBACK_MS = 2600;

const INTERNAL_UPDATE_CHANNELS = new Set(["preview", "staging", "internal"]);

function isInternalBuild(): boolean {
  if (__DEV__) {
    return true;
  }

  const channel = Updates.channel;
  return typeof channel === "string" && INTERNAL_UPDATE_CHANNELS.has(channel);
}

function summariseStack(stack: string | undefined, maxLines = 3): string {
  if (!stack) {
    return "";
  }

  return stack.split("\n").slice(0, maxLines).join("\n");
}

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type LaunchPhase = "loading" | "welcome" | "auth" | "app";
type AuthFlow = "main" | "otp" | "forgot" | "reset";

const StartupErrorShell = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
  padding: 28px;
`;

const StartupErrorLogo = styled.Image`
  width: 64px;
  height: 64px;
  margin-bottom: 18px;
`;

const StartupErrorTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 24px;
  line-height: 30px;
  text-align: center;
  letter-spacing: -0.5px;
`;

const StartupErrorText = styled.Text`
  margin-top: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 14px;
  line-height: 21px;
  text-align: center;
`;

const StartupErrorActions = styled.View`
  width: 100%;
  gap: 10px;
  margin-top: 24px;
`;

const StartupPrimaryButton = styled.Pressable`
  min-height: 50px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.primary};
`;

const StartupSecondaryButton = styled.Pressable`
  min-height: 50px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.surface};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const StartupPrimaryText = styled.Text`
  color: ${({ theme }) => theme.colors.textOnPrimary};
  font-family: Outfit_700Bold;
  font-size: 15px;
`;

const StartupSecondaryText = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 15px;
`;

const StartupErrorDetails = styled.View`
  margin-top: 18px;
  padding: 12px;
  width: 100%;
  border-radius: 12px;
  background-color: rgba(255, 255, 255, 0.05);
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const StartupErrorDetailsText = styled.Text`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
`;

type StartupErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  title: string;
  message: string;
  retryLabel: string;
  signOutLabel: string;
  showErrorDetails: boolean;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type StartupErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

class StartupErrorBoundary extends Component<StartupErrorBoundaryProps, StartupErrorBoundaryState> {
  state: StartupErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[StartupErrorBoundary] authenticated app render failed:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps: StartupErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: null });
    }
  }

  private handleRetry = () => {
    this.setState({ error: null, componentStack: null });
    this.props.onRetry();
  };

  private handleSignOut = () => {
    this.setState({ error: null, componentStack: null });
    void this.props.onSignOut();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const { error, componentStack } = this.state;
    const errorHeadline = `${error.name}: ${error.message}`;
    const stackPreview = summariseStack(error.stack ?? componentStack ?? undefined);

    return (
      <StartupErrorShell>
        <StartupErrorLogo source={require("./assets/app-icons/adaptive-foreground.png")} resizeMode="contain" />
        <StartupErrorTitle>{this.props.title}</StartupErrorTitle>
        <StartupErrorText>{this.props.message}</StartupErrorText>
        {this.props.showErrorDetails ? (
          <StartupErrorDetails>
            <StartupErrorDetailsText>{errorHeadline}</StartupErrorDetailsText>
            {stackPreview ? <StartupErrorDetailsText>{stackPreview}</StartupErrorDetailsText> : null}
          </StartupErrorDetails>
        ) : null}
        <StartupErrorActions>
          <StartupPrimaryButton onPress={this.handleRetry}>
            <StartupPrimaryText>{this.props.retryLabel}</StartupPrimaryText>
          </StartupPrimaryButton>
          <StartupSecondaryButton onPress={this.handleSignOut}>
            <StartupSecondaryText>{this.props.signOutLabel}</StartupSecondaryText>
          </StartupSecondaryButton>
        </StartupErrorActions>
      </StartupErrorShell>
    );
  }
}

function AppShell() {
  const { activeTheme, language, setJoinedDate, setProfileName, joinedDate } = useAppSettings();
  const { session, isLoading: authLoading, signOut } = useAuth();
  const { isReady: isUserDataReady } = useUserDataSync();
  const { t } = useTranslation();
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("loading");
  // The launch splash plays its full reveal regardless of how fast data loads;
  // only once it finishes do we hand off to real content (or, if content still
  // isn't ready, a plain Loading spinner).
  const [splashComplete, setSplashComplete] = useState(false);
  const [authFlow, setAuthFlow] = useState<AuthFlow>("main");
  const [pendingEmail, setPendingEmail] = useState("");
  const [startupRetryNonce, setStartupRetryNonce] = useState(0);
  const [migrationsReady, setMigrationsReady] = useState(false);
  // Tracks whether the persisted hub caches (Movies / Series / Home) have
  // been read off disk into the in-memory `runtimeCache` map. We gate the
  // "app" launch phase on this so MoviesScreen / SeriesScreen / HomeScreen
  // mount only after `readRuntimeCache(...)` will return data synchronously
  // — eliminating the skeleton flash that previously occurred while their
  // own AsyncStorage read was in flight on first render.
  const [hubCachesHydrated, setHubCachesHydrated] = useState(false);
  const isResettingPasswordRef = useRef(false);
  const previousSessionUserIdRef = useRef<string | null>(null);
  const appStartedAtRef = useRef(Date.now());
  const hasTrackedAppReadyRef = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLaunchPhase((current) => (current === "loading" ? "welcome" : current));
    }, FIRST_LAUNCH_FALLBACK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    initialiseTelemetry({
      platform: Platform.OS,
      appVersion: String(Updates.runtimeVersion ?? "unknown"),
      buildChannel: Updates.channel ?? null,
      updateId: Updates.updateId ?? null,
    });
  }, []);

  useEffect(() => {
    let active = true;

    async function runMigrations() {
      try {
        await runStorageMigrationsIfNeeded();
        void migrateLegacyContentImageCaches().catch(() => undefined);
      } finally {
        if (active) {
          setMigrationsReady(true);
        }
      }
    }

    void runMigrations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Warm the poster-hydration cache from disk so the profile shelves can paint
    // synchronously the first time they open (no spinner flash on a warm cache).
    void preloadPersistedMediaHydration();
    void hydratePersistedRuntimeCachesIntoMemory().finally(() => {
      if (active) {
        setHubCachesHydrated(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    if (launchPhase === "loading") {
      return;
    }

    void SplashScreen.hideAsync().catch(() => undefined);
  }, [launchPhase]);

  useEffect(() => {
    if (authLoading || !migrationsReady) {
      return;
    }

    let active = true;
    async function hydrate() {
      try {
        // Load streaming-provider URLs from remote (non-blocking for UX)
        void initialiseProviderConfigs();

        const [isComplete, shouldShowSignOutWelcome] = await Promise.all([
          AsyncStorage.getItem(FIRST_OPEN_KEY),
          AsyncStorage.getItem(SIGN_OUT_WELCOME_KEY),
        ]);
        if (!active) {
          return;
        }

        if (session && !isResettingPasswordRef.current) {
          setLaunchPhase("app");
        } else if (shouldShowSignOutWelcome === "1" || isComplete !== "1") {
          setLaunchPhase("welcome");
        } else {
          setLaunchPhase("auth");
          setAuthFlow("main");
        }
      } catch {
        if (active) {
          setLaunchPhase("welcome");
        }
      }
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, [authLoading, migrationsReady]);

  useEffect(() => {
    if (authLoading || launchPhase === "loading") {
      return;
    }

    if (session && launchPhase === "auth" && !isResettingPasswordRef.current) {
      setLaunchPhase("app");
      setAuthFlow("main");
    }
  }, [authLoading, launchPhase, session]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const currentSessionUserId = session?.user.id ?? null;
    const previousSessionUserId = previousSessionUserIdRef.current;

    if (previousSessionUserId && !currentSessionUserId) {
      trackEvent("session_signed_out", "app");
      void AsyncStorage.setItem(SIGN_OUT_WELCOME_KEY, "1");
      setAuthFlow("main");
      setPendingEmail("");
      isResettingPasswordRef.current = false;
      setLaunchPhase("welcome");
    }

    previousSessionUserIdRef.current = currentSessionUserId;
    if (currentSessionUserId) {
      trackEvent("session_available", "app");
      void flushTelemetry();
    }
  }, [authLoading, session]);

  useEffect(() => {
    if (launchPhase !== "app" || !isUserDataReady || hasTrackedAppReadyRef.current) {
      return;
    }

    hasTrackedAppReadyRef.current = true;
    trackPerformance("app_ready", Date.now() - appStartedAtRef.current, {
      launchPhase,
      hasSession: Boolean(session?.user),
    });
  }, [isUserDataReady, launchPhase, session?.user]);

  const handleContinueFromWelcome = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem(FIRST_OPEN_KEY, "1"),
        AsyncStorage.removeItem(SIGN_OUT_WELCOME_KEY),
      ]);
    } finally {
      if (session && !isResettingPasswordRef.current) {
        setLaunchPhase("app");
      } else {
        setAuthFlow("main");
        setPendingEmail("");
        isResettingPasswordRef.current = false;
        setLaunchPhase("auth");
      }
    }
  }, [session]);

  const handleSignUpSuccess = useCallback((email: string, displayName: string) => {
    setPendingEmail(email);
    if (displayName) {
      void setProfileName(displayName);
    }
    if (!joinedDate) {
      void setJoinedDate(new Date().toISOString());
    }
    setAuthFlow("otp");
  }, [joinedDate, setJoinedDate, setProfileName]);

  const handleOtpVerified = useCallback(() => {
    setAuthFlow("main");
    setLaunchPhase("app");
  }, []);

  const handleSignInSuccess = useCallback(() => {
    setAuthFlow("main");
    setLaunchPhase("app");
  }, []);

  const handleForgotPassword = useCallback(() => {
    setAuthFlow("forgot");
  }, []);

  const handleForgotCodeSent = useCallback((email: string) => {
    setPendingEmail(email);
    isResettingPasswordRef.current = true;
    setAuthFlow("reset");
  }, []);

  const handleResetComplete = useCallback(() => {
    isResettingPasswordRef.current = false;
    setPendingEmail("");
    setAuthFlow("main");
  }, []);

  const handleBackToAuth = useCallback(() => {
    isResettingPasswordRef.current = false;
    setPendingEmail("");
    setAuthFlow("main");
  }, []);

  const handleStartupRetry = useCallback(() => {
    void clearPersistedRuntimeCaches().catch(() => undefined);
    setStartupRetryNonce((value) => value + 1);
  }, []);

  const handleStartupError = useCallback((error: Error, info: ErrorInfo) => {
    const payload = JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
      capturedAt: new Date().toISOString(),
    });
    void AsyncStorage.setItem(LAST_STARTUP_ERROR_KEY, payload).catch(() => undefined);
    trackAppError("startup_render_crash", error, {
      componentStack: info.componentStack ?? null,
    }, "fatal");
  }, []);

  const showStartupErrorDetails = useMemo(() => isInternalBuild(), []);

  const navigationTheme = useMemo<NavigationTheme>(() => ({
    dark: true,
    colors: {
      primary: activeTheme.colors.primary,
      background: activeTheme.colors.background,
      card: activeTheme.colors.surface,
      text: activeTheme.colors.textPrimary,
      border: activeTheme.colors.border,
      notification: activeTheme.colors.primary,
    },
  }), [activeTheme]);

  const handleSplashComplete = useCallback(() => setSplashComplete(true), []);

  // What the splash hands off to. The app phase additionally needs its synced
  // data + hub caches; welcome/auth need nothing. Until the launch phase
  // resolves we keep waiting too. Content MOUNTS as soon as it is ready — the
  // splash is an opaque absolute overlay above it — so by the time the reveal
  // fades out, the first frame beneath is already painted (mounting only after
  // the splash unmounted flashed the black window background for a frame).
  const isContentPending =
    launchPhase === "loading"
    || (launchPhase === "app" && (!isUserDataReady || !hubCachesHydrated));
  const showLoadingFallback = isContentPending;
  const showResolvedScreen = !isContentPending;
  const startupBoundaryResetKey = `${session?.user.id ?? "guest"}:${startupRetryNonce}`;

  return (
    <ThemeProvider theme={activeTheme}>
      <StatusBar style="light" />
      {showLoadingFallback ? <SplashLoading /> : null}
      {showResolvedScreen && launchPhase === "welcome" ? <WelcomeScreen onContinue={handleContinueFromWelcome} /> : null}
      {showResolvedScreen && launchPhase === "auth" ? (
        <>
          {authFlow === "main" ? (
            <AuthScreen
              onSignUpSuccess={handleSignUpSuccess}
              onSignInSuccess={handleSignInSuccess}
              onForgotPassword={handleForgotPassword}
            />
          ) : null}
          {authFlow === "otp" ? (
            <OtpVerificationScreen
              email={pendingEmail}
              onVerified={handleOtpVerified}
              onBack={handleBackToAuth}
            />
          ) : null}
          {authFlow === "forgot" ? (
            <ForgotPasswordScreen
              onCodeSent={handleForgotCodeSent}
              onBack={handleBackToAuth}
            />
          ) : null}
          {authFlow === "reset" ? (
            <ResetPasswordScreen
              email={pendingEmail}
              onResetComplete={handleResetComplete}
              onBack={() => setAuthFlow("forgot")}
            />
          ) : null}
        </>
      ) : null}
      {showResolvedScreen && launchPhase === "app" ? (
        <StartupErrorBoundary
          resetKey={startupBoundaryResetKey}
          title={t("startupError.title")}
          message={t("startupError.message")}
          retryLabel={t("common.retry")}
          signOutLabel={t("settings.signOut")}
          showErrorDetails={showStartupErrorDetails}
          onRetry={handleStartupRetry}
          onSignOut={signOut}
          onError={handleStartupError}
        >
          <NavigationContainer theme={navigationTheme} linking={watchTogetherLinking}>
            <Navigation />
          </NavigationContainer>
          {/* Popups wait for the splash: a LiveOps modal is a native layer that
              would otherwise appear ABOVE the splash overlay mid-reveal. */}
          <LiveOpsHost enabled={isUserDataReady && splashComplete} />
        </StartupErrorBoundary>
      ) : null}
      {/* Top-most opaque overlay — content mounts and paints beneath it. */}
      {!splashComplete ? <LaunchSplash onComplete={handleSplashComplete} /> : null}
    </ThemeProvider>
  );
}

export default function App() {
  const [fontsLoaded, fontLoadError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    SpecialElite_400Regular,
    Caveat_500Medium,
    Caveat_600SemiBold,
    Caveat_700Bold,
  });
  const [fontFallbackReady, setFontFallbackReady] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontLoadError) {
      return;
    }

    const timeout = setTimeout(() => {
      setFontFallbackReady(true);
    }, FONT_LOAD_FALLBACK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [fontLoadError, fontsLoaded]);

  useEffect(() => {
    if (fontLoadError) {
      console.warn("Font loading failed; continuing startup with system fallback fonts.", fontLoadError);
    }
  }, [fontLoadError]);

  const canRenderApp = fontsLoaded || Boolean(fontLoadError) || fontFallbackReady;

  useEffect(() => {
    if (canRenderApp) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [canRenderApp]);

  if (!canRenderApp) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <AppSettingsProvider>
            <AuthProvider>
              <UserDataSyncProvider>
                <AppShell />
              </UserDataSyncProvider>
            </AuthProvider>
          </AppSettingsProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
