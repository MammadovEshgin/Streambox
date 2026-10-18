/**
 * Where TMDB images are fetched from.
 *
 * image.tmdb.org is BunnyCDN, and from 2026-10-16 the edges DNS hands
 * Azerbaijani phones (79.127.134.x, from 1.1.1.1 and 8.8.8.8 alike) refuse
 * connections: `image_load_failed` filled with "failed to connect to
 * image.tmdb.org/79.127.134.228", and every poster waited out a 10s connect
 * timeout before it appeared. The TMDB proxy Worker serves the same files from
 * our own domain, which every carrier reaches, so images go there first and
 * fall back to TMDB's CDN on a retry.
 *
 * The disk cache keys an image by its proxy URL whichever host served it
 * (`toTmdbImageCacheUrl`), the same key `ExpoImage.prefetch` stores a
 * proxied URL under. Posters cached under image.tmdb.org before the switch
 * are fetched once more.
 */

export const TMDB_IMAGE_ORIGIN = "https://image.tmdb.org";
export const TMDB_IMAGE_PROXY_ORIGIN = "https://tmdb.streamboxapp.stream";

/** The paths the Worker proxies; anything else stays on its own host. */
const TMDB_IMAGE_PATH = /^\/t\/p\/(?:w\d{2,4}|h\d{2,4}|original)\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|svg)$/;

function splitTmdbImageUrl(url: string): { origin: string; path: string } | null {
  for (const origin of [TMDB_IMAGE_ORIGIN, TMDB_IMAGE_PROXY_ORIGIN]) {
    if (url.startsWith(`${origin}/`)) {
      const path = url.slice(origin.length).split(/[?#]/)[0];
      return TMDB_IMAGE_PATH.test(path) ? { origin, path } : null;
    }
  }
  return null;
}

/** A TMDB image URL on the proxy; any other URL unchanged. */
export function toProxiedTmdbImageUrl(url: string): string {
  const parts = splitTmdbImageUrl(url);
  return parts ? `${TMDB_IMAGE_PROXY_ORIGIN}${parts.path}` : url;
}

/** The same image on the other host, or null for a URL that is not a TMDB image. */
export function alternateTmdbImageUrl(url: string): string | null {
  const parts = splitTmdbImageUrl(url);
  if (!parts) return null;
  const other = parts.origin === TMDB_IMAGE_ORIGIN ? TMDB_IMAGE_PROXY_ORIGIN : TMDB_IMAGE_ORIGIN;
  return `${other}${parts.path}`;
}

/** The URL a TMDB image is cached under, whichever host serves it. */
export function toTmdbImageCacheUrl(url: string): string {
  const parts = splitTmdbImageUrl(url);
  return parts ? `${TMDB_IMAGE_PROXY_ORIGIN}${parts.path}` : url;
}
