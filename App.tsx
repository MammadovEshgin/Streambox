import "react-native-gesture-handler";
import "react-native-reanimated";

import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer, type Theme as NavigationTheme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "styled-components/native";
import styled from "styled-components/native";

import { MovieLoader } from "./src/components/common/MovieLoader";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { UserDataSyncProvider, useUserDataSync } from "./src/context/UserDataSyncContext";
import { Navigation } from "./src/navigation/Navigation";
import { ForgotPasswordScreen } from "./src/screens/auth/ForgotPasswordScreen";
import { AuthScreen } from "./src/screens/auth/AuthScreen";
import { OtpVerificationScreen } from "./src/screens/auth/OtpVerificationScreen";
import { ResetPasswordScreen } from "./src/screens/auth/ResetPasswordScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";
import { initialiseProviderConfigs } from "./src/services/providerConfigService";
import { AppSettingsProvider, useAppSettings } from "./src/settings/AppSettingsContext";

const FIRST_OPEN_KEY = "@streambox/first-open-complete-v6";

type LaunchPhase = "loading" | "welcome" | "auth" | "app";
type AuthFlow = "main" | "otp" | "forgot" | "reset";

const LoaderScreen = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

function AppShell() {
  const { activeTheme, setJoinedDate, setProfileName, joinedDate } = useAppSettings();
  const { session, isLoading: authLoading } = useAuth();
  const { isReady: isUserDataReady } = useUserDataSync();
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("loading");
  const [authFlow, setAuthFlow] = useState<AuthFlow>("main");
  const [pendingEmail, setPendingEmail] = useState("");
  const isResettingPasswordRef = useRef(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let active = true;
    async function hydrate() {
      try {
        // Load streaming-provider URLs from remote (non-blocking for UX)
        void initialiseProviderConfigs();

        const isComplete = await AsyncStorage.getItem(FIRST_OPEN_KEY);
        if (!active) {
          return;
        }

        if (isComplete !== "1") {
          setLaunchPhase("welcome");
        } else if (session && !isResettingPasswordRef.current) {
          setLaunchPhase("app");
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
  }, [authLoading, session]);

  useEffect(() => {
    if (authLoading || launchPhase === "loading") {
      return;
    }

    if (session && launchPhase === "auth" && !isResettingPasswordRef.current) {
      setLaunchPhase("app");
      setAuthFlow("main");
    }

    if (!session && launchPhase === "app") {
      void AsyncStorage.removeItem(FIRST_OPEN_KEY);
      setAuthFlow("main");
      setPendingEmail("");
      isResettingPasswordRef.current = false;
      setLaunchPhase("welcome");
    }
  }, [authLoading, launchPhase, session]);

  const handleContinueFromWelcome = useCallback(async () => {
    try {
      await AsyncStorage.setItem(FIRST_OPEN_KEY, "1");
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

  return (
    <ThemeProvider theme={activeTheme}>
      <StatusBar style="light" />
      {shouldShowAppLoader ? (
        <LoaderScreen>
          <MovieLoader size={56} label={launchPhase === "app" ? "Syncing your StreamBox data" : "Preparing your cinema room"} />
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
        <NavigationContainer theme={navigationTheme}>
          <Navigation />
        </NavigationContainer>
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
        <AppSettingsProvider>
          <AuthProvider>
            <UserDataSyncProvider>
              <AppShell />
            </UserDataSyncProvider>
          </AuthProvider>
        </AppSettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
