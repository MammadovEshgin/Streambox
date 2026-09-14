/**
 * Day-stepped selection for the "of the day" heroes.
 *
 * The requirement is narrow and absolute: between 00:00 and 23:59 local time a
 * user sees exactly one title, and at midnight it becomes a different one.
 *
 * The picker used to seed a hash with `"<type>:<user>:<date>"` and take it
 * modulo the shortlist length. That is uniformly distributed but not
 * *sequential* — over a six-title shortlist two consecutive days collide about
 * one time in six, and a title could reappear two days later. Stepping the
 * index by the day number instead makes consecutive days differ by exactly one
 * position, so the pick always moves; the per-user hash only chooses where in
 * the list each account starts, which is what keeps two users apart.
 *
 * Pure on purpose: this is the part of the daily pick worth locking down with
 * tests, and it must not drag AsyncStorage or TMDB into them.
 */

/** FNV-1a. Stable across reloads, which a JS `Math.random` seed would not be. */
export function hashString(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * Days since the epoch for a `YYYY-MM-DD` key.
 *
 * The key is already local-calendar (see `getLocalDateKey`), so it is read back
 * through `Date.UTC` purely to turn it into a day count — no timezone maths is
 * intended, and using UTC here avoids a DST shift moving the boundary.
 */
export function getDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 0;
  }

  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Which entry of a `length`-item shortlist `dateKey` gets for `seed`.
 *
 * Guarantees, for length > 1: consecutive days never return the same index, and
 * no index repeats until the whole list has been walked.
 */
export function pickRotatingIndex(length: number, dateKey: string, seed: string): number {
  if (length <= 1) {
    return 0;
  }

  return (getDayNumber(dateKey) + hashString(seed)) % length;
}

/** One day's pick, kept so the next few days can avoid repeating it. */
export type RecentDailyPick = {
  dateKey: string;
  id: number;
};

/** Drop anything that isn't a usable `{ dateKey, id }` record. */
export function parseRecentPicks(value: unknown): RecentDailyPick[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is RecentDailyPick =>
      Boolean(entry)
      && typeof (entry as RecentDailyPick).dateKey === "string"
      && Number.isFinite((entry as RecentDailyPick).id)
  );
}

/**
 * Put today's pick at the front, replacing any existing entry for the same day,
 * and keep at most `limit` days of history.
 */
export function withRecentPick(
  existing: RecentDailyPick[],
  dateKey: string,
  id: number,
  limit: number
): RecentDailyPick[] {
  return [{ dateKey, id }, ...existing.filter((entry) => entry.dateKey !== dateKey)].slice(0, limit);
}

/**
 * Ids picked on days OTHER than `dateKey`.
 *
 * Today's own entry is deliberately excluded from the exclusion set, so a
 * recompute during the same day (language switch, cache eviction) can still
 * land on the title the user has already been shown.
 */
export function getRecentlyPickedIds(recent: RecentDailyPick[], dateKey: string): number[] {
  return recent.filter((entry) => entry.dateKey !== dateKey).map((entry) => entry.id);
}
