import type { TFunction } from "i18next";

// Compact relative time for social rows ("now", "5m", "3h", "2d", or a date).
// Localized via the social.time* keys. UI-only helper (formatting, not logic).
export function formatRelativeTime(iso: string, t: TFunction, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("social.timeNow");
  if (minutes < 60) return t("social.timeMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("social.timeHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("social.timeDays", { count: days });
  return new Date(then).toLocaleDateString();
}
