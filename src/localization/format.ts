import i18n from "./i18n";
import { getLanguageLocale, normalizeAppLanguage } from "./types";

function getActiveLocale() {
  return getLanguageLocale(normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language));
}

export function formatLocalizedDate(
  value: number | string | Date,
  options: Intl.DateTimeFormatOptions
) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat(getActiveLocale(), options).format(date);
}

export function formatLocalizedMonthDayYear(value: number | string | Date) {
  return formatLocalizedDate(value, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatLocalizedMonthYear(value: number | string | Date) {
  return formatLocalizedDate(value, {
    month: "long",
    year: "numeric",
  });
}
