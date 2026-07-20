// Azerbaijani Classics — bundled, offline catalog of classic Azerbaijani films
// played through YouTube. The data ships as a generated JSON asset
// (src/data/azClassics.json, produced by scripts/generate-az-classics.py) — there
// is NO network, Supabase, or image bundling involved. Every image is a bare TMDB
// path rendered through the app's existing getTmdbImageUrl() helper.

import type { MediaItem } from "./tmdb";
import azClassicsData from "../data/azClassics.json";

export type AzClassicCastMember = {
  name: string;
  character?: string | null;
  photoPath: string | null;
};

export type AzClassicCrewMember = {
  name: string;
  role?: string | null;
  department?: string | null;
  photoPath: string | null;
};

export type AzClassicMovie = {
  /** Stable catalog id, e.g. "az-001". Used as navigation param + list key. */
  id: string;
  title: string;
  year: number | null;
  releaseDate: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  synopsis: string | null;
  /** Bare TMDB path ("/hash.jpg") or null. Render via getTmdbImageUrl(). */
  posterPath: string | null;
  tmdbId: number | null;
  /** YouTube video id, or null when no confident match exists (Play disabled). */
  youtubeId: string | null;
  cast: AzClassicCastMember[];
  crew: AzClassicCrewMember[];
};

const CLASSICS = azClassicsData as unknown as AzClassicMovie[];

export function getAzClassics(): AzClassicMovie[] {
  return CLASSICS;
}

export function getAzClassicById(id: string): AzClassicMovie | undefined {
  return CLASSICS.find((movie) => movie.id === id);
}

/**
 * Map a classic to the app's MediaItem shape so it renders in the existing poster
 * rail / grid components with zero new card UI. The string `id` (e.g. "az-001")
 * makes MediaCard suppress the rating badge automatically.
 */
export function azClassicToMediaItem(movie: AzClassicMovie): MediaItem {
  return {
    id: movie.id,
    title: movie.title,
    posterPath: movie.posterPath,
    backdropPath: null,
    rating: 0,
    overview: movie.synopsis ?? "",
    year: movie.year ? String(movie.year) : "",
    mediaType: "movie",
  };
}

export function getAzClassicsAsMediaItems(): MediaItem[] {
  return CLASSICS.map(azClassicToMediaItem);
}
