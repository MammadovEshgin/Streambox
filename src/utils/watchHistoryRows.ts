import type { WatchHistoryEntry } from "../hooks/useWatchHistory";

// Pure helpers for turning a watch-history entry into Supabase-safe column
// values. Extracted from userDataSync so the invariants the database enforces
// (equal cast/director array cardinality, valid genders, clamped ranges) can be
// unit-tested without pulling in the Supabase client.

function nameAt(values: unknown, index: number): string {
  return Array.isArray(values) && typeof values[index] === "string" ? (values[index] as string) : "";
}

function pathAt(values: unknown, index: number): string | null {
  return Array.isArray(values) && typeof values[index] === "string" ? (values[index] as string) : null;
}

function genderAt(values: unknown, index: number): "male" | "female" | null {
  const value = Array.isArray(values) ? values[index] : undefined;
  return value === "male" || value === "female" ? value : null;
}

/**
 * The most billed cast members a user_watch_history row can hold (a CHECK
 * constraint on the table — migration `20260920200000`).
 *
 * This was 5 while entries kept 20, so the cloud silently truncated every cast
 * list on the way up: a device that hydrated from the cloud got five names per
 * title and Stats lost ensemble leads again (Cate Blanchett, billed 13th on
 * Fellowship) until a full local refetch happened to finish. It matches
 * WATCH_ENTRY_CAST_LIMIT now, so the round-trip is lossless.
 */
export const WATCH_HISTORY_REMOTE_CAST_LIMIT = 20;

/**
 * The metadata version from which cast survives the cloud round-trip. Any row
 * stamped below this was uploaded by a client that truncated to five, whatever
 * version it claims, so it must be re-enriched locally.
 */
export const WATCH_HISTORY_CAST_SYNC_VERSION = 8;

/**
 * The user_watch_history table requires every cast/director parallel array to
 * have the SAME length as its id array (and <= 20 entries, genders only
 * male/female/null). A single row breaking that fails the entire batch upsert —
 * which is why importing 800 films (lots of unknown-gender cast) never reached
 * the cloud. Rebuild each array strictly from the id array so the cardinality
 * always matches and genders are always valid. Every watch-history sync path
 * flows through here.
 */
export function buildWatchHistorySyncArrays(entry: WatchHistoryEntry) {
  const castIds = (Array.isArray(entry.castIds) ? entry.castIds : [])
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, WATCH_HISTORY_REMOTE_CAST_LIMIT);
  const directorIds = (Array.isArray(entry.directorIds) ? entry.directorIds : [])
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .slice(0, 5);

  return {
    castIds,
    castNames: castIds.map((_, i) => nameAt(entry.castNames, i)),
    castProfilePaths: castIds.map((_, i) => pathAt(entry.castProfilePaths, i)),
    castGenders: castIds.map((_, i) => genderAt(entry.castGenders, i)),
    directorIds,
    directorNames: directorIds.map((_, i) => nameAt(entry.directorNames, i)),
    directorProfilePaths: directorIds.map((_, i) => pathAt(entry.directorProfilePaths, i)),
  };
}

/**
 * Coerce a value into the table's allowed integer range, or null when it falls
 * outside it — so a stray runtime / release year / episode count can't fail the
 * upsert.
 */
export function clampIntOrNull(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded < min || rounded > max ? null : rounded;
}
