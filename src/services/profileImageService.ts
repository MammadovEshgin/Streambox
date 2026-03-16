import * as FileSystem from "expo-file-system/legacy";

export type ProfileImageBackupPayload = {
  base64: string;
  fileExtension: string;
};

const PROFILE_IMAGE_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}streambox/`
  : null;
const PROFILE_IMAGE_FILE_STEM = "profile-image";
const BANNER_IMAGE_FILE_STEM = "banner-image";
const PROFILE_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic"] as const;

function ensureDocumentDirectory() {
  if (!PROFILE_IMAGE_DIRECTORY) {
    throw new Error("Profile image storage is unavailable on this device.");
  }

  return PROFILE_IMAGE_DIRECTORY;
}

function inferFileExtension(uri: string) {
  const match = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const extension = match?.[1] ?? "jpg";
  return PROFILE_IMAGE_EXTENSIONS.includes(extension as (typeof PROFILE_IMAGE_EXTENSIONS)[number])
    ? extension
    : "jpg";
}

function resolveProfileImageUri(extension: string) {
  const directory = ensureDocumentDirectory();
  return `${directory}${PROFILE_IMAGE_FILE_STEM}.${extension}`;
}

function resolveBannerImageUri(extension: string) {
  const directory = ensureDocumentDirectory();
  return `${directory}${BANNER_IMAGE_FILE_STEM}.${extension}`;
}

async function ensureProfileImageDirectory() {
  const directory = ensureDocumentDirectory();
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}

async function removeExistingImages(resolveFn: (ext: string) => string) {
  await Promise.all(
    PROFILE_IMAGE_EXTENSIONS.map(async (extension) => {
      const existingUri = resolveFn(extension);
      const info = await FileSystem.getInfoAsync(existingUri);
      if (info.exists) {
        await FileSystem.deleteAsync(existingUri, { idempotent: true });
      }
    })
  );
}

async function removeExistingProfileImages() {
  await removeExistingImages(resolveProfileImageUri);
}

export async function storeProfileImageFromUri(sourceUri: string) {
  const extension = inferFileExtension(sourceUri);
  const destinationUri = resolveProfileImageUri(extension);

  await ensureProfileImageDirectory();
  await removeExistingProfileImages();

  if (sourceUri !== destinationUri) {
    await FileSystem.copyAsync({
      from: sourceUri,
      to: destinationUri,
    });
  }

  return destinationUri;
}

export async function createProfileImageBackup(profileImageUri: string): Promise<ProfileImageBackupPayload | null> {
  try {
    const info = await FileSystem.getInfoAsync(profileImageUri);
    if (!info.exists) {
      return null;
    }

    const base64 = await FileSystem.readAsStringAsync(profileImageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return {
      base64,
      fileExtension: inferFileExtension(profileImageUri),
    };
  } catch {
    return null;
  }
}

export async function storeBannerImageFromUri(sourceUri: string) {
  const extension = inferFileExtension(sourceUri);
  const destinationUri = resolveBannerImageUri(extension);

  await ensureProfileImageDirectory();
  await removeExistingImages(resolveBannerImageUri);

  if (sourceUri !== destinationUri) {
    await FileSystem.copyAsync({
      from: sourceUri,
      to: destinationUri,
    });
  }

  return destinationUri;
}

export async function restoreProfileImageFromBackup(payload: ProfileImageBackupPayload) {
  const destinationUri = resolveProfileImageUri(payload.fileExtension || "jpg");

  await ensureProfileImageDirectory();
  await removeExistingProfileImages();
  await FileSystem.writeAsStringAsync(destinationUri, payload.base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return destinationUri;
}
