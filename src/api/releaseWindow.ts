/**
 * Whether a film has left its cinema-only window, i.e. whether the providers
 * can carry it yet.
 *
 * A film that opens in cinemas reaches the providers only once it is sold or
 * streamed online, which TMDB records as a digital (4), physical (5) or TV (6)
 * release. Checked against the providers on 2026-10-05: every trending film
 * with a past home release played, and every cinema-only one was missing. A
 * film streaming services premiere has a digital release from day one, so it
 * shows at once.
 *
 * Discovery rails hide films still in that window; search and detail pages
 * do not, since the user asked for the title by name.
 */

/** TMDB `release_dates` types. */
const PREMIERE = 1;
const THEATRICAL_LIMITED = 2;
const THEATRICAL = 3;
const DIGITAL = 4;
const PHYSICAL = 5;
const TV = 6;

/**
 * A cinema film with no home release on record yet is assumed online this
 * long after it opened — TMDB often learns the digital date late.
 */
export const CINEMA_ONLY_WINDOW_DAYS = 90;

export type ReleaseWindow = {
  /** Earliest cinema release in any country, YYYY-MM-DD. */
  theatrical: string | null;
  /** Earliest digital / physical / TV release in any country, YYYY-MM-DD. */
  home: string | null;
  /** True when TMDB lists any release at all (a premiere counts). */
  listed: boolean;
};

export type TmdbReleaseDatesResponse = {
  results?: Array<{
    iso_3166_1?: string;
    release_dates?: Array<{ type?: number; release_date?: string }>;
  }>;
};

function earlier(current: string | null, next: string): string {
  return current === null || next < current ? next : current;
}

export function readReleaseWindow(response: TmdbReleaseDatesResponse): ReleaseWindow {
  const window: ReleaseWindow = { theatrical: null, home: null, listed: false };
  for (const country of response.results ?? []) {
    for (const entry of country.release_dates ?? []) {
      const date = entry.release_date?.slice(0, 10);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (entry.type === PREMIERE || entry.type === THEATRICAL_LIMITED || entry.type === THEATRICAL) {
        window.listed = true;
        if (entry.type !== PREMIERE) window.theatrical = earlier(window.theatrical, date);
      } else if (entry.type === DIGITAL || entry.type === PHYSICAL || entry.type === TV) {
        window.listed = true;
        window.home = earlier(window.home, date);
      }
    }
  }
  return window;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isPastCinemaWindow(window: ReleaseWindow, now: Date = new Date()): boolean {
  // Nothing on record: no evidence either way, so keep the film.
  if (!window.listed) return true;

  const today = toDateKey(now);
  if (window.home !== null && window.home <= today) return true;
  if (window.theatrical === null) return false;

  const cutoff = new Date(now.getTime() - CINEMA_ONLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return window.theatrical <= toDateKey(cutoff);
}
