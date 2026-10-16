/**
 * Waits before each retry of a failed remote image. A poster that drops on a
 * flaky mobile connection (TMDB calls timed out in bursts on 2026-10-13) used
 * to stay blank; three retries over ~20s cover a blip without hammering a
 * phone that is offline.
 */
const REMOTE_IMAGE_RETRY_DELAYS_MS = [2_000, 5_000, 12_000];

/** Milliseconds to wait before retrying, or null when retrying cannot help. */
export function getRemoteImageRetryDelay(uri: string, attempt: number, error: string): number | null {
  if (!/^https?:\/\//i.test(uri)) return null;
  // The image is gone, not late.
  if (/\b(?:404|410)\b/.test(error)) return null;
  return REMOTE_IMAGE_RETRY_DELAYS_MS[attempt] ?? null;
}
