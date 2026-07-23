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
  /** English title. Shown as the small secondary line under the native name. */
  title: string;
  /**
   * Azerbaijani (native) title, e.g. "Nəsimi". Primary display name. Absent for
   * proper-noun titles identical to English ("Ulduz") and the few films whose
   * only non-English TMDB title isn't Azerbaijani.
   */
  originalTitle?: string | null;
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
 * The name to show as the primary title: Azerbaijani when available, English
 * otherwise. Kept as a helper so cards, rails and the detail hero all agree.
 */
export function getAzClassicDisplayTitle(movie: AzClassicMovie): string {
  const native = movie.originalTitle?.trim();
  return native && native.length > 0 ? native : movie.title;
}

/**
 * Map a classic to the app's MediaItem shape so it renders in the existing poster
 * rail / grid components with zero new card UI. The string `id` (e.g. "az-001")
 * makes MediaCard suppress the rating badge automatically. `title` carries the
 * Azerbaijani name so rails read natively.
 */
export function azClassicToMediaItem(movie: AzClassicMovie): MediaItem {
  return {
    id: movie.id,
    title: getAzClassicDisplayTitle(movie),
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

/* ------------------------------------------------------------------ */
/*  In-catalog similarity (AZ classics recommend other AZ classics)   */
/* ------------------------------------------------------------------ */

const DIRECTOR_ROLE_RE = /(^|\b)(co-)?director$/i;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function getDirectorNames(movie: AzClassicMovie): Set<string> {
  const names = new Set<string>();
  for (const member of movie.crew ?? []) {
    const role = member.role ?? "";
    const isDirecting = member.department === "Directing";
    if (member.name && (DIRECTOR_ROLE_RE.test(role) || (isDirecting && /director/i.test(role)))) {
      names.add(normalizeName(member.name));
    }
  }
  return names;
}

function getCastNames(movie: AzClassicMovie, limit = 8): Set<string> {
  const names = new Set<string>();
  for (const member of (movie.cast ?? []).slice(0, limit)) {
    if (member.name) {
      names.add(normalizeName(member.name));
    }
  }
  return names;
}

function getGenreSet(movie: AzClassicMovie): Set<string> {
  return new Set((movie.genres ?? []).filter((genre) => genre && genre !== "N/A"));
}

function countShared(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) shared += 1;
  }
  return shared;
}

/**
 * Score how related two classics are. Directors are the strongest signal for
 * this era of Azerbaijani cinema (a director's films share a clear identity),
 * then shared lead cast, then genre overlap, with a small same-decade nudge.
 * Pure and deterministic so it can be unit-tested and memoized.
 */
export function scoreAzClassicSimilarity(source: AzClassicMovie, candidate: AzClassicMovie): number {
  if (source.id === candidate.id) return 0;

  let score = 0;
  score += countShared(getDirectorNames(source), getDirectorNames(candidate)) * 26;
  score += Math.min(countShared(getCastNames(source), getCastNames(candidate)), 4) * 6;
  score += countShared(getGenreSet(source), getGenreSet(candidate)) * 3;

  if (source.year && candidate.year) {
    const gap = Math.abs(source.year - candidate.year);
    if (gap <= 5) score += 4;
    else if (gap <= 12) score += 2;
  }

  return score;
}

/**
 * Up to `limit` other Azerbaijani classics most similar to the given film,
 * drawn ONLY from this catalog. Ties break toward closer release years so the
 * rail feels era-coherent. Returns [] when nothing shares any signal.
 */
export function getSimilarAzClassics(id: string, limit = 12): AzClassicMovie[] {
  const source = getAzClassicById(id);
  if (!source) return [];

  return CLASSICS.map((candidate) => ({ candidate, score: scoreAzClassicSimilarity(source, candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const yearGapA = a.candidate.year && source.year ? Math.abs(a.candidate.year - source.year) : 999;
      const yearGapB = b.candidate.year && source.year ? Math.abs(b.candidate.year - source.year) : 999;
      return yearGapA - yearGapB;
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
