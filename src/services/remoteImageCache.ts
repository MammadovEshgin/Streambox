import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image as ExpoImage } from "expo-image";

import { clearFranchiseImageCache } from "./franchisePosterCache";

const LEGACY_IMAGE_CACHE_MIGRATION_KEY = "@streambox/legacy-image-cache-migration-v1";
const PREFETCH_BATCH_SIZE = 4;

function isHttpUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

export function normalizeRemoteImageCacheKey(uri: string) {
  try {
    const parsed = new URL(uri);
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

export async function prefetchRemoteImages(
  urls: Array<string | null | undefined>,
  limit = 12,
  batchSize = PREFETCH_BATCH_SIZE
) {
  const deduped = new Map<string, string>();

  urls.forEach((url) => {
    if (typeof url === "string" && isHttpUri(url)) {
      deduped.set(normalizeRemoteImageCacheKey(url), url);
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
    clearFranchiseImageCache(),
    clearManagedRemoteImageCaches(),
  ]);

  await AsyncStorage.setItem(LEGACY_IMAGE_CACHE_MIGRATION_KEY, "1");
}
