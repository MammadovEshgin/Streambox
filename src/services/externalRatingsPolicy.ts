export type ExternalRatingsSurface = "detail" | "list" | "background";

const LIST_RATINGS_ENV_FLAG = "EXPO_PUBLIC_ENABLE_LIST_EXTERNAL_RATINGS";

function isEnabledFlag(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

export function shouldFetchExternalRatings(
  surface: ExternalRatingsSurface,
  env: Record<string, string | undefined> = process.env
) {
  if (surface === "detail") {
    return true;
  }

  if (surface === "list") {
    return isEnabledFlag(env[LIST_RATINGS_ENV_FLAG]);
  }

  return false;
}
