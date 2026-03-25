import * as FileSystem from "expo-file-system/legacy";

const FRANCHISE_IMAGE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}streambox-franchises/`
  : null;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic"]);
const DEFAULT_BATCH_SIZE = 6;

const memoryCache = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string | null>>();

let directoryReady = false;

function isRemoteHttpUri(uri: string) {
  return /^https?:\/\//i.test(uri);
}

function isLocalUri(uri: string) {
  return /^(?:file|content|asset):\/\//i.test(uri) || uri.startsWith("data:");
}

function inferExtension(uri: string) {
  const cleanUri = uri.split("?")[0] ?? uri;
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
    ? `${FRANCHISE_IMAGE_DIR}${hashString(remoteUrl)}.${inferExtension(remoteUrl)}`
    : null;
}

async function ensureDirectory() {
  if (!FRANCHISE_IMAGE_DIR || directoryReady) {
    return;
  }

  await FileSystem.makeDirectoryAsync(FRANCHISE_IMAGE_DIR, { intermediates: true });
  directoryReady = true;
}

async function getExistingCachedUri(remoteUrl: string) {
  const memoryCached = memoryCache.get(remoteUrl);
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

  memoryCache.set(remoteUrl, localUri);
  return localUri;
}

async function downloadOne(remoteUrl: string): Promise<string | null> {
  const existing = await getExistingCachedUri(remoteUrl);
  if (existing) {
    return existing;
  }

  const activeDownload = inFlightDownloads.get(remoteUrl);
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
        memoryCache.set(remoteUrl, localUri);
        return localUri;
      }

      await FileSystem.moveAsync({ from: result.uri, to: localUri });
      memoryCache.set(remoteUrl, localUri);
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

  return (await downloadOne(sourceUrl)) ?? sourceUrl;
}

export async function warmFranchiseImageCache(
  urls: Array<string | null | undefined>,
  batchSize = DEFAULT_BATCH_SIZE
) {
  const uniqueUrls = [
    ...new Set(urls.filter((url): url is string => typeof url === "string" && isRemoteHttpUri(url))),
  ];

  if (uniqueUrls.length === 0) {
    return;
  }

  for (let index = 0; index < uniqueUrls.length; index += batchSize) {
    const batch = uniqueUrls.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((url) => downloadOne(url)));
  }
}

export async function clearFranchiseImageCache() {
  memoryCache.clear();
  inFlightDownloads.clear();
  directoryReady = false;

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
