import AsyncStorage from "@react-native-async-storage/async-storage";

type TelemetrySeverity = "debug" | "info" | "warning" | "error" | "fatal";
type TelemetryCategory = "app" | "crash" | "network" | "performance" | "supabase" | "tmdb";
type TelemetryMetadata = Record<string, unknown>;

type PendingTelemetryEvent = {
  eventName: string;
  eventCategory: TelemetryCategory;
  severity: TelemetrySeverity;
  metadata: TelemetryMetadata;
  occurredAt: string;
};

type TelemetryRuntimeInfo = {
  platform?: string | null;
  appVersion?: string | null;
  buildChannel?: string | null;
  updateId?: string | null;
};

const TELEMETRY_QUEUE_KEY = "@streambox/telemetry-queue-v1";
const MAX_QUEUE_SIZE = 80;
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 4_000;
const MAX_STRING_LENGTH = 280;
const MAX_METADATA_KEYS = 24;
const MAX_METADATA_DEPTH = 2;

const telemetryFlag = process.env.EXPO_PUBLIC_ENABLE_TELEMETRY?.trim();
const isNodeRuntime = typeof process !== "undefined" && process.release?.name === "node";
const isDevRuntime = Boolean((globalThis as any).__DEV__) || process.env.NODE_ENV === "test";
const isTelemetryEnabled = telemetryFlag !== "0" && !isNodeRuntime && (!isDevRuntime || telemetryFlag === "1");
const sessionId = createSessionId();

let queue: PendingTelemetryEvent[] = [];
let hydratePromise: Promise<void> | null = null;
let flushPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isInitialised = false;
let lastPermanentFailureAt = 0;
let runtimeInfo: TelemetryRuntimeInfo = {};

function createSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSensitiveKey(key: string) {
  return /token|authorization|apikey|api_key|secret|password|stream|subtitle|cookie|session/i.test(key);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeValue(value.message, depth + 1),
      stack: sanitizeValue(value.stack?.split("\n").slice(0, 6).join("\n") ?? "", depth + 1),
    };
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_METADATA_DEPTH) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 8).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_METADATA_DEPTH) {
      return "[object]";
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_METADATA_KEYS)
        .map(([key, entryValue]) => [
          key,
          isSensitiveKey(key) ? "[redacted]" : sanitizeValue(entryValue, depth + 1),
        ])
    );
  }

  return String(value);
}

function sanitizeMetadata(metadata: TelemetryMetadata = {}) {
  return sanitizeValue(metadata, 0) as TelemetryMetadata;
}

async function hydrateQueue() {
  if (!isTelemetryEnabled) {
    return;
  }

  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(TELEMETRY_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          queue = parsed.slice(-MAX_QUEUE_SIZE);
        }
      } catch {
        queue = [];
      }
    })();
  }

  await hydratePromise;
}

function persistQueue() {
  if (!isTelemetryEnabled) {
    return;
  }

  void AsyncStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE))).catch(() => undefined);
}

function scheduleFlush() {
  if (!isTelemetryEnabled || flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTelemetry();
  }, FLUSH_DELAY_MS);
}

function toRow(event: PendingTelemetryEvent) {
  return {
    session_id: sessionId,
    event_name: event.eventName,
    event_category: event.eventCategory,
    severity: event.severity,
    metadata: event.metadata,
    platform: runtimeInfo.platform ?? null,
    app_version: runtimeInfo.appVersion ?? null,
    build_channel: runtimeInfo.buildChannel ?? null,
    occurred_at: event.occurredAt,
  };
}

export function initialiseTelemetry(info: TelemetryRuntimeInfo = {}) {
  if (!isTelemetryEnabled || isInitialised) {
    return;
  }

  isInitialised = true;
  runtimeInfo = info;
  void hydrateQueue().then(() => {
    trackEvent("app_session_started", "app", {
      updateId: runtimeInfo.updateId ?? null,
      runtimeVersion: runtimeInfo.appVersion ?? null,
    });
  });

  const errorUtils = (globalThis as any).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  if (typeof errorUtils?.setGlobalHandler === "function") {
    errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      trackAppError("global_js_error", error, { isFatal: Boolean(isFatal) }, isFatal ? "fatal" : "error");
      if (typeof previousHandler === "function") {
        previousHandler(error, isFatal);
      }
    });
  }
}

export function trackEvent(
  eventName: string,
  eventCategory: TelemetryCategory = "app",
  metadata: TelemetryMetadata = {},
  severity: TelemetrySeverity = "info"
) {
  if (!isTelemetryEnabled) {
    return;
  }

  void hydrateQueue().then(() => {
    queue.push({
      eventName,
      eventCategory,
      severity,
      metadata: sanitizeMetadata(metadata),
      occurredAt: new Date().toISOString(),
    });
    queue = queue.slice(-MAX_QUEUE_SIZE);
    persistQueue();
    scheduleFlush();
  });
}

export function trackAppError(
  eventName: string,
  error: unknown,
  metadata: TelemetryMetadata = {},
  severity: TelemetrySeverity = "error"
) {
  const normalizedError = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

  trackEvent(eventName, "crash", { ...metadata, error: normalizedError }, severity);
}

export function trackNetworkFailure(
  service: "tmdb" | "supabase" | "external-ratings" | "provider-configs" | "feedback",
  metadata: TelemetryMetadata = {},
  severity: TelemetrySeverity = "warning"
) {
  trackEvent(`${service}_request_failed`, service === "tmdb" ? "tmdb" : service === "supabase" ? "supabase" : "network", metadata, severity);
}

export function trackPerformance(name: string, durationMs: number, metadata: TelemetryMetadata = {}) {
  trackEvent(name, "performance", { ...metadata, durationMs: Math.round(durationMs) });
}

export async function flushTelemetry() {
  if (!isTelemetryEnabled || flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    await hydrateQueue();

    if (queue.length === 0) {
      return;
    }

    const { supabase } = await import("./supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      persistQueue();
      return;
    }

    if (Date.now() - lastPermanentFailureAt < 60_000) {
      return;
    }

    const batch = queue.splice(0, MAX_BATCH_SIZE);
    const { error } = await supabase.from("app_telemetry_events").insert(batch.map(toRow));

    if (error) {
      queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
      persistQueue();

      if (error.code === "42P01" || error.code === "42501") {
        lastPermanentFailureAt = Date.now();
      }
      return;
    }

    persistQueue();
    if (queue.length > 0) {
      scheduleFlush();
    }
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}
