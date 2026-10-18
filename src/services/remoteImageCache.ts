import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image as ExpoImage } from "expo-image";

import { toProxiedTmdbImageUrl, toTmdbImageCacheUrl } from "../api/tmdbImageHost";
import { trackEvent } from "./telemetryService";

export { getRemoteImageRetryDelay } from "./remoteImageRetry";

const LEGACY_IMAGE_CACHE_MIGRATION_KEY = "@streambox/legacy-image-cache-migration-v1";
const PREFETCH_BATCH_SIZE = 4;

function isHttpUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

export function normalizeRemoteImageCacheKey(uri: string) {
  try {
    // Either image host, one cache entry: see tmdbImageHost.
    const parsed = new URL(toTmdbImageCacheUrl(uri));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return uri.split("#")[0]?.split("?")[0] ?? uri;
  }
}

export function createRemoteImageSource(uri: string) {
  return {
    uri,
    cacheKey: isHttpUri(uri) ? normalizeRemoteImageCacheKey(uri) : uri,
  };
}

/** Image failures reported per app session, so a dead network can't flood telemetry. */
const MAX_IMAGE_FAILURE_REPORTS = 12;
let imageFailureReports = 0;

export function reportRemoteImageFailure(uri: string, attempt: number, error: string, final: boolean) {
  if (imageFailureReports >= MAX_IMAGE_FAILURE_REPORTS) return;
  imageFailureReports += 1;
  let host = "invalid";
  try {
    host = new URL(uri).host;
  } catch {
    // keep "invalid"
  }
  trackEvent("image_load_failed", "network", { host, attempt, final, error }, final ? "warning" : "info");
}

export async function prefetchRemoteImages(
  urls: Array<string | null | undefined>,
  limit = 12,
  batchSize = PREFETCH_BATCH_SIZE
) {
  const deduped = new Map<string, string>();

  urls.forEach((url) => {
    if (typeof url === "string" && isHttpUri(url)) {
      deduped.set(normalizeRemoteImageCacheKey(url), toProxiedTmdbImageUrl(url));
    }
  });

  const uniqueUrls = [...deduped.values()].slice(0, limit);
  for (let index = 0; index < uniqueUrls.length; index += batchSize) {
    const batch = uniqueUrls.slice(index, index + batchSize);
    await ExpoImage.prefetch(batch, "disk");
  }
}

export async function clearManagedRemoteImageCaches() {
  await Promise.allSettled([
    ExpoImage.clearDiskCache(),
    ExpoImage.clearMemoryCache(),
  ]);
}

export async function migrateLegacyContentImageCaches() {
  const alreadyMigrated = await AsyncStorage.getItem(LEGACY_IMAGE_CACHE_MIGRATION_KEY);
  if (alreadyMigrated === "1") {
    return;
  }

  await Promise.allSettled([
    clearManagedRemoteImageCaches(),
  ]);

  await AsyncStorage.setItem(LEGACY_IMAGE_CACHE_MIGRATION_KEY, "1");
}
