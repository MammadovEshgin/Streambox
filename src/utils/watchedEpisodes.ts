/**
 * Pure helpers over the watched-episode map (`{ "seriesId_season_episode": true }`).
 *
 * StreamBox keeps TWO independent records of "I watched this":
 *   - the episode map, which drives the tick marks on SeriesDetail, and
 *   - watch history, which drives the Profile watched list and Stats.
 *
 * They used to drift: ticking every episode of a season lit the season up as
 * watched on the detail screen but wrote nothing to watch history, so the same
 * season was simultaneously "watched" in one screen and absent from the other.
 * Reconciling them needs a single agreed definition of "this season is fully
 * watched", which is what lives here — kept pure so both the hook and its
 * callers can use it, and so it is testable without React.
 */

export type WatchedEpisodeMap = Record<string, boolean>;

export function buildEpisodeKey(
  seriesId: string | number,
  seasonNumber: number,
  episodeNumber: number
): string {
  return `${seriesId}_${seasonNumber}_${episodeNumber}`;
}

export function getSeasonEpisodeNumbers(episodeCount: number): number[] {
  return Array.from({ length: Math.max(0, episodeCount) }, (_, index) => index + 1);
}

/**
 * True when every episode of the season is ticked.
 *
 * A season with no known episode count is never "fully watched" — otherwise a
 * series whose episode counts haven't loaded yet would auto-log itself.
 */
export function isSeasonFullyWatched(
  state: WatchedEpisodeMap,
  seriesId: string | number,
  seasonNumber: number,
  episodeCount: number
): boolean {
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return false;

  return getSeasonEpisodeNumbers(episodeCount).every(
    (episodeNumber) => state[buildEpisodeKey(seriesId, seasonNumber, episodeNumber)] === true
  );
}

/** True when at least one episode of the season is ticked. */
export function hasAnyEpisodeWatched(
  state: WatchedEpisodeMap,
  seriesId: string | number,
  seasonNumber: number,
  episodeCount: number
): boolean {
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return false;

  return getSeasonEpisodeNumbers(episodeCount).some(
    (episodeNumber) => state[buildEpisodeKey(seriesId, seasonNumber, episodeNumber)] === true
  );
}
