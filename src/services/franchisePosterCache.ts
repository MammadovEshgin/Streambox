import * as FileSystem from "expo-file-system/legacy";

const FRANCHISE_IMAGE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}streambox-franchises/`
  : null;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic"]);
const DEFAULT_BATCH_SIZE = 4;
const BLOCKING_RESOLVE_TIMEOUT_MS = 1500;
const FRANCHISE_IMAGE_MAX_CACHE_BYTES = 24 * 1024 * 1024;
const FRANCHISE_IMAGE_MAX_FILE_COUNT = 48;

const memoryCache = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string | null>>();

let directoryReady = false;
let prunePromise: Promise<void> | null = null;
let initialPruneScheduled = false;

function isRemoteHttpUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

function isLocalUri(uri: string) {
  return /^(?:file|content|asset):\/\//i.test(uri) || uri.startsWith("data:");
}

function normalizeRemoteUrlCacheKey(uri: string) {
  try {
    const parsed = new URL(uri);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return uri.split("#")[0]?.split("?")[0] ?? uri;
  }
}

function inferExtension(uri: string) {
  const cleanUri = normalizeRemoteUrlCacheKey(uri);
  const extension = cleanUri.split(".").pop()?.toLowerCase() ?? "jpg";
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
  return FRANCHISE_IMAGE_DIR
    ? `${FRANCHISE_IMAGE_DIR}${hashString(normalizeRemoteUrlCacheKey(remoteUrl))}.${inferExtension(remoteUrl)}`
    : null;
}

async function ensureDirectory() {
  if (!FRANCHISE_IMAGE_DIR || directoryReady) {
    return;
  }

  await FileSystem.makeDirectoryAsync(FRANCHISE_IMAGE_DIR, { intermediates: true });
  directoryReady = true;
}

async function pruneCacheDirectory() {
  if (!FRANCHISE_IMAGE_DIR) {
    return;
  }

  try {
    const entries = await FileSystem.readDirectoryAsync(FRANCHISE_IMAGE_DIR);
    const files = (
      await Promise.all(
        entries.map(async (name) => {
          const uri = `${FRANCHISE_IMAGE_DIR}${name}`;
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists) {
            return null;
          }

          return {
            uri,
            size: typeof info.size === "number" ? info.size : 0,
            modifiedAt:
              typeof info.modificationTime === "number" && Number.isFinite(info.modificationTime)
                ? info.modificationTime
                : 0,
          };
        })
      )
    )
      .filter((entry): entry is { uri: string; size: number; modifiedAt: number } => entry !== null)
      .sort((left, right) => left.modifiedAt - right.modifiedAt);

    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let overflowCount = Math.max(0, files.length - FRANCHISE_IMAGE_MAX_FILE_COUNT);

    for (const file of files) {
      if (totalBytes <= FRANCHISE_IMAGE_MAX_CACHE_BYTES && overflowCount <= 0) {
        break;
      }

      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => undefined);
      totalBytes = Math.max(0, totalBytes - file.size);
      overflowCount = Math.max(0, overflowCount - 1);
    }
  } catch {
    // Best-effort pruning.
  }
}

function schedulePruneCache() {
  if (prunePromise) {
    return prunePromise;
  }

  prunePromise = pruneCacheDirectory().finally(() => {
    prunePromise = null;
  });
  return prunePromise;
}

function ensureInitialPrune() {
  if (initialPruneScheduled) {
    return;
  }

  initialPruneScheduled = true;
  void schedulePruneCache();
}

async function getExistingCachedUri(remoteUrl: string) {
  ensureInitialPrune();
  const normalizedUrl = normalizeRemoteUrlCacheKey(remoteUrl);
  const memoryCached = memoryCache.get(normalizedUrl);
  if (memoryCached) {
    return memoryCached;
  }

  const localUri = getCacheFileUri(remoteUrl);
  if (!localUri) {
    return null;
  }

  const info = await FileSystem.getInfoAsync(localUri);
  if (!info.exists) {
    return null;
  }

  memoryCache.set(normalizedUrl, localUri);
  return localUri;
}

async function downloadOne(remoteUrl: string): Promise<string | null> {
  const normalizedUrl = normalizeRemoteUrlCacheKey(remoteUrl);
  const existing = await getExistingCachedUri(remoteUrl);
  if (existing) {
    return existing;
  }

  const activeDownload = inFlightDownloads.get(normalizedUrl);
  if (activeDownload) {
    return activeDownload;
  }

  const localUri = getCacheFileUri(remoteUrl);
  if (!localUri) {
    return null;
  }

  const tempUri = `${localUri}.tmp`;
  const downloadPromise = (async () => {
    try {
      await ensureDirectory();
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);

      const result = await FileSystem.downloadAsync(remoteUrl, tempUri);
      if (result.status < 200 || result.status >= 400) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
        return null;
      }

      const targetInfo = await FileSystem.getInfoAsync(localUri);
      if (targetInfo.exists) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
        memoryCache.set(normalizedUrl, localUri);
        return localUri;
      }

      await FileSystem.moveAsync({ from: result.uri, to: localUri });
      memoryCache.set(normalizedUrl, localUri);
      void schedulePruneCache();
      return localUri;
    } catch {
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
      return null;
    }
  })().finally(() => {
    inFlightDownloads.delete(normalizedUrl);
  });

  inFlightDownloads.set(normalizedUrl, downloadPromise);
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

export async function getCachedFranchiseImageUri(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return null;
  }

  if (isLocalUri(sourceUrl) || !isRemoteHttpUri(sourceUrl)) {
    return sourceUrl;
  }

  try {
    return await getExistingCachedUri(sourceUrl);
  } catch {
    return null;
  }
}

export async function resolveFranchiseImageUri(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return null;
  }

  if (isLocalUri(sourceUrl) || !isRemoteHttpUri(sourceUrl)) {
    return sourceUrl;
  }

  const cachedUri = await getCachedFranchiseImageUri(sourceUrl);
  if (cachedUri) {
    return cachedUri;
  }

  void downloadOne(sourceUrl);
  return sourceUrl;
}

export async function resolveFranchiseImageUriBlocking(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return null;
  }

  if (isLocalUri(sourceUrl) || !isRemoteHttpUri(sourceUrl)) {
    return sourceUrl;
  }

  const cachedUri = await getCachedFranchiseImageUri(sourceUrl);
  if (cachedUri) {
    return cachedUri;
  }

  return (await raceWithTimeout(downloadOne(sourceUrl), BLOCKING_RESOLVE_TIMEOUT_MS)) ?? sourceUrl;
}

export async function warmFranchiseImageCache(
  urls: Array<string | null | undefined>,
  batchSize = DEFAULT_BATCH_SIZE
) {
  const deduped = new Map<string, string>();
  urls.forEach((url) => {
    if (typeof url === "string" && isRemoteHttpUri(url)) {
      deduped.set(normalizeRemoteUrlCacheKey(url), url);
    }
  });

  const uniqueUrls = [...deduped.values()];

  if (uniqueUrls.length === 0) {
    return;
  }

  for (let index = 0; index < uniqueUrls.length; index += batchSize) {
    const batch = uniqueUrls.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((url) => downloadOne(url)));
  }

  void schedulePruneCache();
}

export async function clearFranchiseImageCache() {
  memoryCache.clear();
  inFlightDownloads.clear();
  directoryReady = false;
  prunePromise = null;
  initialPruneScheduled = false;

  if (!FRANCHISE_IMAGE_DIR) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(FRANCHISE_IMAGE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(FRANCHISE_IMAGE_DIR, { idempotent: true });
    }
  } catch {
    // Best-effort cleanup.
  }
}
