import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SAFE_SUPABASE_URL = HAS_SUPABASE_CONFIG ? SUPABASE_URL : "https://streambox-placeholder.supabase.co";
const SAFE_SUPABASE_ANON_KEY = HAS_SUPABASE_CONFIG ? SUPABASE_ANON_KEY : "missing-supabase-anon-key";

if (!HAS_SUPABASE_CONFIG) {
  console.warn("Supabase URL or anon key missing from environment variables.");
}

function getSupabaseProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0] ?? "streambox";
  } catch {
    return "streambox";
  }
}

export const SUPABASE_AUTH_STORAGE_KEY = `sb-${getSupabaseProjectRef()}-auth-token`;
export const isSupabaseConfigured = HAS_SUPABASE_CONFIG;

export async function clearSupabaseAuthStorage() {
  await AsyncStorage.multiRemove([
    SUPABASE_AUTH_STORAGE_KEY,
    `${SUPABASE_AUTH_STORAGE_KEY}-user`,
    `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`,
  ]);
}

export const supabase = createClient(SAFE_SUPABASE_URL, SAFE_SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
  },
});
