import "react-native-gesture-handler";
import "react-native-reanimated";

import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer, type Theme as NavigationTheme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ThemeProvider } from "styled-components/native";
import styled from "styled-components/native";

import { MovieLoader } from "./src/components/common/MovieLoader";
import { LiveOpsHost } from "./src/components/common/LiveOpsHost";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { UserDataSyncProvider, useUserDataSync } from "./src/context/UserDataSyncContext";
import { Navigation } from "./src/navigation/Navigation";
import i18n from "./src/localization/i18n";
import { ForgotPasswordScreen } from "./src/screens/auth/ForgotPasswordScreen";
import { AuthScreen } from "./src/screens/auth/AuthScreen";
import { OtpVerificationScreen } from "./src/screens/auth/OtpVerificationScreen";
import { ResetPasswordScreen } from "./src/screens/auth/ResetPasswordScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { initialiseProviderConfigs } from "./src/services/providerConfigService";
import { AppSettingsProvider, useAppSettings } from "./src/settings/AppSettingsContext";
import { migrateLegacyContentImageCaches } from "./src/services/remoteImageCache";
import { clearPersistedRuntimeCaches } from "./src/services/runtimeCache";
import { runStorageMigrationsIfNeeded } from "./src/services/storageMigrations";

const FIRST_OPEN_KEY = "@streambox/first-open-complete-v6";
const SIGN_OUT_WELCOME_KEY = "@streambox/sign-out-welcome-v1";
const LAST_STARTUP_ERROR_KEY = "@streambox/last-startup-error-v1";

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

const LoaderScreen = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const LoaderGradient = styled(LinearGradient)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const LoaderGlow = styled.View<{ $color: string }>`
  position: absolute;
  width: 240px;
  height: 240px;
  border-radius: 120px;
  background-color: ${({ $color }) => $color};
  opacity: 0.24;
  top: 18%;
`;

const LoaderBrandShell = styled.View`
  width: 112px;
  height: 112px;
  border-radius: 30px;
  background-color: rgba(255, 255, 255, 0.07);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.1);
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;

const LoaderBrandIcon = styled.Image`
  width: 68px;
  height: 68px;
`;

const LoaderBrandTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_700Bold;
  font-size: 24px;
  line-height: 28px;
  letter-spacing: -0.6px;
`;

const LoaderBrandSubtitle = styled.Text`
  margin-top: 8px;
  margin-bottom: 20px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: Outfit_400Regular;
  font-size: 12px;
  line-height: 17px;
  letter-spacing: 0.2px;
`;

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
  color: #031106;
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
  const [authFlow, setAuthFlow] = useState<AuthFlow>("main");
  const [pendingEmail, setPendingEmail] = useState("");
  const [startupRetryNonce, setStartupRetryNonce] = useState(0);
  const [migrationsReady, setMigrationsReady] = useState(false);
  const isResettingPasswordRef = useRef(false);
  const previousSessionUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function runMigrations() {
      await runStorageMigrationsIfNeeded();
      void migrateLegacyContentImageCaches().catch(() => undefined);
      if (active) {
        setMigrationsReady(true);
      }
    }

    void runMigrations();
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
      void AsyncStorage.setItem(SIGN_OUT_WELCOME_KEY, "1");
      setAuthFlow("main");
      setPendingEmail("");
      isResettingPasswordRef.current = false;
      setLaunchPhase("welcome");
    }

    previousSessionUserIdRef.current = currentSessionUserId;
  }, [authLoading, session]);

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

  const shouldShowAppLoader = launchPhase === "loading" || (launchPhase === "app" && !isUserDataReady);
  const loaderSubtitle = launchPhase === "app"
    ? t("loaders.syncingData")
    : t("loaders.preparingCinemaRoom");
  const startupBoundaryResetKey = `${session?.user.id ?? "guest"}:${startupRetryNonce}`;

  return (
    <ThemeProvider theme={activeTheme}>
      <StatusBar style="light" />
      {shouldShowAppLoader ? (
        <LoaderScreen>
          <LoaderGradient
            colors={["#040404", activeTheme.colors.primaryGlow, "#040404"]}
            locations={[0, 0.5, 1]}
          />
          <LoaderGlow $color={activeTheme.colors.primary} />
          <LoaderBrandShell>
            <LoaderBrandIcon source={require("./assets/app-icons/adaptive-foreground.png")} resizeMode="contain" />
          </LoaderBrandShell>
          <LoaderBrandTitle>StreamBox</LoaderBrandTitle>
          <LoaderBrandSubtitle>{loaderSubtitle}</LoaderBrandSubtitle>
          <MovieLoader size={42} />
        </LoaderScreen>
      ) : null}
      {!shouldShowAppLoader && launchPhase === "welcome" ? <WelcomeScreen onContinue={handleContinueFromWelcome} /> : null}
      {!shouldShowAppLoader && launchPhase === "auth" ? (
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
      {!shouldShowAppLoader && launchPhase === "app" ? (
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
          <NavigationContainer theme={navigationTheme}>
            <Navigation />
          </NavigationContainer>
          <LiveOpsHost enabled={isUserDataReady} />
        </StartupErrorBoundary>
      ) : null}
    </ThemeProvider>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  if (!fontsLoaded) {
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
