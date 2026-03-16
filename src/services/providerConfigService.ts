/**
 * providerConfigService
 *
 * Fetches streaming-provider base URLs from Supabase at app startup,
 * caches them locally via AsyncStorage so the app never hard-crashes
 * if the network is unavailable, and exposes a simple getter the rest
 * of the codebase can call synchronously after initialisation.
 *
 * When a domain changes, update the `provider_configs` table in
 * Supabase — every running app will pick up the new URL within 5 min
 * (Edge Function cache TTL) or on next cold start.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

// ─── Types ──────────────────────────────────────────────────────────
export type ProviderEntry = {
  baseUrl: string;
  referer: string;
};

export type ProviderConfigMap = {
  hdfilm: ProviderEntry;
  dizipal: ProviderEntry;
};

type RemoteResponse = {
  success: boolean;
  providers: Record<string, { baseUrl: string; referer: string }>;
  updatedAt?: string;
};

// ─── Constants ──────────────────────────────────────────────────────
const STORAGE_KEY = "@streambox/provider-configs";
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/provider-configs` : "";
const FETCH_TIMEOUT_MS = 6_000;

/**
 * Hard-coded fallbacks — these are the URLs at the time of writing.
 * They are ONLY used if both the remote fetch AND the local cache miss.
 */
const HARDCODED_FALLBACK: ProviderConfigMap = {
  hdfilm: {
    baseUrl: "https://www.hdfilmcehennemi.nl",
    referer: "https://www.hdfilmcehennemi.nl/",
  },
  dizipal: {
    baseUrl: "https://dizipal2031.com",
    referer: "https://dizipal2031.com/",
  },
};

// ─── In-memory singleton ────────────────────────────────────────────
let _configs: ProviderConfigMap = { ...HARDCODED_FALLBACK };
let _initialised = false;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Call once at app startup (e.g. in App.tsx or a boot effect).
 * Tries remote first, falls back to local cache, then hardcoded.
 */
export async function initialiseProviderConfigs(): Promise<void> {
  // 1. Try remote
  const remote = await fetchRemoteConfigs();
  if (remote) {
    _configs = remote;
    _initialised = true;
    await persistToStorage(remote);
    console.log("[ProviderConfig] Loaded from remote", summarise(remote));
    return;
  }

  // 2. Try local cache
  const cached = await loadFromStorage();
  if (cached) {
    _configs = cached;
    _initialised = true;
    console.log("[ProviderConfig] Loaded from local cache", summarise(cached));
    return;
  }

  // 3. Hardcoded fallback (already set)
  _initialised = true;
  console.log("[ProviderConfig] Using hardcoded fallback", summarise(_configs));
}

/** Synchronous getter — safe to call anywhere after init. */
export function getProviderConfig(provider: keyof ProviderConfigMap): ProviderEntry {
  return _configs[provider];
}

/** Returns the full map (read-only). */
export function getAllProviderConfigs(): Readonly<ProviderConfigMap> {
  return _configs;
}

/** Whether initialisation has completed (for guards). */
export function isProviderConfigReady(): boolean {
  return _initialised;
}

/**
 * Force a refresh from remote (e.g. on pull-to-refresh or a retry).
 * Returns true if remote succeeded.
 */
export async function refreshProviderConfigs(): Promise<boolean> {
  const remote = await fetchRemoteConfigs();
  if (remote) {
    _configs = remote;
    await persistToStorage(remote);
    console.log("[ProviderConfig] Refreshed from remote", summarise(remote));
    return true;
  }
  return false;
}

// ─── Internal helpers ───────────────────────────────────────────────

async function fetchRemoteConfigs(): Promise<ProviderConfigMap | null> {
  if (!FUNCTION_URL) return null;

  try {
    const { data } = await axios.get<RemoteResponse>(FUNCTION_URL, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!data?.success || !data.providers) return null;

    return mergeWithFallback(data.providers);
  } catch (e) {
    console.warn("[ProviderConfig] Remote fetch failed:", e);
    return null;
  }
}

/**
 * Merge remote response with hardcoded fallback so we always have
 * every required key, even if a provider is missing from the DB.
 */
function mergeWithFallback(
  remote: Record<string, { baseUrl: string; referer: string }>
): ProviderConfigMap {
  const result = { ...HARDCODED_FALLBACK };

  for (const key of Object.keys(result) as Array<keyof ProviderConfigMap>) {
    if (remote[key]?.baseUrl) {
      result[key] = {
        baseUrl: remote[key].baseUrl.replace(/\/+$/, ""),
        referer: remote[key].referer || `${remote[key].baseUrl.replace(/\/+$/, "")}/`,
      };
    }
  }

  return result;
}

async function persistToStorage(configs: ProviderConfigMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch { /* non-critical */ }
}

async function loadFromStorage(): Promise<ProviderConfigMap | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed?.hdfilm?.baseUrl && parsed?.dizipal?.baseUrl) {
      return parsed as ProviderConfigMap;
    }
    return null;
  } catch {
    return null;
  }
}

function summarise(c: ProviderConfigMap): string {
  return `hdfilm=${c.hdfilm.baseUrl} dizipal=${c.dizipal.baseUrl}`;
}
