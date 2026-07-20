/**
 * Pure helpers for the synced media id lists (watchlist / liked). Extracted so
 * the vanished-items regression is unit-testable without React.
 *
 * Two invariants live here:
 *  - "603" and 603 are the SAME movie. Detail screens navigate with string
 *    route params while imports and cards store numeric TMDB ids; comparing
 *    with `includes` treated them as different, which produced phantom
 *    duplicates and removes that didn't remove.
 *  - Non-numeric ids (internal string ids) pass through untouched.
 */

export function normalizeMediaListId(id: number | string): number | string {
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return trimmed;
  }
  return id;
}

export function mediaListIdsEqual(a: number | string, b: number | string): boolean {
  return normalizeMediaListId(a) === normalizeMediaListId(b);
}

export function listIncludesMediaId(list: (number | string)[], id: number | string): boolean {
  return list.some((entry) => mediaListIdsEqual(entry, id));
}

export function parseStoredMediaIds(rawValue: string | null): (number | string)[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is number | string => {
      if (typeof entry === "number") {
        return Number.isFinite(entry);
      }
      if (typeof entry === "string") {
        return entry.trim().length > 0;
      }
      return false;
    });
  } catch {
    return [];
  }
}

export type MediaIdMutationResult = {
  next: (number | string)[];
  /** Whether the id was present BEFORE the mutation. */
  existed: boolean;
  changed: boolean;
};

/** Add the id when absent, remove it when present. */
export function toggleMediaIdInList(list: (number | string)[], id: number | string): MediaIdMutationResult {
  const normalizedId = normalizeMediaListId(id);
  const existed = listIncludesMediaId(list, normalizedId);
  const next = existed
    ? list.filter((entry) => !mediaListIdsEqual(entry, normalizedId))
    : [...list, normalizedId];
  return { next, existed, changed: true };
}

export function removeMediaIdFromList(list: (number | string)[], id: number | string): MediaIdMutationResult {
  const normalizedId = normalizeMediaListId(id);
  const existed = listIncludesMediaId(list, normalizedId);
  if (!existed) {
    return { next: list, existed: false, changed: false };
  }
  return {
    next: list.filter((entry) => !mediaListIdsEqual(entry, normalizedId)),
    existed: true,
    changed: true,
  };
}
