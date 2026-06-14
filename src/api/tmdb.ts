import axios, { AxiosHeaders } from "axios";
import { getAlternateTmdbAuthMode, resolveTmdbAuth, TmdbAuthMode } from "./tmdbAuth";
import { getCachedOmdbRatings } from "./ratingsProxy";
import i18n from "../localization/i18n";
import { getLanguageLocale, normalizeAppLanguage, type AppLanguage } from "../localization/types";
import { shouldFetchExternalRatings, type ExternalRatingsSurface } from "../services/externalRatingsPolicy";
import { trackNetworkFailure } from "../services/telemetryService";
import { dedupeInFlight, mapWithConcurrency } from "../utils/concurrency";
import { LruMap } from "../utils/LruMap";
import {
  getImdbPopularMovies,
  getImdbTop250Movies,
  getImdbTop250Shows,
  getImdbRating,
  seedImdbRatingCache,
  type ImdbTop250Item,
} from "./imdb";

export type MediaType = "movie" | "tv";
export type CastGender = "male" | "female" | null;

type TmdbMediaRecord = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  overview: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: MediaType;
  genre_ids?: number[];
  original_language?: string;
  origin_country?: string[];
  popularity?: number;
};

type TmdbListResponse = {
  page: number;
  results: TmdbMediaRecord[];
  total_pages: number;
  total_results: number;
};

type TmdbGenre = {
  id: number;
  name: string;
};

type TmdbMovieDetailsResponse = {
  id: number;
  title: string;
  original_title: string;
  original_language: string;
  overview: string;
  runtime: number | null;
  genres: TmdbGenre[];
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  release_date: string;
  adult: boolean;
  imdb_id: string | null;
  belongs_to_collection: { id: number; name: string } | null;
};

type TmdbKeywordsResponse = {
  id: number;
  keywords: Array<{ id: number; name: string }>;
};

type TmdbTvKeywordsResponse = {
  id: number;
  results: Array<{ id: number; name: string }>;
};

type TmdbCollectionResponse = {
  id: number;
  name: string;
  parts: TmdbMediaRecord[];
};

type TmdbLocalizedFranchiseMetadataResponse = {
  title?: string;
  name?: string;
  tagline?: string | null;
};

type TmdbMovieDetailsWithCreditsResponse = {
  id: number;
  title: string;
  original_title: string;
  original_language: string;
  overview: string;
  runtime: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  release_date: string;
  adult?: boolean;
  imdb_id: string | null;
  genres: TmdbGenre[];
  belongs_to_collection?: { id: number; name: string } | null;
  credits?: {
    cast?: TmdbCastRecord[];
    crew?: TmdbCrewRecord[];
  };
  external_ids?: {
    imdb_id: string | null;
  };
};

type TmdbTvSeasonRecord = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
  episode_count: number;
  air_date: string | null;
};

type TmdbTvEpisodeRecord = {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  runtime: number | null;
  still_path: string | null;
  air_date: string | null;
  vote_average: number;
};

type TmdbTvSeasonDetailsResponse = {
  id: number;
  name: string;
  season_number: number;
  episodes: TmdbTvEpisodeRecord[];
};

type TmdbEpisodeImagesResponse = {
  id: number;
  stills: Array<{
    file_path: string | null;
  }>;
};

type TvMazeShowSearchResponse = {
  id: number;
};

type TvMazeLookupResponse = {
  id: number;
};

type TvMazeEpisodeRecord = {
  season: number;
  number: number;
  image?: {
    medium?: string;
    original?: string;
  } | null;
};

type TmdbTvDetailsWithCreditsResponse = {
  id: number;
  name: string;
  original_name: string;
  original_language: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  first_air_date: string;
  genres: TmdbGenre[];
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  seasons: TmdbTvSeasonRecord[];
  created_by?: Array<{
    id: number;
    name: string;
  }>;
  credits?: {
    cast?: TmdbCastRecord[];
    crew?: TmdbCrewRecord[];
  };
  external_ids?: {
    imdb_id: string | null;
  };
};

type TmdbExternalIdsResponse = {
  imdb_id: string | null;
};

type TmdbFindMovieRecord = {
  id: number;
  title?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  overview: string;
  release_date?: string;
};

type TmdbFindTvRecord = {
  id: number;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  overview: string;
  first_air_date?: string;
};

type TmdbFindResponse = {
  movie_results: TmdbFindMovieRecord[];
  tv_results: TmdbFindTvRecord[];
};

type TmdbPersonDetailsResponse = {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  place_of_birth: string | null;
  known_for_department: string | null;
  popularity: number;
  profile_path: string | null;
};

type TmdbPersonCreditRecord = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  overview: string;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  vote_count?: number;
  media_type?: MediaType;
  genre_ids?: number[];
  character?: string;
  job?: string;
  department?: string;
};

type TmdbCastRecord = {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
  gender?: number;
};

type TmdbCrewRecord = {
  id: number;
  name: string;
  profile_path?: string | null;
  job?: string;
  department?: string;
};

type TmdbCreditsResponse = {
  cast: TmdbCastRecord[];
  crew: TmdbCrewRecord[];
};

type TmdbPersonCombinedCreditsResponse = {
  cast: TmdbPersonCreditRecord[];
  crew?: TmdbPersonCreditRecord[];
};

type TmdbPersonSearchRecord = {
  id: number;
  name: string;
  known_for_department?: string | null;
  popularity?: number;
};

type TmdbPersonSearchResponse = {
  page: number;
  results: TmdbPersonSearchRecord[];
  total_pages: number;
  total_results: number;
};

export type MediaItem = {
  id: number | string;
  title: string;
  originalTitle?: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number;
  overview: string;
  year: string;
  mediaType: MediaType;
  imdbId?: string | null;
  rank?: number;
  genreIds?: number[];
};

export type CastMember = {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
  gender: CastGender;
};

export type DirectorMember = {
  id: number;
  name: string;
  profilePath: string | null;
};

export type CrewMember = {
  id: number;
  name: string;
  job: string;
  department: string;
  profilePath: string | null;
};

export type MovieDetails = {
  id: number;
  title: string;
  originalTitle?: string;
  overview: string;
  runtimeMinutes: number | null;
  genres: string[];
  genreIds: number[];
  ageRating: string;
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  voteCount: number;
  releaseDate: string;
  imdbId: string | null;
  collectionId: number | null;
  cast: CastMember[];
  directors: DirectorMember[];
  crew: CrewMember[];
};

export type SeriesSeason = {
  id: number;
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate: string | null;
  posterPath: string | null;
};

export type SeriesEpisode = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string;
  runtimeMinutes: number | null;
  stillPath: string | null;
  airDate: string | null;
  voteAverage: number;
};

export type SeriesDetails = {
  id: number;
  title: string;
  originalTitle?: string;
  overview: string;
  genres: string[];
  genreIds: number[];
  posterPath: string | null;
  backdropPath: string | null;
  voteAverage: number;
  voteCount: number;
  firstAirDate: string;
  imdbId: string | null;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  episodeRuntimeMinutes: number | null;
  seasons: SeriesSeason[];
  cast: CastMember[];
  directors: DirectorMember[];
  crew: CrewMember[];
};

export type ExternalRatings = {
  imdb: string | null;
  rottenTomatoes: string | null;
  metacritic: string | null;
  letterboxd: string | null;
};

export type SeriesExternalRatings = Omit<ExternalRatings, "letterboxd">;

export type PersonDetails = {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  placeOfBirth: string | null;
  knownForDepartment: string | null;
  popularity: number;
  profilePath: string | null;
  knownForMovies: MediaItem[];
};

export type PaginatedMediaResponse = {
  items: MediaItem[];
  page: number;
  totalPages: number;
};

export type MovieTasteProfile = {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number;
  popularity: number;
  releaseYear: number | null;
  genreIds: number[];
  castIds: number[];
  directorIds: number[];
  imdbId: string | null;
};

export type DiscoverCollectionSource =
  | "trending_movies"
  | "trending_series"
  | "top_new_movies"
  | "imdb_top_250"
  | "top_new_series"
  | "imdb_top_250_series";

type TmdbImageSize = "w185" | "w300" | "w342" | "w500" | "w780" | "original";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

const tmdbProxyBaseUrl = process.env.EXPO_PUBLIC_TMDB_PROXY_BASE_URL?.trim() || null;
const usesTmdbProxy = Boolean(tmdbProxyBaseUrl);
const tmdbApiKey = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const tmdbAccessToken = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN;
const tmdbAuth = resolveTmdbAuth(tmdbApiKey, tmdbAccessToken);


// In-memory caches are bounded with LruMap so a long browsing session can't grow
// memory without limit. Caps are sized to value weight: tiny string/id/rating
// entries get large caps; heavy detail/summary/list objects get smaller caps.
// LruMap is a Map subclass, so get/set/has/null-negative-caching all behave as before.
const CACHE_MAX = {
  /** Tiny string-or-null entries — cheap to keep many. */
  id: 2000,
  /** Small rating/find records. */
  rating: 1500,
  /** Episode image maps and misc medium entries. */
  medium: 800,
  /** Heavy MediaItem summaries and detail objects. */
  detail: 500,
  /** Arrays of MediaItem (similar/quick-similar lists). */
  list: 300
} as const;

const imdbIdCache = new LruMap<string, string | null>(CACHE_MAX.id);
const omdbRatingsCache = new LruMap<string, Pick<ExternalRatings, "imdb" | "rottenTomatoes" | "metacritic">>(CACHE_MAX.rating);
const letterboxdCache = new LruMap<string, string | null>(CACHE_MAX.id);
const imdbToTmdbMovieCache = new LruMap<string, TmdbFindMovieRecord | null>(CACHE_MAX.rating);
const imdbToTmdbTvCache = new LruMap<string, TmdbFindTvRecord | null>(CACHE_MAX.rating);
const tvMazeEpisodeImageCache = new LruMap<string, Record<string, string>>(CACHE_MAX.medium);
const tmdbEpisodeImageCache = new LruMap<string, string | null>(CACHE_MAX.medium);
const trailerUrlCache = new LruMap<string, string | null>(CACHE_MAX.id);
const movieSummaryCache = new LruMap<string, MediaItem>(CACHE_MAX.detail);
const seriesSummaryCache = new LruMap<string, MediaItem>(CACHE_MAX.detail);
const movieDetailsCache = new LruMap<string, MovieDetails>(CACHE_MAX.detail);
const seriesDetailsCache = new LruMap<string, SeriesDetails>(CACHE_MAX.detail);
const movieExternalRatingsCache = new LruMap<string, ExternalRatings>(CACHE_MAX.rating);
const seriesExternalRatingsCache = new LruMap<string, SeriesExternalRatings>(CACHE_MAX.rating);
const quickSimilarMoviesCache = new LruMap<string, MediaItem[]>(CACHE_MAX.list);
const quickSimilarSeriesCache = new LruMap<string, MediaItem[]>(CACHE_MAX.list);
const similarMoviesCache = new LruMap<string, MediaItem[]>(CACHE_MAX.list);
const similarSeriesCache = new LruMap<string, MediaItem[]>(CACHE_MAX.list);

const inFlightMovieDetails = new Map<string, Promise<MovieDetails>>();
const inFlightSeriesDetails = new Map<string, Promise<SeriesDetails>>();
const LIST_ENRICHMENT_CONCURRENCY = 4;
const IMDB_TOP250_RESOLVE_CONCURRENCY = 6;
const IMDB_POPULAR_SPOTLIGHT_RESOLVE_LIMIT = 36;
const MIN_IMDB_POPULAR_SPOTLIGHT_ITEMS = 6;

function getLocalizedTmdbCacheKey(scope: string, id: string | number) {
  return `${getTmdbRequestLanguage()}:${scope}:${id}`;
}

const tmdbClient = axios.create({
  baseURL: tmdbProxyBaseUrl ?? TMDB_BASE_URL,
  timeout: 12000
});

function getTmdbRequestLanguage() {
  return getLanguageLocale(normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language));
}

function shouldAttachTmdbLanguage(url?: string | null) {
  if (!url) {
    return true;
  }

  return !url.includes("/images") && !url.includes("/external_ids") && !url.includes("/videos");
}

function applyTmdbAuthToConfig(config: any, mode: TmdbAuthMode) {
  const nextConfig = { ...config };
  nextConfig.params = { ...(config.params ?? {}) };

  const headers = AxiosHeaders.from(config.headers);
  headers.delete("Authorization");
  delete nextConfig.params.api_key;

  if (usesTmdbProxy) {
    headers.set("X-StreamBox-Proxy-Target", "tmdb");
  } else if (mode === "api_key" && tmdbAuth.apiKeyParam) {
    nextConfig.params.api_key = tmdbAuth.apiKeyParam;
  } else if (mode === "bearer" && tmdbAuth.bearerToken) {
    headers.set("Authorization", `Bearer ${tmdbAuth.bearerToken}`);
  }

  if (!nextConfig.params.language && shouldAttachTmdbLanguage(config.url)) {
    nextConfig.params.language = getTmdbRequestLanguage();
  }

  nextConfig.headers = headers;
  nextConfig._tmdbAuthMode = mode;
  nextConfig._requestStartedAt = config._requestStartedAt ?? Date.now();
  return nextConfig;
}

function getTelemetryEndpoint(config: any) {
  const rawUrl = String(config?.url ?? "");
  if (!rawUrl) {
    return "unknown";
  }

  try {
    const parsed = rawUrl.startsWith("http") ? new URL(rawUrl) : new URL(rawUrl, "https://streambox.local");
    return parsed.pathname;
  } catch {
    return rawUrl.split("?")[0].slice(0, 120);
  }
}

tmdbClient.interceptors.request.use((config) => {
  const requestedMode = (config as any)._tmdbAuthMode as TmdbAuthMode | undefined;
  const mode = requestedMode ?? tmdbAuth.mode;
  return applyTmdbAuthToConfig(config, mode);
});

// Transient errors worth retrying with backoff: rate limits, server errors, and
// network failures (no HTTP status — timeout / connection reset). Other 4xx are
// deterministic and must NOT be retried.
const TMDB_MAX_TRANSIENT_RETRIES = 2;
const TMDB_RETRY_BACKOFF_MS = [200, 600];

function isTransientTmdbError(status: number | undefined): boolean {
  return status === 429 || status === undefined || (typeof status === "number" && status >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

tmdbClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as any;
    if (status === 429 || status >= 500 || !status) {
      trackNetworkFailure("tmdb", {
        status: status ?? null,
        endpoint: getTelemetryEndpoint(config),
        usesProxy: usesTmdbProxy,
        durationMs: config?._requestStartedAt ? Date.now() - config._requestStartedAt : null,
        rateLimitRemaining: error?.response?.headers?.["x-ratelimit-remaining"] ?? null,
      }, status === 429 ? "error" : "warning");
    }

    // Retry transient failures with bounded exponential-ish backoff. Applies to
    // both proxy and direct modes; deterministic 4xx (except 429) fall through.
    if (config && isTransientTmdbError(status)) {
      const attempt = (config._tmdbTransientRetryCount as number | undefined) ?? 0;
      if (attempt < TMDB_MAX_TRANSIENT_RETRIES) {
        config._tmdbTransientRetryCount = attempt + 1;
        await sleep(TMDB_RETRY_BACKOFF_MS[attempt] ?? TMDB_RETRY_BACKOFF_MS[TMDB_RETRY_BACKOFF_MS.length - 1]);
        return tmdbClient.request(config);
      }
    }

    if (usesTmdbProxy) {
      return Promise.reject(error);
    }

    if (status !== 401 || !config || config._tmdbRetried) {
      return Promise.reject(error);
    }

    const currentMode = (config._tmdbAuthMode as TmdbAuthMode | undefined) ?? tmdbAuth.mode;
    const alternateMode = getAlternateTmdbAuthMode(currentMode, tmdbAuth);
    if (!alternateMode) {
      return Promise.reject(error);
    }

    config._tmdbRetried = true;
    const retriedConfig = applyTmdbAuthToConfig(config, alternateMode);
    return tmdbClient.request(retriedConfig);
  }
);

function assertCredentials() {
  if (!usesTmdbProxy && tmdbAuth.mode === "none") {
    throw new Error(
      "Missing TMDB credentials. Set EXPO_PUBLIC_TMDB_PROXY_BASE_URL, EXPO_PUBLIC_TMDB_API_KEY, or EXPO_PUBLIC_TMDB_ACCESS_TOKEN."
    );
  }
}

function pickYear(item: TmdbMediaRecord): string {
  const rawDate = item.release_date ?? item.first_air_date;
  if (!rawDate) {
    return "----";
  }

  return rawDate.split("-")[0] ?? "----";
}

function normalizeMedia(item: TmdbMediaRecord, fallbackType: MediaType): MediaItem {
  const title = item.title ?? item.name ?? "Untitled";
  const rawOriginal = item.original_title ?? item.original_name;
  return {
    id: item.id,
    title,
    originalTitle: (rawOriginal && rawOriginal !== title) ? rawOriginal : undefined,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: Number.isFinite(item.vote_average) ? item.vote_average : 0,
    overview: item.overview ?? "",
    year: pickYear(item),
    mediaType: item.media_type ?? fallbackType,
    genreIds: item.genre_ids ?? []
  };
}

/**
 * Global quality gate â€” rejects items that would look bad in the UI:
 *  - No poster image
 *  - Rating exactly 0 (no votes / unreleased)
 *  - Missing title
 */
function isQualityItem(item: MediaItem): boolean {
  if (!item.posterPath) return false;
  if (item.rating <= 0) return false;
  if (item.title === "Untitled") return false;
  return true;
}

const ALLOWED_TRENDING_LANGUAGES = new Set([
  "en", "fr", "de", "it", "es", "pt", "nl", "sv", "no", "da", "fi", "is",
  "pl", "cs", "sk", "hu", "ro", "bg", "hr", "sr", "sl", "et", "lv", "lt",
  "el", "uk"
]);

const ALLOWED_TRENDING_TV_COUNTRIES = new Set([
  "US", "GB", "IE", "FR", "DE", "IT", "ES", "PT", "NL", "BE", "LU", "CH", "AT",
  "DK", "SE", "NO", "FI", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "HR", "RS",
  "SI", "EE", "LV", "LT", "GR", "UA", "MT", "CY"
]);

function isAllowedForTrendingFeedRecord(record: TmdbMediaRecord, fallbackType: MediaType): boolean {
  const mediaType = record.media_type ?? fallbackType;

  if (mediaType === "tv" && record.genre_ids?.includes(16)) {
    return false;
  }

  const originalLanguage = (record.original_language ?? "").toLowerCase();
  if (!ALLOWED_TRENDING_LANGUAGES.has(originalLanguage)) {
    return false;
  }

  if (mediaType === "tv" && Array.isArray(record.origin_country) && record.origin_country.length > 0) {
    return record.origin_country.some((country) => ALLOWED_TRENDING_TV_COUNTRIES.has(country));
  }

  return true;
}

function mapList(response: TmdbListResponse, fallbackType: MediaType): MediaItem[] {
  return response.results
    .map((entry) => normalizeMedia(entry, fallbackType))
    .filter(isQualityItem);
}

function normalizeCastMember(item: TmdbCastRecord): CastMember {
  return {
    id: item.id,
    name: item.name,
    character: item.character,
    profilePath: item.profile_path,
    gender: item.gender === 2 ? "male" : item.gender === 1 ? "female" : null
  };
}

function pickDirectorMembers(crew: TmdbCrewRecord[] = []): DirectorMember[] {
  return crew
    .filter((entry) => entry.job === "Director" || entry.department === "Directing")
    .slice(0, 5)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      profilePath: entry.profile_path ?? null
    }));
}

function pickKeyCrewMembers(crew: TmdbCrewRecord[] = []): CrewMember[] {
  const keyJobs = new Set([
    "Director",
    "Writer",
    "Screenplay",
    "Producer",
    "Executive Producer",
    "Director of Photography",
    "Original Music Composer"
  ]);

  const seenIds = new Set<number>();
  const result: CrewMember[] = [];

  for (const entry of crew) {
    if (entry.job && keyJobs.has(entry.job) && !seenIds.has(entry.id)) {
      seenIds.add(entry.id);
      result.push({
        id: entry.id,
        name: entry.name,
        job: entry.job,
        department: entry.department ?? "",
        profilePath: entry.profile_path ?? null
      });

      if (result.length >= 15) {
        break;
      }
    }
  }

  return result;
}

function normalizeSeriesSeason(item: TmdbTvSeasonRecord): SeriesSeason {
  return {
    id: item.id,
    seasonNumber: item.season_number,
    name: item.name,
    episodeCount: item.episode_count,
    airDate: item.air_date,
    posterPath: item.poster_path
  };
}

function normalizeSeriesEpisode(item: TmdbTvEpisodeRecord): SeriesEpisode {
  return {
    id: item.id,
    seasonNumber: item.season_number,
    episodeNumber: item.episode_number,
    name: item.name,
    overview: item.overview ?? "",
    runtimeMinutes: item.runtime,
    stillPath: item.still_path,
    airDate: item.air_date,
    voteAverage: Number.isFinite(item.vote_average) ? item.vote_average : 0
  };
}

function toEpisodeImageKey(seasonNumber: number, episodeNumber: number): string {
  return `${seasonNumber}:${episodeNumber}`;
}

function normalizePersonCredit(item: TmdbPersonCreditRecord): MediaItem | null {
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const title = item.title ?? item.name ?? "Untitled";

  if (!item.id || title === "Untitled") {
    return null;
  }

  const releaseDate = item.release_date ?? item.first_air_date;
  const rawOriginal = item.original_title ?? item.original_name;

  return {
    id: item.id,
    title,
    originalTitle: rawOriginal && rawOriginal !== title ? rawOriginal : undefined,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: Number.isFinite(item.vote_average) ? item.vote_average : 0,
    overview: item.overview ?? "",
    year: releaseDate ? releaseDate.split("-")[0] ?? "----" : "----",
    mediaType,
    genreIds: item.genre_ids ?? []
  };
}

const DOCUMENTARY_GENRE_ID = 99;
const TV_NEWS_GENRE_ID = 10763;
const TV_REALITY_GENRE_ID = 10764;
const TV_TALK_GENRE_ID = 10767;

function isSelfPersonCredit(record: TmdbPersonCreditRecord) {
  return /\bself\b|himself|herself|themselves|as self/i.test(record.character ?? "");
}

function isVoicePersonCredit(record: TmdbPersonCreditRecord) {
  return /\bvoice\b|voice role|voix/i.test(record.character ?? "");
}

function isLowValuePersonCredit(record: TmdbPersonCreditRecord) {
  const genreIds = record.genre_ids ?? [];
  return (
    genreIds.includes(DOCUMENTARY_GENRE_ID) ||
    genreIds.includes(TV_NEWS_GENRE_ID) ||
    genreIds.includes(TV_REALITY_GENRE_ID) ||
    genreIds.includes(TV_TALK_GENRE_ID)
  );
}

function scorePersonCreditForSearch(record: TmdbPersonCreditRecord, item: MediaItem) {
  const popularity = Math.min(record.popularity ?? 0, 120);
  const rating = Number.isFinite(item.rating) ? item.rating : 0;
  const voteCount = Math.max(record.vote_count ?? 0, 0);
  const voteSignal = Math.min(Math.log10(voteCount + 1) * 18, 70);
  const year = Number.parseInt(item.year, 10);
  const recencySignal = Number.isFinite(year) ? Math.max(Math.min((year - 1980) / 4, 12), -8) : 0;

  let score = popularity + rating * 10 + voteSignal + recencySignal;

  if (item.mediaType === "movie") score += 90;
  if (item.mediaType === "tv") score -= 30;
  if (isVoicePersonCredit(record)) score -= 70;
  if (isLowValuePersonCredit(record)) score -= 180;
  if (isSelfPersonCredit(record)) score -= 260;

  return score;
}

function normalizePersonCredits(records: TmdbPersonCreditRecord[], options: { requirePoster?: boolean } = {}): MediaItem[] {
  const byKey = new Map<string, MediaItem & { popularity?: number; relevanceScore?: number }>();

  records.forEach((record) => {
    const item = normalizePersonCredit(record);
    if (!item) {
      return;
    }

    if (options.requirePoster && !item.posterPath) {
      return;
    }

    const key = `${item.mediaType}-${item.id}`;
    const existing = byKey.get(key);
    const relevanceScore = scorePersonCreditForSearch(record, item);
    if (!existing || relevanceScore > (existing.relevanceScore ?? Number.NEGATIVE_INFINITY)) {
      byKey.set(key, { ...item, popularity: record.popularity ?? 0, relevanceScore });
    }
  });

  return Array.from(byKey.values())
    .sort((left, right) => {
      if ((left.relevanceScore ?? 0) !== (right.relevanceScore ?? 0)) {
        return (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);
      }
      const leftYear = Number.parseInt(left.year, 10);
      const rightYear = Number.parseInt(right.year, 10);
      if (Number.isFinite(leftYear) && Number.isFinite(rightYear) && leftYear !== rightYear) {
        return rightYear - leftYear;
      }
      return (right.popularity ?? 0) - (left.popularity ?? 0);
    })
    .map(({ popularity: _popularity, relevanceScore: _relevanceScore, ...item }) => item);
}

function parseReleaseYear(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const year = Number.parseInt(value.split("-")[0] ?? "", 10);
  if (!Number.isFinite(year)) {
    return null;
  }

  return year;
}

function parseScaledRating(value: string | null, scale: 10 | 5): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*[0-9]+/);
  if (!match?.[1]) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (scale === 10) {
    return numeric;
  }

  return numeric;
}

function toTmdbDateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getTopNewWindowStart(now: Date = new Date()): Date {
  const value = new Date(now);
  value.setMonth(now.getMonth() - 9);
  return value;
}

function parseLetterboxdScore(html: string): string | null {
  const twitterMatch = html.match(/twitter:data2"\s+content="([^"]+)"/i);
  if (twitterMatch?.[1]) {
    const value = twitterMatch[1].trim();
    const outOfFive = value.match(/([0-9.]+)\s*out of 5/i);
    if (outOfFive?.[1]) {
      return `${outOfFive[1]}/5`;
    }
  }

  const averageMatch = html.match(/Average rating[^0-9]*([0-9.]+)\s*out of 5/i);
  if (averageMatch?.[1]) {
    return `${averageMatch[1]}/5`;
  }

  return null;
}

async function getImdbId(movieId: string, seededImdbId?: string | null): Promise<string | null> {
  return getImdbIdForMedia("movie", movieId, seededImdbId);
}

function toImdbCacheKey(mediaType: MediaType, mediaId: string): string {
  return `${mediaType}:${mediaId}`;
}

async function getImdbIdForMedia(
  mediaType: MediaType,
  mediaId: string,
  seededImdbId?: string | null
): Promise<string | null> {
  const cacheKey = toImdbCacheKey(mediaType, mediaId);

  if (seededImdbId) {
    imdbIdCache.set(cacheKey, seededImdbId);
    return seededImdbId;
  }

  if (imdbIdCache.has(cacheKey)) {
    return imdbIdCache.get(cacheKey) ?? null;
  }

  const { data } = await tmdbClient.get<TmdbExternalIdsResponse>(`/${mediaType}/${mediaId}/external_ids`);
  const imdbId = data.imdb_id ?? null;
  imdbIdCache.set(cacheKey, imdbId);
  return imdbId;
}

async function findTmdbMovieByImdbId(imdbId: string): Promise<TmdbFindMovieRecord | null> {
  if (imdbToTmdbMovieCache.has(imdbId)) {
    return imdbToTmdbMovieCache.get(imdbId) ?? null;
  }

  const { data } = await tmdbClient.get<TmdbFindResponse>(`/find/${imdbId}`, {
    params: {
      external_source: "imdb_id"
    }
  });

  const found = data.movie_results[0] ?? null;
  imdbToTmdbMovieCache.set(imdbId, found);
  return found;
}

async function findTmdbTvByImdbId(imdbId: string): Promise<TmdbFindTvRecord | null> {
  if (imdbToTmdbTvCache.has(imdbId)) {
    return imdbToTmdbTvCache.get(imdbId) ?? null;
  }

  const { data } = await tmdbClient.get<TmdbFindResponse>(`/find/${imdbId}`, {
    params: {
      external_source: "imdb_id"
    }
  });

  const found = data.tv_results[0] ?? null;
  imdbToTmdbTvCache.set(imdbId, found);
  return found;
}

export async function resolveTmdbMovieIdFromImdbId(imdbId: string): Promise<string | null> {
  assertCredentials();
  const found = await findTmdbMovieByImdbId(imdbId);
  if (!found) {
    return null;
  }

  return String(found.id);
}

export async function resolveTmdbTvIdFromImdbId(imdbId: string): Promise<string | null> {
  assertCredentials();
  const found = await findTmdbTvByImdbId(imdbId);
  if (!found) {
    return null;
  }

  return String(found.id);
}

async function getOmdbRatings(
  imdbId: string,
  surface: ExternalRatingsSurface = "detail"
): Promise<Pick<ExternalRatings, "imdb" | "rottenTomatoes" | "metacritic">> {
  const empty = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null
  };

  if (!shouldFetchExternalRatings(surface)) {
    return empty;
  }

  if (omdbRatingsCache.has(imdbId)) {
    return omdbRatingsCache.get(imdbId)!;
  }

  const cachedRatings = await getCachedOmdbRatings(imdbId);
  if (cachedRatings) {
    omdbRatingsCache.set(imdbId, cachedRatings);
    return cachedRatings;
  }

  return empty;
}

async function getLetterboxdRating(imdbId: string): Promise<string | null> {
  if (letterboxdCache.has(imdbId)) {
    return letterboxdCache.get(imdbId) ?? null;
  }

  try {
    const { data } = await axios.get<string>(`https://letterboxd.com/imdb/${imdbId}/`, {
      timeout: 10000,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    });

    const score = parseLetterboxdScore(data);
    letterboxdCache.set(imdbId, score);
    return score;
  } catch {
    letterboxdCache.set(imdbId, null);
    return null;
  }
}

export function getTmdbImageUrl(path: string | null, size: TmdbImageSize = "w500"): string | null {
  if (!path) {
    return null;
  }

  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) || path.startsWith("data:")) {
    return path;
  }

  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

export const GENRE_ID_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

export async function getMovieLogos(id: number): Promise<string | null> {
  try {
    const { data } = await tmdbClient.get<{ logos: Array<{ file_path: string; iso_639_1: string | null }> }>(
      `/movie/${id}/images`
    );
    const logo = data.logos?.find((l) => l.iso_639_1 === "en") ?? data.logos?.[0];
    return logo ? logo.file_path : null;
  } catch {
    return null;
  }
}

export async function getSeriesLogos(id: number): Promise<string | null> {
  try {
    const { data } = await tmdbClient.get<{ logos: Array<{ file_path: string; iso_639_1: string | null }> }>(
      `/tv/${id}/images`
    );
    const logo = data.logos?.find((l) => l.iso_639_1 === "en") ?? data.logos?.[0];
    return logo ? logo.file_path : null;
  } catch {
    return null;
  }
}

async function enrichItemsWithImdbRatings(items: MediaItem[]): Promise<MediaItem[]> {
  if (!shouldFetchExternalRatings("list")) {
    return items;
  }

  return mapWithConcurrency(items, LIST_ENRICHMENT_CONCURRENCY, async (item) => {
    try {
      const mediaType = item.mediaType;
      const imdbId = await getImdbIdForMedia(mediaType, String(item.id));
      if (!imdbId) return item;

      const imdbRating = await getImdbRating(imdbId);
      if (imdbRating !== null && imdbRating > 0) {
        return { ...item, rating: imdbRating, imdbId };
      }

      return { ...item, imdbId };
    } catch {
      return item;
    }
  });
}

export async function getTrending(type: MediaType): Promise<MediaItem[]> {
  const response = await getTrendingPage(type, 1);
  return response.items;
}

export async function getTrendingPage(type: MediaType, page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();
  const { data } = await tmdbClient.get<TmdbListResponse>(`/trending/${type}/week`, {
    params: {
      page
    }
  });
  const items = await enrichItemsWithImdbRatings(
    data.results
      .filter((record) => isAllowedForTrendingFeedRecord(record, type))
      .map((record) => normalizeMedia(record, type))
      .filter(isQualityItem)
  );
  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

export async function discoverMoviesForTaste(
  page: number,
  options: {
    genreIds?: number[];
    minYear?: number;
  } = {}
): Promise<PaginatedMediaResponse> {
  assertCredentials();

  const { data } = await tmdbClient.get<TmdbListResponse>("/discover/movie", {
    params: {
      page,
      include_adult: false,
      include_video: false,
      sort_by: "vote_average.desc",
      "vote_count.gte": 150,
      ...(options.genreIds && options.genreIds.length > 0 ? { with_genres: options.genreIds.join(",") } : {}),
      ...(options.minYear ? { "primary_release_date.gte": `${options.minYear}-01-01` } : {})
    }
  });

  const items = await enrichItemsWithImdbRatings(mapList(data, "movie"));
  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

export async function getMovieTasteProfile(id: number | string): Promise<MovieTasteProfile | null> {
  assertCredentials();

  try {
    const { data } = await tmdbClient.get<TmdbMovieDetailsWithCreditsResponse>(`/movie/${id}`, {
      params: {
        append_to_response: "credits,external_ids"
      }
    });

    const cast = (data.credits?.cast ?? [])
      .slice()
      .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
      .slice(0, 10)
      .map((entry) => entry.id);

    const directors = (data.credits?.crew ?? [])
      .filter((entry) => entry.job === "Director" || entry.department === "Directing")
      .slice(0, 3)
      .map((entry) => entry.id);

    return {
      id: data.id,
      title: data.title,
      overview: data.overview ?? "",
      posterPath: data.poster_path,
      backdropPath: data.backdrop_path,
      rating: Number.isFinite(data.vote_average) ? data.vote_average : 0,
      popularity: Number.isFinite(data.popularity) ? data.popularity : 0,
      releaseYear: parseReleaseYear(data.release_date),
      genreIds: data.genres.map((entry) => entry.id),
      castIds: cast,
      directorIds: directors,
      imdbId: data.external_ids?.imdb_id ?? null
    };
  } catch {
    return null;
  }
}

async function passesTopNewThreshold(movieId: string, tmdbRating?: number): Promise<boolean> {
  const passesTmdbBaseline = tmdbRating !== undefined && tmdbRating > 6.5;
  if (!shouldFetchExternalRatings("list")) {
    return passesTmdbBaseline;
  }

  try {
    const imdbId = await getImdbId(movieId);
    if (!imdbId) {
      return passesTmdbBaseline;
    }

    const omdbRatings = await getOmdbRatings(imdbId, "list");
    const imdbScore = parseScaledRating(omdbRatings.imdb, 10);
    if (imdbScore !== null && imdbScore > 6.5) {
      return true;
    }

    const letterboxdRaw = await getLetterboxdRating(imdbId);
    const letterboxdScore = parseScaledRating(letterboxdRaw, 5);
    if (letterboxdScore !== null && letterboxdScore > 3) {
      return true;
    }

    return passesTmdbBaseline;
  } catch {
    return passesTmdbBaseline;
  }
}

async function passesTopNewSeriesThreshold(seriesId: string, tmdbRating?: number): Promise<boolean> {
  const passesTmdbBaseline = tmdbRating !== undefined && tmdbRating >= 7;
  if (!shouldFetchExternalRatings("list")) {
    return passesTmdbBaseline;
  }

  try {
    const imdbId = await getImdbIdForMedia("tv", seriesId);
    if (!imdbId) {
      return passesTmdbBaseline;
    }

    const omdbRatings = await getOmdbRatings(imdbId, "list");
    const imdbScore = parseScaledRating(omdbRatings.imdb, 10);
    if (imdbScore !== null) {
      return imdbScore >= 7;
    }

    return passesTmdbBaseline;
  } catch {
    return passesTmdbBaseline;
  }
}

export async function getTopNewMoviesPage(page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();
  const now = new Date();
  const windowStart = getTopNewWindowStart(now);

  const { data } = await tmdbClient.get<TmdbListResponse>("/discover/movie", {
    params: {
      page,
      include_adult: false,
      sort_by: "primary_release_date.desc",
      "primary_release_date.gte": toTmdbDateValue(windowStart),
      "primary_release_date.lte": toTmdbDateValue(now),
      "vote_count.gte": 50
    }
  });

  const candidates = data.results
    .filter((record) => isAllowedForTrendingFeedRecord(record, "movie"))
    .map((record) => normalizeMedia(record, "movie"))
    .filter(isQualityItem);
  const verdicts = await mapWithConcurrency(
    candidates,
    LIST_ENRICHMENT_CONCURRENCY,
    async (item) => {
      const isQualified = await passesTopNewThreshold(String(item.id), item.rating);
      return isQualified ? item : null;
    }
  );

  const filtered = verdicts.filter((item): item is MediaItem => item !== null);
  const items = await enrichItemsWithImdbRatings(filtered);
  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

export async function getTopNewSeriesPage(page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();
  const now = new Date();
  const windowStart = getTopNewWindowStart(now);

  const { data } = await tmdbClient.get<TmdbListResponse>("/discover/tv", {
    params: {
      page,
      include_adult: false,
      sort_by: "first_air_date.desc",
      "first_air_date.gte": toTmdbDateValue(windowStart),
      "first_air_date.lte": toTmdbDateValue(now),
      "vote_count.gte": 50
    }
  });

  const candidates = data.results
    .filter((record) => isAllowedForTrendingFeedRecord(record, "tv"))
    .map((record) => normalizeMedia(record, "tv"))
    .filter(isQualityItem);
  const verdicts = await mapWithConcurrency(
    candidates,
    LIST_ENRICHMENT_CONCURRENCY,
    async (item) => {
      const isQualified = await passesTopNewSeriesThreshold(String(item.id), item.rating);
      return isQualified ? item : null;
    }
  );

  const filtered = verdicts.filter((item): item is MediaItem => item !== null);
  const items = await enrichItemsWithImdbRatings(filtered);
  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

async function resolveImdbEntryToMediaItem(
  entry: ImdbTop250Item,
  mediaType: "movie" | "tv",
): Promise<MediaItem | null> {
  try {
    seedImdbRatingCache(entry.imdbId, entry.imdbRating);

    if (mediaType === "movie") {
      const found = await findTmdbMovieByImdbId(entry.imdbId);
      if (!found) return null;

      imdbIdCache.set(toImdbCacheKey("movie", String(found.id)), entry.imdbId);

      return {
        id: found.id,
        title: found.title ?? entry.title,
        posterPath: found.poster_path,
        backdropPath: found.backdrop_path,
        rating: entry.imdbRating > 0 ? entry.imdbRating : found.vote_average,
        overview: found.overview ?? "",
        year: found.release_date ? found.release_date.split("-")[0] ?? "----" : "----",
        mediaType: "movie",
        imdbId: entry.imdbId,
        rank: entry.rank,
      };
    }

    const found = await findTmdbTvByImdbId(entry.imdbId);
    if (!found) return null;

    imdbIdCache.set(toImdbCacheKey("tv", String(found.id)), entry.imdbId);

    return {
      id: found.id,
      title: found.name ?? entry.title,
      posterPath: found.poster_path,
      backdropPath: found.backdrop_path,
      rating: entry.imdbRating > 0 ? entry.imdbRating : found.vote_average,
      overview: found.overview ?? "",
      year: found.first_air_date ? found.first_air_date.split("-")[0] ?? "----" : "----",
      mediaType: "tv",
      imdbId: entry.imdbId,
      rank: entry.rank,
    };
  } catch {
    return null;
  }
}

export async function getImdbTop250Page(page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();

  const allItems = await getImdbTop250Movies();
  if (allItems.length === 0) {
    return { items: [], page, totalPages: 1 };
  }

  const pageSize = 20;
  const totalPages = Math.ceil(allItems.length / pageSize);
  const start = (page - 1) * pageSize;
  const slice = allItems.slice(start, start + pageSize);

  const resolved = await mapWithConcurrency(
    slice,
    IMDB_TOP250_RESOLVE_CONCURRENCY,
    async (entry) => resolveImdbEntryToMediaItem(entry, "movie"),
  );

  return {
    items: resolved.filter((item): item is MediaItem => item !== null),
    page,
    totalPages,
  };
}

export async function getImdbTop250SeriesPage(page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();

  const allItems = await getImdbTop250Shows();
  if (allItems.length === 0) {
    return { items: [], page, totalPages: 1 };
  }

  const pageSize = 20;
  const totalPages = Math.ceil(allItems.length / pageSize);
  const start = (page - 1) * pageSize;
  const slice = allItems.slice(start, start + pageSize);

  const resolved = await mapWithConcurrency(
    slice,
    IMDB_TOP250_RESOLVE_CONCURRENCY,
    async (entry) => resolveImdbEntryToMediaItem(entry, "tv"),
  );

  return {
    items: resolved.filter((item): item is MediaItem => item !== null),
    page,
    totalPages,
  };
}

export async function getSeriesOfTheDay(): Promise<MediaItem | null> {
  const trending = await getTrendingPage("tv", 1);
  if (trending.items.length === 0) {
    return null;
  }

  const now = new Date();
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return trending.items[seed % trending.items.length] ?? trending.items[0] ?? null;
}

export async function getDiscoverCollectionPage(
  source: DiscoverCollectionSource,
  page: number
): Promise<PaginatedMediaResponse> {
  switch (source) {
    case "trending_movies":
      return getTrendingPage("movie", page);
    case "trending_series":
      return getTrendingPage("tv", page);
    case "top_new_movies":
      return getTopNewMoviesPage(page);
    case "imdb_top_250":
      return getImdbTop250Page(page);
    case "top_new_series":
      return getTopNewSeriesPage(page);
    case "imdb_top_250_series":
      return getImdbTop250SeriesPage(page);
    default:
      return getTrendingPage("movie", page);
  }
}

export async function getPopular(): Promise<MediaItem[]> {
  assertCredentials();
  try {
    const imdbPopular = await getImdbPopularMovies();
    const resolved = await mapWithConcurrency(
      imdbPopular.slice(0, IMDB_POPULAR_SPOTLIGHT_RESOLVE_LIMIT),
      IMDB_TOP250_RESOLVE_CONCURRENCY,
      async (entry) => resolveImdbEntryToMediaItem(entry, "movie"),
    );
    const imdbItems = resolved
      .filter((item): item is MediaItem => item !== null)
      .filter(isQualityItem)
      .filter((item) => item.backdropPath);

    if (imdbItems.length >= MIN_IMDB_POPULAR_SPOTLIGHT_ITEMS) {
      return imdbItems;
    }
  } catch {
    // Keep the hero resilient if IMDb blocks or changes its chart markup.
  }

  const { data } = await tmdbClient.get<TmdbListResponse>("/movie/popular");
  const fallbackItems = data.results
    .filter((record) => isAllowedForTrendingFeedRecord(record, "movie"))
    .map((record) => normalizeMedia(record, "movie"))
    .filter(isQualityItem);
  return enrichItemsWithImdbRatings(fallbackItems);
}

export async function getMovieDetails(id: string): Promise<MovieDetails> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("movie-details", id);
  const cached = movieDetailsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return dedupeInFlight(inFlightMovieDetails, cacheKey, () => fetchMovieDetails(id, cacheKey));
}

async function fetchMovieDetails(id: string, cacheKey: string): Promise<MovieDetails> {
  const { data } = await tmdbClient.get<TmdbMovieDetailsWithCreditsResponse>(`/movie/${id}`, {
    params: {
      append_to_response: "credits"
    }
  });

  const cast = (data.credits?.cast ?? [])
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
    .slice(0, 12)
    .map(normalizeCastMember);

  const imdbId = data.imdb_id ?? null;
  let voteAverage = Number.isFinite(data.vote_average) ? data.vote_average : 0;

  if (imdbId) {
    const imdbRating = await getImdbRating(imdbId);
    if (imdbRating !== null && imdbRating > 0) {
      voteAverage = imdbRating;
    }
  }

  const result: MovieDetails = {
    id: data.id,
    title: data.title,
    originalTitle: (data.original_language !== "en" && data.original_title !== data.title)
      ? data.original_title : undefined,
    overview: data.overview ?? "",
    runtimeMinutes: data.runtime,
    genres: data.genres.map((entry) => entry.name),
    genreIds: data.genres.map((entry) => entry.id),
    ageRating: data.adult ? "18+" : "6+",
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    voteAverage,
    voteCount: data.vote_count ?? 0,
    releaseDate: data.release_date ?? "",
    imdbId,
    collectionId: data.belongs_to_collection?.id ?? null,
    cast,
    directors: pickDirectorMembers(data.credits?.crew ?? []),
    crew: pickKeyCrewMembers(data.credits?.crew ?? [])
  };

  movieDetailsCache.set(cacheKey, result);
  return result;
}

export async function getSeriesDetails(id: string): Promise<SeriesDetails> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("series-details", id);
  const cached = seriesDetailsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return dedupeInFlight(inFlightSeriesDetails, cacheKey, () => fetchSeriesDetails(id, cacheKey));
}

async function fetchSeriesDetails(id: string, cacheKey: string): Promise<SeriesDetails> {
  const { data } = await tmdbClient.get<TmdbTvDetailsWithCreditsResponse>(`/tv/${id}`, {
    params: {
      append_to_response: "credits,external_ids"
    }
  });

  const cast = (data.credits?.cast ?? [])
    .slice()
    .sort((left, right) => left.order - right.order)
    .slice(0, 12)
    .map(normalizeCastMember);

  const directorsFromCrew = pickDirectorMembers(data.credits?.crew ?? []);
  const directors =
    directorsFromCrew.length > 0
      ? directorsFromCrew
      : (data.created_by ?? []).slice(0, 5).map((entry) => ({ id: entry.id, name: entry.name, profilePath: null }));

  const seasons = (data.seasons ?? [])
    .filter((season) => season.season_number > 0)
    .map(normalizeSeriesSeason)
    .sort((left, right) => left.seasonNumber - right.seasonNumber);

  const episodeRuntimeMinutes =
    data.episode_run_time.find((runtime) => Number.isFinite(runtime) && runtime > 0) ?? null;

  const imdbId = data.external_ids?.imdb_id ?? null;
  let voteAverage = Number.isFinite(data.vote_average) ? data.vote_average : 0;

  if (imdbId) {
    const imdbRating = await getImdbRating(imdbId);
    if (imdbRating !== null && imdbRating > 0) {
      voteAverage = imdbRating;
    }
  }

  const result: SeriesDetails = {
    id: data.id,
    title: data.name,
    originalTitle: (data.original_language !== "en" && data.original_name !== data.name)
      ? data.original_name : undefined,
    overview: data.overview ?? "",
    genres: data.genres.map((entry) => entry.name),
    genreIds: data.genres.map((entry) => entry.id),
    posterPath: data.poster_path,
    backdropPath: data.backdrop_path,
    voteAverage,
    voteCount: data.vote_count ?? 0,
    firstAirDate: data.first_air_date ?? "",
    imdbId,
    numberOfSeasons: data.number_of_seasons ?? seasons.length,
    numberOfEpisodes: data.number_of_episodes ?? 0,
    episodeRuntimeMinutes,
    seasons,
    cast,
    directors,
    crew: pickKeyCrewMembers(data.credits?.crew ?? [])
  };

  seriesDetailsCache.set(cacheKey, result);
  return result;
}

export async function getSeriesSeasonEpisodes(seriesId: string, seasonNumber: number): Promise<SeriesEpisode[]> {
  assertCredentials();
  const { data } = await tmdbClient.get<TmdbTvSeasonDetailsResponse>(`/tv/${seriesId}/season/${seasonNumber}`);
  return (data.episodes ?? []).map(normalizeSeriesEpisode);
}

export async function getMovieExternalRatings(
  movieId: string,
  seededImdbId?: string | null
): Promise<ExternalRatings> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("movie-ratings", movieId);
  const cached = movieExternalRatingsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const emptyRatings: ExternalRatings = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null,
    letterboxd: null
  };

  try {
    const imdbId = await getImdbId(movieId, seededImdbId);
    if (!imdbId) {
      movieExternalRatingsCache.set(cacheKey, emptyRatings);
      return emptyRatings;
    }

    const [omdbRatings, letterboxd, imdbApiRating] = await Promise.all([
      getOmdbRatings(imdbId),
      getLetterboxdRating(imdbId),
      getImdbRating(imdbId),
    ]);

    let imdbDisplay = omdbRatings.imdb;
    if (!imdbDisplay && imdbApiRating !== null && imdbApiRating > 0) {
      imdbDisplay = `${imdbApiRating}/10`;
    }

    const result = {
      imdb: imdbDisplay,
      rottenTomatoes: omdbRatings.rottenTomatoes,
      metacritic: omdbRatings.metacritic,
      letterboxd
    };
    movieExternalRatingsCache.set(cacheKey, result);
    return result;
  } catch {
    movieExternalRatingsCache.set(cacheKey, emptyRatings);
    return emptyRatings;
  }
}

export async function getSeriesExternalRatings(
  seriesId: string,
  seededImdbId?: string | null
): Promise<SeriesExternalRatings> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("series-ratings", seriesId);
  const cached = seriesExternalRatingsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const emptyRatings: SeriesExternalRatings = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null
  };

  try {
    const imdbId = await getImdbIdForMedia("tv", seriesId, seededImdbId);
    if (!imdbId) {
      seriesExternalRatingsCache.set(cacheKey, emptyRatings);
      return emptyRatings;
    }

    const [omdbRatings, imdbApiRating] = await Promise.all([
      getOmdbRatings(imdbId),
      getImdbRating(imdbId),
    ]);

    let imdbDisplay = omdbRatings.imdb;
    if (!imdbDisplay && imdbApiRating !== null && imdbApiRating > 0) {
      imdbDisplay = `${imdbApiRating}/10`;
    }

    const result = {
      imdb: imdbDisplay,
      rottenTomatoes: omdbRatings.rottenTomatoes,
      metacritic: omdbRatings.metacritic
    };
    seriesExternalRatingsCache.set(cacheKey, result);
    return result;
  } catch {
    seriesExternalRatingsCache.set(cacheKey, emptyRatings);
    return emptyRatings;
  }
}

export async function getMovieSummary(id: number): Promise<MediaItem> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("movie-summary", id);
  const cached = movieSummaryCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { data } = await tmdbClient.get<TmdbMediaRecord & { genres?: TmdbGenre[] }>(`/movie/${id}`);
  const item = normalizeMedia(
    {
      ...data,
      genre_ids: data.genre_ids ?? data.genres?.map((entry) => entry.id) ?? [],
    },
    "movie"
  );
  const [enriched] = await enrichItemsWithImdbRatings([item]);
  movieSummaryCache.set(cacheKey, enriched);
  return enriched;
}

export async function getSeriesSummary(id: number): Promise<MediaItem> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("series-summary", id);
  const cached = seriesSummaryCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const { data } = await tmdbClient.get<TmdbMediaRecord & { genres?: TmdbGenre[] }>(`/tv/${id}`);
  const item = normalizeMedia(
    {
      ...data,
      genre_ids: data.genre_ids ?? data.genres?.map((entry) => entry.id) ?? [],
    },
    "tv"
  );
  const [enriched] = await enrichItemsWithImdbRatings([item]);
  seriesSummaryCache.set(cacheKey, enriched);
  return enriched;
}

// Blocked languages for similar recommendations (Bollywood/Indian cinema etc.)
const BLOCKED_LANGUAGES = new Set(["hi", "ta", "te", "ml", "kn", "bn", "mr", "pa"]);
const MIN_SIMILAR_RATING = 6.5;
const MIN_SIMILAR_POPULARITY = 10;
const RELAXED_SIMILAR_RATING = 5.2;
const RELAXED_SIMILAR_POPULARITY = 4;
const MIN_SMART_SIMILAR_RESULTS = 5;
const MAX_SMART_SIMILAR_RESULTS = 12;
const CREDIT_ENRICHMENT_LIMIT = 24;

type CandidateEligibility = "strict" | "relaxed" | "fallback";
type SimilarCandidateSource = "similar" | "recs" | "collection" | "leadActor" | "genreFallback";

type ScoredCandidate = {
  record: TmdbMediaRecord;
  inSimilar: boolean;
  inRecs: boolean;
  inCollection: boolean;
  fromLeadActor: boolean;
  fromGenreFallback: boolean;
  eligibility: CandidateEligibility;
};

function passesBaseSimilarFilters(rec: TmdbMediaRecord, sourceId: number): boolean {
  if (rec.id === sourceId) return false;
  if (BLOCKED_LANGUAGES.has(rec.original_language ?? "")) return false;
  if (!rec.poster_path) return false;
  return true;
}

function resolveCandidateEligibility(rec: TmdbMediaRecord): CandidateEligibility | null {
  const rating = rec.vote_average ?? 0;
  const popularity = rec.popularity ?? 0;

  if (rating >= MIN_SIMILAR_RATING && popularity >= MIN_SIMILAR_POPULARITY) {
    return "strict";
  }

  if (rating >= RELAXED_SIMILAR_RATING || popularity >= RELAXED_SIMILAR_POPULARITY) {
    return "relaxed";
  }

  if (rating > 0 || popularity > 0) {
    return "fallback";
  }

  return null;
}

function pickStrongerEligibility(current: CandidateEligibility, next: CandidateEligibility) {
  const rank: Record<CandidateEligibility, number> = {
    strict: 3,
    relaxed: 2,
    fallback: 1,
  };

  return rank[next] > rank[current] ? next : current;
}

function scoreCandidate(
  candidate: ScoredCandidate,
  sourceGenreIds: number[],
  sourceKeywordIds: Set<number>,
  sourceRating: number,
  keywordMap: Map<number, Set<number>>,
  directorMap: Map<number, Set<number>>,
  castMap: Map<number, Set<number>>,
  sourceDirectorIds: Set<number>,
  sourceCastIds: Set<number>,
  leadActorId: number | null
): number {
  let score = 0;

  if (candidate.inCollection) score += 50;
  if (leadActorId !== null && candidate.fromLeadActor) score += 30;

  const candidateGenres = candidate.record.genre_ids ?? [];
  if (sourceGenreIds.length > 0 && candidateGenres.length > 0) {
    const shared = candidateGenres.filter((gid) => sourceGenreIds.includes(gid)).length;
    score += (shared / sourceGenreIds.length) * 10;
  }

  const candidateKeywords = keywordMap.get(candidate.record.id);
  if (candidateKeywords && sourceKeywordIds.size > 0) {
    let shared = 0;
    for (const kw of candidateKeywords) {
      if (sourceKeywordIds.has(kw)) shared++;
    }
    score += Math.min(shared, 5) * 3;
  }

  if (candidate.inSimilar && candidate.inRecs) score += 3;

  const dirs = directorMap.get(candidate.record.id);
  if (dirs) {
    let dirScore = 0;
    for (const d of dirs) {
      if (sourceDirectorIds.has(d)) dirScore += 8;
    }
    score += Math.min(dirScore, 16);
  }

  const cast = castMap.get(candidate.record.id);
  if (cast) {
    let castScore = 0;
    for (const a of cast) {
      if (sourceCastIds.has(a)) castScore += 3;
    }
    score += Math.min(castScore, 15);
  }

  const ratingDiff = Math.abs((candidate.record.vote_average ?? 0) - sourceRating);
  score += 5 - Math.min(ratingDiff, 5);

  return score;
}

async function finalizeSmartSimilarResults(
  scored: Array<{ candidate: ScoredCandidate; score: number }>,
  mediaType: MediaType,
  minResults = MIN_SMART_SIMILAR_RESULTS,
  maxResults = MAX_SMART_SIMILAR_RESULTS
): Promise<MediaItem[]> {
  const selected = new Map<number | string, MediaItem>();

  const appendMatches = (eligibleTiers: CandidateEligibility[]) => {
    for (const entry of scored) {
      if (selected.size >= maxResults) {
        return;
      }

      if (!eligibleTiers.includes(entry.candidate.eligibility)) {
        continue;
      }

      const media = normalizeMedia(entry.candidate.record, mediaType);
      if (!isQualityItem(media) || selected.has(media.id)) {
        continue;
      }

      selected.set(media.id, media);
    }
  };

  appendMatches(["strict"]);
  if (selected.size < minResults) {
    appendMatches(["relaxed"]);
  }
  if (selected.size < minResults) {
    appendMatches(["fallback"]);
  }
  if (selected.size < minResults) {
    appendMatches(["strict", "relaxed", "fallback"]);
  }

  return enrichItemsWithImdbRatings([...selected.values()].slice(0, maxResults));
}

function buildGenreFallbackParams(genreIds: number[]) {
  if (genreIds.length === 0) {
    return {
      sort_by: "popularity.desc",
      page: 1,
    };
  }

  return {
    with_genres: genreIds.join("|"),
    sort_by: "popularity.desc",
    page: 1,
  };
}

function mergeQuickSimilarResults(
  responses: Array<TmdbListResponse | null | undefined>,
  fallbackType: MediaType,
  excludedId: number,
  maxResults = 14
): MediaItem[] {
  const selected = new Map<number | string, MediaItem>();

  for (const response of responses) {
    if (!response) {
      continue;
    }

    for (const item of mapList(response, fallbackType)) {
      if (Number(item.id) === excludedId || selected.has(item.id)) {
        continue;
      }

      selected.set(item.id, item);
      if (selected.size >= maxResults) {
        return [...selected.values()];
      }
    }
  }

  return [...selected.values()];
}

export async function getQuickSimilarMovies(movieId: string, details: MovieDetails): Promise<MediaItem[]> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("quick-similar-movies", movieId);
  const cached = quickSimilarMoviesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [recommendationsResult, similarResult, genreFallbackResult] = await Promise.all([
    tmdbClient.get<TmdbListResponse>(`/movie/${movieId}/recommendations`).then((response) => response.data).catch(() => null),
    tmdbClient.get<TmdbListResponse>(`/movie/${movieId}/similar`).then((response) => response.data).catch(() => null),
    tmdbClient.get<TmdbListResponse>("/discover/movie", {
      params: buildGenreFallbackParams(details.genreIds),
    }).then((response) => response.data).catch(() => null),
  ]);

  const result = mergeQuickSimilarResults(
    [recommendationsResult, similarResult, genreFallbackResult],
    "movie",
    Number(movieId)
  );
  quickSimilarMoviesCache.set(cacheKey, result);
  return result;
}

export async function getQuickSimilarSeries(seriesId: string, details: SeriesDetails): Promise<MediaItem[]> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("quick-similar-series", seriesId);
  const cached = quickSimilarSeriesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [recommendationsResult, similarResult, genreFallbackResult] = await Promise.all([
    tmdbClient.get<TmdbListResponse>(`/tv/${seriesId}/recommendations`).then((response) => response.data).catch(() => null),
    tmdbClient.get<TmdbListResponse>(`/tv/${seriesId}/similar`).then((response) => response.data).catch(() => null),
    tmdbClient.get<TmdbListResponse>("/discover/tv", {
      params: buildGenreFallbackParams(details.genreIds),
    }).then((response) => response.data).catch(() => null),
  ]);

  const result = mergeQuickSimilarResults(
    [recommendationsResult, similarResult, genreFallbackResult],
    "tv",
    Number(seriesId)
  );
  quickSimilarSeriesCache.set(cacheKey, result);
  return result;
}

export async function getSmartSimilarMovies(movieId: string, details: MovieDetails): Promise<MediaItem[]> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("similar-movies", movieId);
  const cached = similarMoviesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const numericId = Number(movieId);
  const leadActor = details.cast[0] ?? null;
  const leadActorId = leadActor?.id ?? null;

  const [similarResult, recsResult, keywordsResult, collectionResult, leadActorResult, genreFallbackResult] = await Promise.all([
    tmdbClient.get<TmdbListResponse>(`/movie/${movieId}/similar`).catch(() => null),
    tmdbClient.get<TmdbListResponse>(`/movie/${movieId}/recommendations`).catch(() => null),
    tmdbClient.get<TmdbKeywordsResponse>(`/movie/${movieId}/keywords`).catch(() => null),
    details.collectionId
      ? tmdbClient.get<TmdbCollectionResponse>(`/collection/${details.collectionId}`).catch(() => null)
      : Promise.resolve(null),
    leadActorId
      ? tmdbClient.get<TmdbListResponse>("/discover/movie", {
          params: {
            with_cast: leadActorId,
            with_genres: details.genreIds.join(","),
            "vote_average.gte": RELAXED_SIMILAR_RATING,
            sort_by: "popularity.desc",
            page: 1,
          }
        }).catch(() => null)
      : Promise.resolve(null),
    tmdbClient.get<TmdbListResponse>("/discover/movie", {
      params: buildGenreFallbackParams(details.genreIds),
    }).catch(() => null),
  ]);

  const candidateMap = new Map<number, ScoredCandidate>();

  const addCandidates = (records: TmdbMediaRecord[], source: SimilarCandidateSource) => {
    for (const rec of records) {
      if (!passesBaseSimilarFilters(rec, numericId)) continue;

      const eligibility = resolveCandidateEligibility(rec);
      if (!eligibility) continue;

      const existing = candidateMap.get(rec.id);
      if (existing) {
        existing.eligibility = pickStrongerEligibility(existing.eligibility, eligibility);
        if (source === "similar") existing.inSimilar = true;
        if (source === "recs") existing.inRecs = true;
        if (source === "collection") existing.inCollection = true;
        if (source === "leadActor") existing.fromLeadActor = true;
        if (source === "genreFallback") existing.fromGenreFallback = true;
      } else {
        candidateMap.set(rec.id, {
          record: rec,
          inSimilar: source === "similar",
          inRecs: source === "recs",
          inCollection: source === "collection",
          fromLeadActor: source === "leadActor",
          fromGenreFallback: source === "genreFallback",
          eligibility,
        });
      }
    }
  };

  if (similarResult) addCandidates(similarResult.data.results, "similar");
  if (recsResult) addCandidates(recsResult.data.results, "recs");
  if (collectionResult) addCandidates(collectionResult.data.parts, "collection");
  if (leadActorResult) addCandidates(leadActorResult.data.results, "leadActor");
  if (genreFallbackResult) addCandidates(genreFallbackResult.data.results, "genreFallback");

  const sourceKeywordIds = new Set((keywordsResult?.data.keywords ?? []).map((k) => k.id));
  const sourceDirectorIds = new Set(details.directors.map((d) => d.id));
  const sourceCastIds = new Set(details.cast.map((c) => c.id));

  const candidates = [...candidateMap.values()];
  const keywordMap = new Map<number, Set<number>>();
  const directorMap = new Map<number, Set<number>>();
  const castMap = new Map<number, Set<number>>();

  const creditFetches = candidates.slice(0, CREDIT_ENRICHMENT_LIMIT).map(async (c) => {
    try {
      const [kwRes, creditsRes] = await Promise.all([
        tmdbClient.get<TmdbKeywordsResponse>(`/movie/${c.record.id}/keywords`).catch(() => null),
        tmdbClient.get<{ cast?: Array<{ id: number }>; crew?: TmdbCrewRecord[] }>(`/movie/${c.record.id}/credits`).catch(() => null)
      ]);
      if (kwRes) {
        keywordMap.set(c.record.id, new Set(kwRes.data.keywords.map((k) => k.id)));
      }
      if (creditsRes?.data) {
        const dirs = (creditsRes.data.crew ?? []).filter((cr) => cr.job === "Director").map((cr) => cr.id);
        directorMap.set(c.record.id, new Set(dirs));
        castMap.set(c.record.id, new Set((creditsRes.data.cast ?? []).slice(0, 12).map((cr) => cr.id)));
      }
    } catch {
      // graceful degradation
    }
  });

  await Promise.all(creditFetches);

  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidate(
      c,
      details.genreIds,
      sourceKeywordIds,
      details.voteAverage,
      keywordMap,
      directorMap,
      castMap,
      sourceDirectorIds,
      sourceCastIds,
      leadActorId
    )
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (b.candidate.record.popularity ?? 0) - (a.candidate.record.popularity ?? 0);
  });

  const result = await finalizeSmartSimilarResults(scored, "movie");
  similarMoviesCache.set(cacheKey, result);
  return result;
}

export async function getSmartSimilarSeries(seriesId: string, details: SeriesDetails): Promise<MediaItem[]> {
  assertCredentials();
  const cacheKey = getLocalizedTmdbCacheKey("similar-series", seriesId);
  const cached = similarSeriesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const numericId = Number(seriesId);
  const leadActor = details.cast[0] ?? null;
  const leadActorId = leadActor?.id ?? null;

  const [similarResult, recsResult, keywordsResult, leadActorResult, genreFallbackResult] = await Promise.all([
    tmdbClient.get<TmdbListResponse>(`/tv/${seriesId}/similar`).catch(() => null),
    tmdbClient.get<TmdbListResponse>(`/tv/${seriesId}/recommendations`).catch(() => null),
    tmdbClient.get<TmdbTvKeywordsResponse>(`/tv/${seriesId}/keywords`).catch(() => null),
    leadActorId
      ? tmdbClient.get<TmdbListResponse>("/discover/tv", {
          params: {
            with_cast: leadActorId,
            with_genres: details.genreIds.join(","),
            "vote_average.gte": RELAXED_SIMILAR_RATING,
            sort_by: "popularity.desc",
            page: 1,
          }
        }).catch(() => null)
      : Promise.resolve(null),
    tmdbClient.get<TmdbListResponse>("/discover/tv", {
      params: buildGenreFallbackParams(details.genreIds),
    }).catch(() => null),
  ]);

  const candidateMap = new Map<number, ScoredCandidate>();

  const addCandidates = (records: TmdbMediaRecord[], source: SimilarCandidateSource) => {
    for (const rec of records) {
      if (!passesBaseSimilarFilters(rec, numericId)) continue;

      const eligibility = resolveCandidateEligibility(rec);
      if (!eligibility) continue;

      const existing = candidateMap.get(rec.id);
      if (existing) {
        existing.eligibility = pickStrongerEligibility(existing.eligibility, eligibility);
        if (source === "similar") existing.inSimilar = true;
        if (source === "recs") existing.inRecs = true;
        if (source === "leadActor") existing.fromLeadActor = true;
        if (source === "genreFallback") existing.fromGenreFallback = true;
      } else {
        candidateMap.set(rec.id, {
          record: rec,
          inSimilar: source === "similar",
          inRecs: source === "recs",
          inCollection: false,
          fromLeadActor: source === "leadActor",
          fromGenreFallback: source === "genreFallback",
          eligibility,
        });
      }
    }
  };

  if (similarResult) addCandidates(similarResult.data.results, "similar");
  if (recsResult) addCandidates(recsResult.data.results, "recs");
  if (leadActorResult) addCandidates(leadActorResult.data.results, "leadActor");
  if (genreFallbackResult) addCandidates(genreFallbackResult.data.results, "genreFallback");

  const sourceKeywordIds = new Set((keywordsResult?.data.results ?? []).map((k) => k.id));
  const sourceDirectorIds = new Set(details.directors.map((d) => d.id));
  const sourceCastIds = new Set(details.cast.map((c) => c.id));

  const candidates = [...candidateMap.values()];
  const keywordMap = new Map<number, Set<number>>();
  const directorMap = new Map<number, Set<number>>();
  const castMap = new Map<number, Set<number>>();

  const creditFetches = candidates.slice(0, CREDIT_ENRICHMENT_LIMIT).map(async (c) => {
    try {
      const [kwRes, creditsRes] = await Promise.all([
        tmdbClient.get<TmdbTvKeywordsResponse>(`/tv/${c.record.id}/keywords`).catch(() => null),
        tmdbClient.get<{ cast?: Array<{ id: number }>; crew?: TmdbCrewRecord[] }>(`/tv/${c.record.id}/credits`).catch(() => null)
      ]);
      if (kwRes) {
        keywordMap.set(c.record.id, new Set(kwRes.data.results.map((k) => k.id)));
      }
      if (creditsRes?.data) {
        const dirs = (creditsRes.data.crew ?? []).filter((cr) => cr.job === "Director").map((cr) => cr.id);
        directorMap.set(c.record.id, new Set(dirs));
        castMap.set(c.record.id, new Set((creditsRes.data.cast ?? []).slice(0, 12).map((cr) => cr.id)));
      }
    } catch {
      // graceful degradation
    }
  });

  await Promise.all(creditFetches);

  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidate(
      c,
      details.genreIds,
      sourceKeywordIds,
      details.voteAverage,
      keywordMap,
      directorMap,
      castMap,
      sourceDirectorIds,
      sourceCastIds,
      leadActorId
    )
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (b.candidate.record.popularity ?? 0) - (a.candidate.record.popularity ?? 0);
  });

  const result = await finalizeSmartSimilarResults(scored, "tv");
  similarSeriesCache.set(cacheKey, result);
  return result;
}

export async function getSeriesEpisodeFallbackImagesWithImdb(
  seriesTitle: string,
  imdbId: string | null
): Promise<Record<string, string>> {
  const normalizedTitle = seriesTitle.trim().toLowerCase();
  const cacheKey = imdbId ? `imdb:${imdbId}` : `title:${normalizedTitle}`;
  if (!normalizedTitle && !imdbId) {
    return {};
  }

  if (tvMazeEpisodeImageCache.has(cacheKey)) {
    return tvMazeEpisodeImageCache.get(cacheKey)!;
  }

  try {
    let showId: number | null = null;

    if (imdbId) {
      try {
        const { data: lookup } = await axios.get<TvMazeLookupResponse>("https://api.tvmaze.com/lookup/shows", {
          timeout: 10000,
          params: {
            imdb: imdbId
          }
        });
        showId = lookup?.id ?? null;
      } catch {
        showId = null;
      }
    }

    if (!showId && normalizedTitle) {
      const { data: show } = await axios.get<TvMazeShowSearchResponse>("https://api.tvmaze.com/singlesearch/shows", {
        timeout: 10000,
        params: {
          q: seriesTitle
        }
      });
      showId = show?.id ?? null;
    }

    if (!showId) {
      return {};
    }

    const { data: episodes } = await axios.get<TvMazeEpisodeRecord[]>(`https://api.tvmaze.com/shows/${showId}/episodes`, {
      timeout: 10000
    });

    const imageMap: Record<string, string> = {};
    episodes.forEach((episode) => {
      const imageUrl = episode.image?.original ?? episode.image?.medium ?? null;
      if (!imageUrl) {
        return;
      }
      imageMap[toEpisodeImageKey(episode.season, episode.number)] = imageUrl;
    });

    tvMazeEpisodeImageCache.set(cacheKey, imageMap);
    if (imdbId && normalizedTitle) {
      tvMazeEpisodeImageCache.set(`title:${normalizedTitle}`, imageMap);
    }
    return imageMap;
  } catch {
    return {};
  }
}

export async function getTmdbSeasonEpisodeFallbackImages(
  seriesId: string,
  seasonNumber: number,
  episodeNumbers: number[]
): Promise<Record<string, string>> {
  assertCredentials();
  const uniqueEpisodeNumbers = Array.from(new Set(episodeNumbers.filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueEpisodeNumbers.length === 0) {
    return {};
  }

  const imageMap: Record<string, string> = {};

  await Promise.all(
    uniqueEpisodeNumbers.map(async (episodeNumber) => {
      const cacheKey = `${seriesId}:${seasonNumber}:${episodeNumber}`;
      if (tmdbEpisodeImageCache.has(cacheKey)) {
        const cached = tmdbEpisodeImageCache.get(cacheKey);
        if (cached) {
          imageMap[toEpisodeImageKey(seasonNumber, episodeNumber)] = cached;
        }
        return;
      }

      try {
        const { data } = await tmdbClient.get<TmdbEpisodeImagesResponse>(
          `/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}/images`
        );
        const path = data.stills.find((entry) => Boolean(entry.file_path))?.file_path ?? null;
        const uri = getTmdbImageUrl(path, "w500");
        tmdbEpisodeImageCache.set(cacheKey, uri);
        if (uri) {
          imageMap[toEpisodeImageKey(seasonNumber, episodeNumber)] = uri;
        }
      } catch {
        tmdbEpisodeImageCache.set(cacheKey, null);
      }
    })
  );

  return imageMap;
}

export async function getPersonDetails(id: string): Promise<PersonDetails> {
  assertCredentials();

  const [personResponse, creditsResponse] = await Promise.all([
    tmdbClient.get<TmdbPersonDetailsResponse>(`/person/${id}`),
    tmdbClient.get<TmdbPersonCombinedCreditsResponse>(`/person/${id}/combined_credits`)
  ]);

  const person = personResponse.data;
  const knownForMovies = normalizePersonCredits(creditsResponse.data.cast, { requirePoster: true });

  return {
    id: person.id,
    name: person.name,
    biography: person.biography ?? "",
    birthday: person.birthday,
    placeOfBirth: person.place_of_birth,
    knownForDepartment: person.known_for_department,
    popularity: person.popularity,
    profilePath: person.profile_path,
    knownForMovies
  };
}

// ---------------------------------------------------------------------------
// Movie trailer (YouTube)
// ---------------------------------------------------------------------------

type TmdbVideoRecord = {
  key: string;
  site: string;
  type: string;
  official: boolean;
  name: string;
};

type TmdbVideosResponse = {
  results: TmdbVideoRecord[];
};

function resolveTrailerUrl(videos: TmdbVideoRecord[]): string | null {
  const youtubeVideos = videos.filter((video) => video.site === "YouTube" && video.key);

  const officialTrailer = youtubeVideos.find((video) => video.type === "Trailer" && video.official);
  if (officialTrailer) {
    return `https://www.youtube.com/watch?v=${officialTrailer.key}`;
  }

  const anyTrailer = youtubeVideos.find((video) => video.type === "Trailer");
  if (anyTrailer) {
    return `https://www.youtube.com/watch?v=${anyTrailer.key}`;
  }

  const teaser = youtubeVideos.find((video) => video.type === "Teaser");
  if (teaser) {
    return `https://www.youtube.com/watch?v=${teaser.key}`;
  }

  return null;
}

/**
 * Fetches the official YouTube trailer URL for a movie from TMDB.
 * Prioritizes: Official Trailer > any Trailer > Teaser.
 * Returns null if no YouTube trailer is found.
 */
export async function getMovieTrailerUrl(movieId: string): Promise<string | null> {
  assertCredentials();
  const cacheKey = `movie:${movieId}`;
  if (trailerUrlCache.has(cacheKey)) {
    return trailerUrlCache.get(cacheKey) ?? null;
  }

  try {
    const { data } = await tmdbClient.get<TmdbVideosResponse>(`/movie/${movieId}/videos`);
    const trailerUrl = resolveTrailerUrl(data.results ?? []);
    trailerUrlCache.set(cacheKey, trailerUrl);
    return trailerUrl;
  } catch {
    return null;
  }
}

/**
 * Fetches the official YouTube trailer URL for a TV series from TMDB.
 * Prioritizes: Official Trailer > any Trailer > Teaser.
 * Returns null if no YouTube trailer is found.
 */
export async function getSeriesTrailerUrl(seriesId: string): Promise<string | null> {
  assertCredentials();
  const cacheKey = `tv:${seriesId}`;
  if (trailerUrlCache.has(cacheKey)) {
    return trailerUrlCache.get(cacheKey) ?? null;
  }

  try {
    const { data } = await tmdbClient.get<TmdbVideosResponse>(`/tv/${seriesId}/videos`);
    const trailerUrl = resolveTrailerUrl(data.results ?? []);
    trailerUrlCache.set(cacheKey, trailerUrl);
    return trailerUrl;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Multi-Search (movies + TV)                                        */
/* ------------------------------------------------------------------ */

function normalizeSearchTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isConfidentActorSearchMatch(query: string, person: TmdbPersonSearchRecord | undefined): person is TmdbPersonSearchRecord {
  if (!person || person.known_for_department !== "Acting") {
    return false;
  }

  const normalizedQuery = normalizeSearchTerm(query);
  const normalizedName = normalizeSearchTerm(person.name);
  if (normalizedQuery.length < 3 || normalizedName.length === 0) {
    return false;
  }

  return (
    normalizedName === normalizedQuery ||
    normalizedName.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedName)
  );
}

type ActorCreditSearchResponse = PaginatedMediaResponse & {
  actorName: string;
  confidence: number;
};

function getActorSearchConfidence(query: string, person: TmdbPersonSearchRecord | undefined) {
  if (!isConfidentActorSearchMatch(query, person)) {
    return 0;
  }

  const normalizedQuery = normalizeSearchTerm(query);
  const normalizedName = normalizeSearchTerm(person.name);
  const queryTokenCount = normalizedQuery.split(" ").filter(Boolean).length;
  const nameTokenCount = normalizedName.split(" ").filter(Boolean).length;

  if (normalizedName === normalizedQuery) {
    return nameTokenCount >= 2 ? 1000 : 880;
  }

  if (normalizedQuery.startsWith(normalizedName) && nameTokenCount >= 2) {
    return 940;
  }

  if (normalizedName.startsWith(normalizedQuery) && normalizedQuery.length >= 4) {
    return queryTokenCount >= 2 ? 900 : 760;
  }

  return 0;
}

function getSearchTitleScore(query: string, item: MediaItem) {
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return 0;

  const normalizedTitle = normalizeSearchTerm(item.title);
  const normalizedOriginalTitle = normalizeSearchTerm(item.originalTitle ?? "");
  const titleCandidates = [normalizedTitle, normalizedOriginalTitle].filter(Boolean);

  if (titleCandidates.some((title) => title === normalizedQuery)) {
    return 1000;
  }

  if (titleCandidates.some((title) => title.startsWith(`${normalizedQuery} `))) {
    return 820;
  }

  if (titleCandidates.some((title) => title.includes(` ${normalizedQuery} `))) {
    return 620;
  }

  if (titleCandidates.some((title) => title.startsWith(normalizedQuery))) {
    return 520;
  }

  return 0;
}

function hasConfidentTitleSearchMatch(query: string, items: MediaItem[]) {
  return items.some((item) => getSearchTitleScore(query, item) >= 820);
}

function getBestTitleSearchScore(query: string, items: MediaItem[]) {
  return items.reduce((best, item) => Math.max(best, getSearchTitleScore(query, item)), 0);
}

function rankTitleSearchResults(query: string, items: MediaItem[]) {
  return items
    .map((item, index) => ({ item, index, titleScore: getSearchTitleScore(query, item) }))
    .sort((left, right) => {
      if (left.titleScore !== right.titleScore) {
        return right.titleScore - left.titleScore;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

async function searchActorCredits(query: string, page: number): Promise<ActorCreditSearchResponse | null> {
  const { data: peopleData } = await tmdbClient.get<TmdbPersonSearchResponse>("/search/person", {
    params: { query: query.trim(), page: 1, include_adult: false }
  });

  const actor = peopleData.results
    .filter((person) => person.known_for_department === "Acting")
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0))[0];

  const confidence = getActorSearchConfidence(query, actor);
  if (confidence <= 0) {
    return null;
  }

  const { data: creditsData } = await tmdbClient.get<TmdbPersonCombinedCreditsResponse>(
    `/person/${actor.id}/combined_credits`
  );
  const allCredits = normalizePersonCredits(creditsData.cast, { requirePoster: true });
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(allCredits.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  return {
    actorName: actor.name,
    confidence,
    items: allCredits.slice((safePage - 1) * pageSize, safePage * pageSize),
    page: safePage,
    totalPages
  };
}

export async function searchMulti(
  query: string,
  page: number = 1
): Promise<PaginatedMediaResponse> {
  if (!query.trim()) {
    return { items: [], page: 1, totalPages: 0 };
  }

  const multiSearchRequest = tmdbClient.get<TmdbListResponse>("/search/multi", {
    params: { query: query.trim(), page, include_adult: false }
  });

  const actorCreditsRequest = searchActorCredits(query, page).catch(() => null);
  const [{ data }, actorCredits] = await Promise.all([multiSearchRequest, actorCreditsRequest]);

  const filtered = data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((entry) => normalizeMedia(entry, entry.media_type ?? "movie"))
    .filter((item) => item.title !== "Untitled" && item.rating >= 6);

  const rankedTitleResults = rankTitleSearchResults(query, filtered);
  const bestTitleScore = getBestTitleSearchScore(query, rankedTitleResults);

  const shouldUseActorCredits =
    actorCredits &&
    actorCredits.items.length > 0 &&
    (
      filtered.length === 0 ||
      actorCredits.confidence >= 1000 ||
      (page === 1 && actorCredits.confidence >= 880 && bestTitleScore < 1000) ||
      (page === 1 && !hasConfidentTitleSearchMatch(query, rankedTitleResults))
    );

  if (shouldUseActorCredits) {
    return actorCredits;
  }

  const items = await enrichItemsWithImdbRatings(rankedTitleResults);

  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

/* ------------------------------------------------------------------ */
/*  Genre Lists                                                       */
/* ------------------------------------------------------------------ */

export type Genre = {
  id: number;
  name: string;
};

const cachedMovieGenres = new Map<string, Genre[]>();
const cachedTvGenres = new Map<string, Genre[]>();

export async function getMovieGenres(): Promise<Genre[]> {
  const language = getTmdbRequestLanguage();
  const cached = cachedMovieGenres.get(language);
  if (cached) return cached;
  const { data } = await tmdbClient.get<{ genres: Genre[] }>("/genre/movie/list");
  cachedMovieGenres.set(language, data.genres);
  return data.genres;
}

export async function getTvGenres(): Promise<Genre[]> {
  const language = getTmdbRequestLanguage();
  const cached = cachedTvGenres.get(language);
  if (cached) return cached;
  const { data } = await tmdbClient.get<{ genres: Genre[] }>("/genre/tv/list");
  cachedTvGenres.set(language, data.genres);
  return data.genres;
}

/* ------------------------------------------------------------------ */
/*  Discover with Filters                                             */
/* ------------------------------------------------------------------ */

export type DiscoverFilters = {
  mediaType: MediaType;
  genreIds?: number[];
  yearFrom?: number;
  yearTo?: number;
  ratingMin?: number;
  sortBy?: "popularity.desc" | "vote_average.desc" | "release_date.desc" | "vote_count.desc";
};

export async function discoverWithFilters(
  filters: DiscoverFilters,
  page: number = 1
): Promise<PaginatedMediaResponse> {
  const endpoint = filters.mediaType === "movie" ? "/discover/movie" : "/discover/tv";
  const dateField = filters.mediaType === "movie" ? "primary_release_date" : "first_air_date";

  const params: Record<string, string | number | boolean> = {
    page,
    include_adult: false,
    sort_by: filters.sortBy ?? "popularity.desc",
    "vote_count.gte": 50
  };

  if (filters.genreIds && filters.genreIds.length > 0) {
    params.with_genres = filters.genreIds.join(",");
  }

  if (filters.yearFrom) {
    params[`${dateField}.gte`] = `${filters.yearFrom}-01-01`;
  }

  if (filters.yearTo) {
    params[`${dateField}.lte`] = `${filters.yearTo}-12-31`;
  }

  if (filters.ratingMin) {
    params["vote_average.gte"] = filters.ratingMin;
  }

  const { data } = await tmdbClient.get<TmdbListResponse>(endpoint, { params });
  const items = await enrichItemsWithImdbRatings(mapList(data, filters.mediaType));

  return {
    items,
    page: data.page,
    totalPages: data.total_pages
  };
}

const altTitleCache = new Map<string, string | null>();
const localizedFranchiseMetadataCache = new Map<string, { title: string | null; tagline: string | null } | null>();
const localizedFranchiseMetadataRequests = new Map<string, Promise<{ title: string | null; tagline: string | null } | null>>();

export async function getTurkishAlternativeTitle(
  tmdbId: string,
  mediaType: MediaType
): Promise<string | null> {
  const key = `${mediaType}#${tmdbId}`;
  if (altTitleCache.has(key)) return altTitleCache.get(key)!;

  try {
    const endpoint =
      mediaType === "movie"
        ? `/movie/${tmdbId}/alternative_titles`
        : `/tv/${tmdbId}/alternative_titles`;
    const { data } = await tmdbClient.get(endpoint);
    const titles = data.titles ?? data.results ?? [];
    const turkish = titles.find((t: any) => t.iso_3166_1 === "TR");
    const result = turkish?.title ?? null;
    altTitleCache.set(key, result);
    return result;
  } catch {
    altTitleCache.set(key, null);
    return null;
  }
}

export async function getLocalizedFranchiseMetadata(
  tmdbId: string,
  mediaType: MediaType,
  language: AppLanguage
): Promise<{ title: string | null; tagline: string | null } | null> {
  if (language === "en") {
    return null;
  }

  const key = `${language}:${mediaType}:${tmdbId}`;
  if (localizedFranchiseMetadataCache.has(key)) {
    return localizedFranchiseMetadataCache.get(key) ?? null;
  }

  const existingRequest = localizedFranchiseMetadataRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const endpoint = mediaType === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
      const { data } = await tmdbClient.get<TmdbLocalizedFranchiseMetadataResponse>(endpoint, {
        params: {
          language: getLanguageLocale(language),
        },
      });

      const localizedTitle =
        mediaType === "movie"
          ? typeof data.title === "string" && data.title.trim().length > 0
            ? data.title.trim()
            : null
          : typeof data.name === "string" && data.name.trim().length > 0
            ? data.name.trim()
            : null;

      const alternativeTitle =
        language === "tr" ? await getTurkishAlternativeTitle(tmdbId, mediaType) : null;

      const title = alternativeTitle?.trim().length
        ? alternativeTitle.trim()
        : localizedTitle;

      const tagline = typeof data.tagline === "string" && data.tagline.trim().length > 0
        ? data.tagline.trim()
        : null;

      const result = title || tagline ? { title, tagline } : null;
      localizedFranchiseMetadataCache.set(key, result);
      return result;
    } catch {
      localizedFranchiseMetadataCache.set(key, null);
      return null;
    }
  })().finally(() => {
    localizedFranchiseMetadataRequests.delete(key);
  });

  localizedFranchiseMetadataRequests.set(key, request);
  return request;
}


