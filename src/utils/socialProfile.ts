// Pure, UI-free helpers for the public user-profile screens. Kept out of the
// components so the follow-count optimistic transitions and the poster-hydration
// id-splitting can be unit-tested exhaustively (edge cases: non-numeric ids,
// negative/zero tmdb ids, round-tripping an optimistic follow back to baseline).

export type MediaKind = "movie" | "tv";

export type HydratableRow = {
  mediaType: MediaKind;
  tmdbId: number;
};

export type SplitIds = {
  movieIds: number[];
  seriesIds: number[];
};

/**
 * Split public-list rows into TMDB-hydratable movie / series id lists, in the
 * original order. Rows without a positive, finite tmdb_id (rare internal-id-only
 * imports) can't be resolved against TMDB, so they're dropped rather than shown
 * as permanently blank poster cards.
 */
export function splitHydratableIds(rows: readonly HydratableRow[]): SplitIds {
  const movieIds: number[] = [];
  const seriesIds: number[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.tmdbId) || row.tmdbId <= 0) continue;
    if (row.mediaType === "movie") movieIds.push(row.tmdbId);
    else seriesIds.push(row.tmdbId);
  }
  return { movieIds, seriesIds };
}

export type PublicListKind = "watched" | "watchlist" | "liked";

export type MediaCounts = {
  watchedMovies: number;
  watchedSeries: number;
  watchlistMovies: number;
  watchlistSeries: number;
  likedMovies: number;
  likedSeries: number;
};

/**
 * The accurate per-(section, media) total from the server-side profile counts,
 * so a section header shows the real number ("200 movies") without fetching a
 * single row. Missing fields count as 0.
 */
export function mediaCountFor(
  counts: Partial<MediaCounts>,
  kind: PublicListKind,
  filter: MediaKind
): number {
  if (kind === "watched") return (filter === "movie" ? counts.watchedMovies : counts.watchedSeries) ?? 0;
  if (kind === "watchlist") return (filter === "movie" ? counts.watchlistMovies : counts.watchlistSeries) ?? 0;
  return (filter === "movie" ? counts.likedMovies : counts.likedSeries) ?? 0;
}

export type FollowableProfile = {
  isFollowing: boolean;
  counts: { followers: number };
};

/**
 * The optimistic profile state to render the instant a follow/unfollow is tapped
 * (`next` = the intended isFollowing value). Followers count moves by ±1.
 */
export function optimisticFollowState<T extends FollowableProfile>(profile: T, next: boolean): T {
  return {
    ...profile,
    isFollowing: next,
    counts: { ...profile.counts, followers: profile.counts.followers + (next ? 1 : -1) },
  };
}

/**
 * The exact inverse of {@link optimisticFollowState} — applied when the RPC
 * fails so the count and button snap back to precisely where they started.
 */
export function rollbackFollowState<T extends FollowableProfile>(profile: T, next: boolean): T {
  return {
    ...profile,
    isFollowing: !next,
    counts: { ...profile.counts, followers: profile.counts.followers + (next ? -1 : 1) },
  };
}
