import * as FileSystem from "expo-file-system/legacy";

const AZ_CLASSIC_IMAGE_CACHE_DIRECTORY = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory)
  ? `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}streambox-az-classics/`
  : null;
const AZ_CLASSIC_IMAGE_DOWNLOAD_TIMEOUT_MS = 1200;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic"]);

const inFlightDownloads = new Map<string, Promise<string | null>>();

function getCacheDirectory() {
  if (!AZ_CLASSIC_IMAGE_CACHE_DIRECTORY) {
    throw new Error("Azerbaijan classics image cache is unavailable on this device.");
  }

  return AZ_CLASSIC_IMAGE_CACHE_DIRECTORY;
}

function isRemoteHttpUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

function isDirectImageUri(uri: string) {
  return /^(?:file|content|asset):\/\//i.test(uri) || uri.startsWith("data:");
}

function inferFileExtension(uri: string) {
  const sanitizedUri = uri.split("?")[0] ?? uri;
  const extension = sanitizedUri.split(".").pop()?.toLowerCase() ?? "jpg";
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension) ? extension : "jpg";
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getCacheFileUri(remoteUrl: string) {
  return `${getCacheDirectory()}${hashString(remoteUrl)}.${inferFileExtension(remoteUrl)}`;
}

async function getExistingCachedUri(remoteUrl: string) {
  const localUri = getCacheFileUri(remoteUrl);
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  return fileInfo.exists ? localUri : null;
}

async function ensureCacheDirectory() {
  await FileSystem.makeDirectoryAsync(getCacheDirectory(), { intermediates: true });
}

async function downloadImageToCache(remoteUrl: string) {
  const existingUri = await getExistingCachedUri(remoteUrl);
  if (existingUri) {
    return existingUri;
  }

  const activeDownload = inFlightDownloads.get(remoteUrl);
  if (activeDownload) {
    return activeDownload;
  }

  const localUri = getCacheFileUri(remoteUrl);
  const tempUri = `${localUri}.tmp`;
  const downloadPromise = (async () => {
    try {
      await ensureCacheDirectory();
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);

      const result = await FileSystem.downloadAsync(remoteUrl, tempUri);
      if (result.status < 200 || result.status >= 400) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
        return null;
      }

      const targetInfo = await FileSystem.getInfoAsync(localUri);
      if (targetInfo.exists) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
        return localUri;
      }

      await FileSystem.moveAsync({ from: result.uri, to: localUri });
      return localUri;
    } catch {
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
      return null;
    }
  })().finally(() => {
    inFlightDownloads.delete(remoteUrl);
  });

  inFlightDownloads.set(remoteUrl, downloadPromise);
  return downloadPromise;
}

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function resolveAzClassicImageUri(
  sourceUrl: string | null | undefined,
  timeoutMs = AZ_CLASSIC_IMAGE_DOWNLOAD_TIMEOUT_MS
) {
  if (!sourceUrl) {
    return null;
  }

  if (isDirectImageUri(sourceUrl) || !isRemoteHttpUri(sourceUrl)) {
    return sourceUrl;
  }

  const cachedUri = await getExistingCachedUri(sourceUrl);
  if (cachedUri) {
    return cachedUri;
  }

  const resolvedUri = await raceWithTimeout(downloadImageToCache(sourceUrl), timeoutMs);
  return resolvedUri ?? sourceUrl;
}

export async function warmAzClassicImageCache(urls: Array<string | null | undefined>) {
  const uniqueUrls = [...new Set(urls.filter((url): url is string => typeof url === "string" && isRemoteHttpUri(url)))];
  await Promise.allSettled(uniqueUrls.map((url) => downloadImageToCache(url)));
}

export async function clearAzClassicImageCache() {
  if (!AZ_CLASSIC_IMAGE_CACHE_DIRECTORY) {
    return;
  }

  const directoryInfo = await FileSystem.getInfoAsync(AZ_CLASSIC_IMAGE_CACHE_DIRECTORY);
  if (directoryInfo.exists) {
    await FileSystem.deleteAsync(AZ_CLASSIC_IMAGE_CACHE_DIRECTORY, { idempotent: true });
  }
  inFlightDownloads.clear();
}

export const __internal = {
  hashString,
  inferFileExtension,
  isDirectImageUri,
  isRemoteHttpUri,
};
