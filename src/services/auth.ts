import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { supabase } from "./supabase";

/** Strict email regex — must have local@domain.tld format */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const PASSWORD_RULES = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireDigit: true,
  requireSymbol: true,
};

const SUPABASE_EMAIL_DELIVERY_ERROR =
  "Email delivery is not configured correctly in Supabase. The project is generating auth tokens, but Supabase cannot send signup/reset emails. If you switched off custom SMTP, re-enable a custom SMTP provider in Supabase Auth > Email before using public signup or password reset.";

const SUPABASE_EMAIL_RATE_LIMIT_ERROR =
  "Too many email requests were sent recently. Wait about a minute and try again.";

type AuthErrorLike = {
  message?: string;
  code?: string;
  status?: number;
};

type AuthCallbackParams = {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
};

WebBrowser.maybeCompleteAuthSession();

type GoogleSignInModule = typeof import("@react-native-google-signin/google-signin");

let nativeGoogleModule: GoogleSignInModule | null | undefined;
let isNativeGoogleConfigured = false;

function normalizeAuthError(error: unknown): Error {
  const authError = (error && typeof error === "object" ? error : null) as AuthErrorLike | null;
  const message = authError?.message ?? "";
  const lowerMessage = message.toLowerCase();

  const isEmailDeliveryFailure =
    authError?.code === "unexpected_failure" &&
    authError?.status === 500 &&
    lowerMessage.includes("sending") &&
    lowerMessage.includes("email");

  const isEmailRateLimited =
    authError?.code === "over_email_send_rate_limit" ||
    (authError?.status === 429 &&
      (lowerMessage.includes("request this after") || lowerMessage.includes("rate limit")));

  if (isEmailDeliveryFailure) {
    return new Error(SUPABASE_EMAIL_DELIVERY_ERROR);
  }

  if (isEmailRateLimited) {
    return new Error(SUPABASE_EMAIL_RATE_LIMIT_ERROR);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(message || "Authentication failed");
}

function getAuthCallbackParams(callbackUrl: string): AuthCallbackParams {
  const queryIndex = callbackUrl.indexOf("?");
  const hashIndex = callbackUrl.indexOf("#");
  const query = queryIndex >= 0
    ? callbackUrl.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
    : "";
  const hash = hashIndex >= 0 ? callbackUrl.slice(hashIndex + 1) : "";
  const mergedParams = [query, hash].filter(Boolean).join("&");
  const params = new URLSearchParams(mergedParams);

  return {
    code: params.get("code"),
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    error: params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

function getGoogleWebClientId() {
  return process.env.EXPO_PUBLIC_GOOGLE_AUTH_WEB_CLIENT_ID?.trim() ?? "";
}

function getGoogleIosClientId() {
  return process.env.EXPO_PUBLIC_GOOGLE_AUTH_IOS_CLIENT_ID?.trim() ?? "";
}

function getNativeGoogleModule(): GoogleSignInModule | null {
  if (nativeGoogleModule !== undefined) {
    return nativeGoogleModule;
  }

  try {
    nativeGoogleModule = require("@react-native-google-signin/google-signin") as GoogleSignInModule;
  } catch {
    nativeGoogleModule = null;
  }

  return nativeGoogleModule;
}

function canUseNativeGoogleSignIn() {
  return Platform.OS !== "web" && !!getNativeGoogleModule() && !!getGoogleWebClientId();
}

async function configureNativeGoogleSignIn(module: GoogleSignInModule) {
  if (isNativeGoogleConfigured) {
    return;
  }

  const webClientId = getGoogleWebClientId();
  if (!webClientId) {
    throw new Error("Missing EXPO_PUBLIC_GOOGLE_AUTH_WEB_CLIENT_ID for native Google sign-in.");
  }

  module.GoogleSignin.configure({
    webClientId,
    ...(getGoogleIosClientId() ? { iosClientId: getGoogleIosClientId() } : {}),
    scopes: ["email", "profile"],
    offlineAccess: false,
  });

  isNativeGoogleConfigured = true;
}

async function signInWithGoogleOAuth() {
  const redirectTo = AuthSession.makeRedirectUri({
    scheme: "streambox",
    path: "auth/callback",
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw normalizeAuthError(error);
  if (!data?.url) {
    throw new Error("Google sign-in could not be started.");
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success" || !("url" in result) || !result.url) {
    return { cancelled: true as const, mode: "oauth" as const };
  }

  const params = getAuthCallbackParams(result.url);
  if (params.errorDescription || params.error) {
    throw new Error(params.errorDescription ?? params.error ?? "Google sign-in failed.");
  }

  if (params.code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) throw normalizeAuthError(exchangeError);
    return { cancelled: false as const, mode: "oauth" as const };
  }

  if (params.accessToken && params.refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (sessionError) throw normalizeAuthError(sessionError);
    return { cancelled: false as const, mode: "oauth" as const };
  }

  throw new Error("Google sign-in could not be completed.");
}

async function signInWithGoogleNative(module: GoogleSignInModule) {
  await configureNativeGoogleSignIn(module);

  try {
    if (Platform.OS === "android") {
      await module.GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }

    const response = await module.GoogleSignin.signIn();
    if (!module.isSuccessResponse(response)) {
      return { cancelled: true as const, mode: "native" as const };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error(
        "Google did not return an ID token. Check your Web Client ID configuration."
      );
    }

    const tokens = await module.GoogleSignin.getTokens().catch(() => null);
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      ...(tokens?.accessToken ? { access_token: tokens.accessToken } : {}),
    });

    if (error) {
      throw normalizeAuthError(error);
    }

    return { cancelled: false as const, mode: "native" as const };
  } catch (error: unknown) {
    if (module.isErrorWithCode(error)) {
      if (
        error.code === module.statusCodes.SIGN_IN_CANCELLED ||
        error.code === module.statusCodes.IN_PROGRESS
      ) {
        return { cancelled: true as const, mode: "native" as const };
      }

      if (error.code === module.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Google Play Services are unavailable on this device.");
      }
    }

    throw error instanceof Error ? error : new Error("Google sign-in failed.");
  }
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export type PasswordValidation = {
  isValid: boolean;
  errors: string[];
};

export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  if (password.length < PASSWORD_RULES.minLength) {
    errors.push(`At least ${PASSWORD_RULES.minLength} characters`);
  }
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("One lowercase letter");
  }
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("One uppercase letter");
  }
  if (PASSWORD_RULES.requireDigit && !/\d/.test(password)) {
    errors.push("One digit");
  }
  if (PASSWORD_RULES.requireSymbol && !/[^a-zA-Z0-9]/.test(password)) {
    errors.push("One special character");
  }

  return { isValid: errors.length === 0, errors };
}

export async function signUp(email: string, password: string, displayName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: displayName
      ? { data: { display_name: displayName.trim() } }
      : undefined,
  });

  if (error) throw normalizeAuthError(error);
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) throw normalizeAuthError(error);
  return data;
}

export async function signInWithGoogle() {
  const nativeModule = getNativeGoogleModule();
  if (nativeModule && canUseNativeGoogleSignIn()) {
    return signInWithGoogleNative(nativeModule);
  }

  return signInWithGoogleOAuth();
}

export async function signOutFromGoogle() {
  const nativeModule = getNativeGoogleModule();
  if (!nativeModule) {
    return;
  }

  try {
    const hasPreviousSignIn = nativeModule.GoogleSignin.hasPreviousSignIn();
    if (!hasPreviousSignIn && !nativeModule.GoogleSignin.getCurrentUser()) {
      return;
    }

    await nativeModule.GoogleSignin.signOut();
  } catch {
    // Ignore native provider cleanup failures so app sign-out still succeeds.
  }
}

export async function verifyOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: "signup",
  });

  if (error) throw normalizeAuthError(error);
  return data;
}

export async function requestPasswordReset(email: string) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase()
  );

  if (error) throw normalizeAuthError(error);
  return data;
}

export async function verifyPasswordResetOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: "recovery",
  });

  if (error) throw normalizeAuthError(error);
  return data;
}

export async function updatePassword(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
