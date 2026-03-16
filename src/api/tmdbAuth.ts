export type TmdbAuthMode = "api_key" | "bearer" | "none";

type ResolvedTmdbAuth = {
  mode: TmdbAuthMode;
  apiKeyParam?: string;
  bearerToken?: string;
};

function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function looksLikeBearerToken(value: string): boolean {
  // Heuristic for common TMDB v4 access tokens (JWT-style strings).
  if (value.length < 40) {
    return false;
  }

  if (!value.includes(".")) {
    return false;
  }

  return value.startsWith("eyJ");
}

export function resolveTmdbAuth(
  apiKeyRaw: string | undefined,
  accessTokenRaw: string | undefined
): ResolvedTmdbAuth {
  const apiKey = normalizeValue(apiKeyRaw);
  const accessToken = normalizeValue(accessTokenRaw);

  // If the "API key" actually looks like a bearer token and no explicit bearer is provided,
  // treat it as a bearer token. This fixes misconfigurations where the v4 token is placed
  // into EXPO_PUBLIC_TMDB_API_KEY instead of EXPO_PUBLIC_TMDB_ACCESS_TOKEN.
  if (!accessToken && apiKey && looksLikeBearerToken(apiKey)) {
    return {
      mode: "bearer",
      bearerToken: apiKey
    };
  }

  // Prefer API key when both are present to avoid invalid bearer-token 401s.
  if (apiKey) {
    return {
      mode: "api_key",
      apiKeyParam: apiKey,
      bearerToken: accessToken
    };
  }

  if (accessToken) {
    return {
      mode: "bearer",
      bearerToken: accessToken
    };
  }

  return {
    mode: "none"
  };
}

export function getAlternateTmdbAuthMode(
  currentMode: TmdbAuthMode,
  resolved: ResolvedTmdbAuth
): "api_key" | "bearer" | null {
  const hasApiKey = Boolean(resolved.apiKeyParam);
  const hasBearer = Boolean(resolved.bearerToken);

  if (currentMode === "api_key") {
    return hasBearer ? "bearer" : null;
  }

  if (currentMode === "bearer") {
    return hasApiKey ? "api_key" : null;
  }

  if (hasApiKey) {
    return "api_key";
  }

  if (hasBearer) {
    return "bearer";
  }

  return null;
}
