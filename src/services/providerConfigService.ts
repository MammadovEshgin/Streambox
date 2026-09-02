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
  // Tier-3 direct scraper — Dizibal (dizibal.com). Different site than
  // Dizipal: clean REST API at /api/series, /api/movies, /api/stream/m3u8
  // serving m3u8 URLs on commercial CDN77 infrastructure (uk-traffic-076)
  // that is not on Azerbaijani ISP block lists. Telegram bot rotates the
  // base URL via /set_dizibal; app reads this getter every scraper call
  // so host rotations need zero OTA.
  dizibal: ProviderEntry;
};

type RemoteResponse = {
  success: boolean;
  providers: Record<string, { baseUrl: string; referer: string }>;
  updatedAt?: string;
};

// ─── Constants ──────────────────────────────────────────────────────
const STORAGE_KEY = "@streambox/provider-configs";
const OBSERVED_KEY = "@streambox/provider-observed";
/**
 * How long a self-healed origin stays trusted. Dizipal rotates every few days;
 * a week is long enough to cover a quiet stretch and short enough that a
 * genuinely dead pin can't outlive the domain it points at.
 */
const OBSERVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
    // Dizipal rotates the digit suffix every few days, and each stale step is
    // a 301 the client has to walk (~150ms per hop, and the hops are NOT
    // one-per-rotation — the live chain from 2079 to 2123 was 22 hops / 3.3s).
    // Past axios' 21-redirect ceiling the request fails outright, so a base
    // that falls far enough behind takes Dizipal down completely rather than
    // just making it slow. `normaliseDizipalBaseUrl` below keeps any base
    // older than this one from ever being used.
    baseUrl: "https://dizipal2123.com",
    referer: "https://dizipal2123.com/",
  },
  dizibal: {
    // dizibal.org (was .com until 2026-09; .com still 301s here) — Turkish
    // content platform with a clean REST API; the m3u8 CDN it serves
    // (uk-traffic-076 / cdn77 family) is reachable from Azerbaijani ISPs that
    // blocked cloudnestra / embed.su. Bot rotates this when dizibal cycles
    // its base URL.
    baseUrl: "https://dizibal.org",
    referer: "https://dizibal.org/",
  },
};

/**
 * Non-numeric stale hosts, mapped to their live replacement. Dizipal is NOT
 * listed here — its rotation is a monotonically increasing digit suffix, so it
 * is handled by `normaliseDizipalBaseUrl` instead of an enumeration nobody
 * remembers to extend.
 */
const STALE_PROVIDER_BASE_URLS: Partial<Record<keyof ProviderConfigMap, Record<string, ProviderEntry>>> = {
  dizibal: {
    "https://dizibal.com": HARDCODED_FALLBACK.dizibal,
    "https://www.dizibal.com": HARDCODED_FALLBACK.dizibal,
  },
};

/** `https://dizipal2079.com` → 2079. Null for any host that isn't that shape. */
export function parseDizipalSuffix(baseUrl: string): number | null {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const digits = host.match(/^(?:[a-z0-9-]+\.)?dizipal(\d+)\.[a-z.]+$/)?.[1];
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/**
 * Dizipal only ever moves forward: `dizipalN.com` 301s to `dizipalN+1.com`,
 * never backwards. So a base whose suffix is lower than the one we ship is
 * always stale, and following it costs a redirect per intervening domain.
 * Take whichever suffix is higher — remote wins as soon as the bot catches up,
 * and a Supabase row that has fallen behind can no longer slow every request
 * (or, past 21 hops, break Dizipal outright).
 */
export function normaliseDizipalBaseUrl(baseUrl: string): ProviderEntry | null {
  const candidate = parseDizipalSuffix(baseUrl);
  if (candidate === null) return null;
  const shipped = parseDizipalSuffix(HARDCODED_FALLBACK.dizipal.baseUrl);
  if (shipped === null || candidate >= shipped) return null;
  return HARDCODED_FALLBACK.dizipal;
}

// ─── In-memory singleton ────────────────────────────────────────────
/**
 * The config as published (remote → cache → hardcoded), BEFORE any
 * self-healed origin is layered on. Kept separate from `_configs` so a
 * refresh can tell "the operator rotated the domain" apart from "we're
 * looking at the same published value we were when we observed a redirect".
 */
let _baseline: ProviderConfigMap = { ...HARDCODED_FALLBACK };
let _configs: ProviderConfigMap = { ...HARDCODED_FALLBACK };
let _initialised = false;

/**
 * A post-redirect origin we actually reached, plus the published base URL that
 * was in effect when we reached it. The pin is only reapplied while that
 * published value is unchanged — the moment the operator pushes a new base to
 * Supabase, the observation is discarded and remote wins. That makes the
 * self-heal survive `refreshProviderConfigs()` without being able to strand a
 * device on a domain the operator has moved off.
 */
type ObservedEntry = { origin: string; baseline: string; recordedAt: number };
let _observed: Partial<Record<keyof ProviderConfigMap, ObservedEntry>> = {};
let _observedLoaded = false;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Call once at app startup (e.g. in App.tsx or a boot effect).
 * Tries remote first, falls back to local cache, then hardcoded.
 */
export async function initialiseProviderConfigs(): Promise<void> {
  await loadObservedFromStorage();

  // 1. Try remote
  const remote = await fetchRemoteConfigs();
  if (remote) {
    adoptBaseline(remote);
    _initialised = true;
    await persistToStorage(remote);
    debugLog("[ProviderConfig] Loaded from remote", summarise(_configs));
    return;
  }

  // 2. Try local cache
  const cached = await loadFromStorage();
  if (cached) {
    adoptBaseline(cached);
    _initialised = true;
    debugLog("[ProviderConfig] Loaded from local cache", summarise(_configs));
    return;
  }

  // 3. Hardcoded fallback
  adoptBaseline({ ...HARDCODED_FALLBACK });
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
  await loadObservedFromStorage();
  const remote = await fetchRemoteConfigs();
  if (remote) {
    // adoptBaseline re-applies any still-valid self-healed origin. Assigning
    // `remote` straight to `_configs` used to undo the redirect pin, so the
    // "refresh then retry" path in resolveWebPlayerUrl walked the whole
    // redirect chain a second time — the opposite of what the retry is for.
    adoptBaseline(remote);
    await persistToStorage(remote);
    debugLog("[ProviderConfig] Refreshed from remote", summarise(_configs));
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

  // Never pin backwards down the rotation: a request that happens to land on
  // an older Dizipal domain (e.g. an absolute link inside a cached page) would
  // otherwise re-introduce the whole redirect chain we just escaped.
  const currentSuffix = parseDizipalSuffix(current);
  const observedSuffix = parseDizipalSuffix(normalized);
  if (currentSuffix !== null && observedSuffix !== null && observedSuffix < currentSuffix) {
    return;
  }

  _configs[provider] = {
    baseUrl: normalized,
    referer: `${normalized}/`,
  };
  _observed[provider] = {
    origin: normalized,
    baseline: _baseline[provider].baseUrl.replace(/\/+$/, ""),
    recordedAt: Date.now(),
  };
  void persistToStorage(_configs);
  void persistObservedToStorage();
  debugLog(`[ProviderConfig] Self-healed ${provider}: ${current} → ${normalized}`);
}

/**
 * Install a freshly published config as the baseline and re-apply any
 * still-valid self-healed origin on top of it.
 */
function adoptBaseline(next: ProviderConfigMap): void {
  _baseline = { ...next };
  _configs = { ...next };

  for (const provider of Object.keys(_configs) as Array<keyof ProviderConfigMap>) {
    const entry = _observed[provider];
    if (!entry) continue;

    const baselineUrl = _baseline[provider].baseUrl.replace(/\/+$/, "");
    const stale = Date.now() - entry.recordedAt > OBSERVED_TTL_MS;
    // The published base moved — the operator rotated, so drop our pin and
    // follow them. Same-value baseline means the pin is still ahead of the
    // bot and is exactly the redirect chain we want to skip.
    if (stale || entry.baseline !== baselineUrl || !sameProviderFamily(provider, entry.origin)) {
      delete _observed[provider];
      void persistObservedToStorage();
      continue;
    }

    _configs[provider] = { baseUrl: entry.origin, referer: `${entry.origin}/` };
  }
}

async function loadObservedFromStorage(): Promise<void> {
  if (_observedLoaded) return;
  _observedLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(OBSERVED_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [provider, value] of Object.entries(parsed)) {
      const entry = value as Partial<ObservedEntry>;
      if (
        (provider === "hdfilm" || provider === "dizipal" || provider === "dizibal") &&
        typeof entry?.origin === "string" &&
        typeof entry?.baseline === "string" &&
        typeof entry?.recordedAt === "number"
      ) {
        _observed[provider] = entry as ObservedEntry;
      }
    }
  } catch { /* non-critical */ }
}

async function persistObservedToStorage(): Promise<void> {
  try {
    await AsyncStorage.setItem(OBSERVED_KEY, JSON.stringify(_observed));
  } catch { /* non-critical */ }
}

/** Test seam — resets the module back to a cold-start state. */
export function __resetProviderConfigsForTests(): void {
  _baseline = { ...HARDCODED_FALLBACK };
  _configs = { ...HARDCODED_FALLBACK };
  _observed = {};
  _observedLoaded = true;
  _initialised = false;
}

/** Test seam — installs a published config exactly as a remote fetch would. */
export function __adoptBaselineForTests(next: ProviderConfigMap): void {
  adoptBaseline(next);
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
  if (provider === "dizibal") return host.includes("dizibal");
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
      const replacement =
        STALE_PROVIDER_BASE_URLS[key]?.[baseUrl] ??
        (key === "dizipal" ? normaliseDizipalBaseUrl(baseUrl) : null) ??
        undefined;

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
  return `hdfilm=${c.hdfilm.baseUrl} dizipal=${c.dizipal.baseUrl} dizibal=${c.dizibal.baseUrl}`;
}
