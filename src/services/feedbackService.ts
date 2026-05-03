import { supabase } from "./supabase";
import type { AppLanguage } from "../localization/types";
import type { ThemeId } from "../theme/Theme";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type FeedbackPayload = {
  message: string;
  language: AppLanguage;
  themeId: ThemeId;
  profileName: string;
  profileLocation?: string;
};

type FeedbackResponse = {
  success: boolean;
  message?: string;
  id?: string;
};

export async function sendUserFeedback(payload: FeedbackPayload) {
  const trimmedMessage = payload.message.trim();
  if (trimmedMessage.length < 10) {
    throw new Error("Please share a bit more detail before sending feedback.");
  }

  if (trimmedMessage.length > 2000) {
    throw new Error("Feedback is too long. Please keep it under 2000 characters.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Your session expired. Please sign in again and retry.");
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Feedback service is not configured on this build.");
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/user-feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "X-StreamBox-Auth": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      ...payload,
      message: trimmedMessage,
      profileLocation: payload.profileLocation?.trim() || "",
    }),
  });

  let data: FeedbackResponse | null = null;
  try {
    data = (await response.json()) as FeedbackResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.message || "Unable to send feedback right now.");
  }

  if (!data?.success) {
    throw new Error(data?.message || "Unable to send feedback right now.");
  }

  return data;
}
