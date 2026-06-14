export const SUPPORTED_LANGUAGES = ["en", "tr"] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: AppLanguage = "en";

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function normalizeAppLanguage(value: unknown): AppLanguage {
  if (typeof value !== "string") {
    return DEFAULT_LANGUAGE;
  }

  const normalized = value.trim().toLowerCase();
  if (isSupportedLanguage(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("tr")) {
    return "tr";
  }

  return DEFAULT_LANGUAGE;
}

export function getLanguageLocale(language: AppLanguage) {
  switch (language) {
    case "tr":
      return "tr-TR";
    case "en":
    default:
      return "en-US";
  }
}

export function getLanguageNativeName(language: AppLanguage) {
  switch (language) {
    case "tr":
      return "Turkce";
    case "en":
    default:
      return "English";
  }
}
