const ASSET_BASE_URL_ENV_KEY = "EXPO_PUBLIC_STREAMBOX_ASSET_BASE_URL";

function normalizeBaseUrl(baseUrl: string | undefined) {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export function isAbsoluteAssetUrl(value: string) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith("data:");
}

export function resolvePublicAssetUrl(
  value: string | null | undefined,
  env: Record<string, string | undefined> = process.env
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (isAbsoluteAssetUrl(trimmed)) {
    return trimmed;
  }

  const baseUrl = normalizeBaseUrl(env[ASSET_BASE_URL_ENV_KEY]);
  if (!baseUrl) {
    return trimmed;
  }

  const normalizedPath = trimmed.replace(/^\/+/, "");
  return `${baseUrl}/${normalizedPath}`;
}
