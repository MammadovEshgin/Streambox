import type { MediaItem } from "./tmdb";

export function formatRating(value: unknown, fractionDigits = 1): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return numeric.toFixed(fractionDigits);
}

export function isValidMediaItem(value: unknown): value is MediaItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<MediaItem>;
  return (
    (typeof item.id === "number" || typeof item.id === "string")
    && typeof item.title === "string"
    && typeof item.rating === "number"
    && Number.isFinite(item.rating)
  );
}

export function isValidMediaItemArray(value: unknown): value is MediaItem[] {
  return Array.isArray(value) && value.every(isValidMediaItem);
}
