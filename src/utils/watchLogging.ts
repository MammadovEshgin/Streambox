/**
 * Pure helpers for the "log as watched" paths that start without full title
 * details in hand (Cinematic Journeys long-press, the player's auto-mark).
 */

/** "/abc.jpg" from any TMDB image URL (image.tmdb.org or our /t/p proxy), else null. */
export function tmdbPosterPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/t\/p\/[^/]+(\/[^/?#]+)(?:[?#].*)?$/.exec(url);
  return match ? match[1] : null;
}

/**
 * Resolve `task`, or reject once `ms` pass. A details fetch on a dead
 * connection retries for a long time; the logging paths fall back to an entry
 * built from what they already know rather than make the user wait.
 */
export function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** How long a logging path waits for full details before saving a fallback entry. */
export const WATCH_LOG_DETAILS_TIMEOUT_MS = 6_000;
