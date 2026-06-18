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
import { trackNetworkFailure } from "./telemetryService";

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

function debugLog(...args: unknown[]) {
  if (__DEV__) {
    console.log(...args);
  }
}

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
    // Dizipal rotates the digit suffix every few days. Keep this current to
    // minimise the redirect chain on first launch (each stale step adds ~1s
    // to every search; a 6s axios timeout chokes after ~6 hops).
    baseUrl: "https://dizipal2079.com",
    referer: "https://dizipal2079.com/",
  },
};

const STALE_PROVIDER_BASE_URLS: Partial<Record<keyof ProviderConfigMap, Record<string, ProviderEntry>>> = {
  dizipal: {
    "https://dizipal2031.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2070.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2071.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2072.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2073.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2074.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2075.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2076.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2077.com": HARDCODED_FALLBACK.dizipal,
    "https://dizipal2078.com": HARDCODED_FALLBACK.dizipal,
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
    debugLog("[ProviderConfig] Loaded from remote", summarise(remote));
    return;
  }

  // 2. Try local cache
  const cached = await loadFromStorage();
  if (cached) {
    _configs = cached;
    _initialised = true;
    debugLog("[ProviderConfig] Loaded from local cache", summarise(cached));
    return;
  }

  // 3. Hardcoded fallback (already set)
  _initialised = true;
  debugLog("[ProviderConfig] Using hardcoded fallback", summarise(_configs));
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
    debugLog("[ProviderConfig] Refreshed from remote", summarise(remote));
    return true;
  }
  return false;
}

/**
 * Self-heal: record a base URL actually reached on the wire — typically the
 * post-redirect origin extracted from `response.request.responseURL`.
 *
 * Dizipal rotates its domain every few days. The remote config (Supabase)
 * is kept in sync by an operator-driven Telegram bot, but in the gap
 * between rotation and `/set_dizipal`, every device hits a 301 chain (~1s
 * per hop). Once a single request completes, axios has already followed
 * the chain — we capture the final origin and pin it in memory so the
 * rest of this session goes direct.
 *
 * Persists to AsyncStorage so a cold restart within the same rotation
 * window also starts direct. Does NOT push to Supabase — that's the bot
 * operator's job — so a single misbehaving device can't poison the
 * central config.
 */
export function recordObservedBaseUrl(
  provider: keyof ProviderConfigMap,
  observedBaseUrl: string | null | undefined
): void {
  if (!observedBaseUrl) return;
  let normalized: string;
  try {
    normalized = new URL(observedBaseUrl).origin;
  } catch {
    return;
  }

  const current = _configs[provider].baseUrl.replace(/\/+$/, "");
  if (current === normalized) return;

  // Sanity check: only accept origins that look like the same provider.
  // Blocks a hijacked redirect from poisoning the in-memory config.
  if (!sameProviderFamily(provider, normalized)) {
    debugLog(`[ProviderConfig] Ignoring foreign observed origin: ${normalized}`);
    return;
  }

  _configs[provider] = {
    baseUrl: normalized,
    referer: `${normalized}/`,
  };
  void persistToStorage(_configs);
  debugLog(`[ProviderConfig] Self-healed ${provider}: ${current} → ${normalized}`);
}

function sameProviderFamily(provider: keyof ProviderConfigMap, observedOrigin: string): boolean {
  let host = "";
  try {
    host = new URL(observedOrigin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (provider === "dizipal") return host.includes("dizipal");
  if (provider === "hdfilm") return host.includes("hdfilm");
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
    trackNetworkFailure("provider-configs", {
      message: e instanceof Error ? e.message : String(e),
    });
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
      const baseUrl = remote[key].baseUrl.replace(/\/+$/, "");
      const replacement = STALE_PROVIDER_BASE_URLS[key]?.[baseUrl];

      result[key] = {
        baseUrl: replacement?.baseUrl ?? baseUrl,
        referer: replacement?.referer ?? (remote[key].referer || `${baseUrl}/`),
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
      return mergeWithFallback(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

function summarise(c: ProviderConfigMap): string {
  return `hdfilm=${c.hdfilm.baseUrl} dizipal=${c.dizipal.baseUrl}`;
}
