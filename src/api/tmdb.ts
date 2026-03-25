import axios, { AxiosHeaders } from "axios";
import { getAlternateTmdbAuthMode, resolveTmdbAuth, TmdbAuthMode } from "./tmdbAuth";
import { getCachedOmdbRatings } from "./ratingsProxy";
import {
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

type TmdbMovieDetailsWithCreditsResponse = {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  popularity: number;
  release_date: string;
  genres: TmdbGenre[];
  credits?: {
    cast?: Array<{
      id: number;
      order?: number;
    }>;
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

type TmdbMovieCreditRecord = {
  id: number;
  title?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  overview: string;
  release_date?: string;
  popularity?: number;
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

type TmdbPersonMovieCreditsResponse = {
  cast: TmdbMovieCreditRecord[];
  crew?: Array<{
    id: number;
    title?: string;
    poster_path: string | null;
    backdrop_path: string | null;
    vote_average: number;
    overview: string;
    release_date?: string;
    popularity?: number;
    job?: string;
    department?: string;
  }>;
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
  | "imdb_top_250_series"
  | "az_classics";

type TmdbImageSize = "w185" | "w300" | "w342" | "w500" | "w780" | "original";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

const tmdbApiKey = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const tmdbAccessToken = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN;
const tmdbAuth = resolveTmdbAuth(tmdbApiKey, tmdbAccessToken);


const imdbIdCache = new Map<string, string | null>();
const omdbRatingsCache = new Map<string, Pick<ExternalRatings, "imdb" | "rottenTomatoes" | "metacritic">>();
const letterboxdCache = new Map<string, string | null>();
const imdbToTmdbMovieCache = new Map<string, TmdbFindMovieRecord | null>();
const imdbToTmdbTvCache = new Map<string, TmdbFindTvRecord | null>();
const tvMazeEpisodeImageCache = new Map<string, Record<string, string>>();
const tmdbEpisodeImageCache = new Map<string, string | null>();

const tmdbClient = axios.create({
  baseURL: TMDB_BASE_URL,
  timeout: 12000
});

function applyTmdbAuthToConfig(config: any, mode: TmdbAuthMode) {
  const nextConfig = { ...config };
  nextConfig.params = { ...(config.params ?? {}) };

  const headers = AxiosHeaders.from(config.headers);
  headers.delete("Authorization");
  delete nextConfig.params.api_key;

  if (mode === "api_key" && tmdbAuth.apiKeyParam) {
    nextConfig.params.api_key = tmdbAuth.apiKeyParam;
  } else if (mode === "bearer" && tmdbAuth.bearerToken) {
    headers.set("Authorization", `Bearer ${tmdbAuth.bearerToken}`);
  }

  nextConfig.headers = headers;
  nextConfig._tmdbAuthMode = mode;
  return nextConfig;
}

tmdbClient.interceptors.request.use((config) => {
  const requestedMode = (config as any)._tmdbAuthMode as TmdbAuthMode | undefined;
  const mode = requestedMode ?? tmdbAuth.mode;
  return applyTmdbAuthToConfig(config, mode);
});

tmdbClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as any;

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
  if (tmdbAuth.mode === "none") {
    throw new Error(
      "Missing TMDB credentials. Set EXPO_PUBLIC_TMDB_API_KEY or EXPO_PUBLIC_TMDB_ACCESS_TOKEN."
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

function normalizeMovieCredit(item: TmdbMovieCreditRecord): MediaItem {
  return {
    id: item.id,
    title: item.title ?? "Untitled",
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: Number.isFinite(item.vote_average) ? item.vote_average : 0,
    overview: item.overview ?? "",
    year: item.release_date ? item.release_date.split("-")[0] ?? "----" : "----",
    mediaType: "movie"
  };
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

async function getOmdbRatings(imdbId: string): Promise<Pick<ExternalRatings, "imdb" | "rottenTomatoes" | "metacritic">> {
  if (omdbRatingsCache.has(imdbId)) {
    return omdbRatingsCache.get(imdbId)!;
  }

  const empty = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null
  };

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
  const enriched = await Promise.all(
    items.map(async (item) => {
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
    }),
  );

  return enriched;
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
  const items = await enrichItemsWithImdbRatings(mapList(data, type));
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
  try {
    const imdbId = await getImdbId(movieId);
    if (!imdbId) {
      return tmdbRating !== undefined && tmdbRating > 6.5;
    }

    const omdbRatings = await getOmdbRatings(imdbId);
    const imdbScore = parseScaledRating(omdbRatings.imdb, 10);
    if (imdbScore !== null && imdbScore > 6.5) {
      return true;
    }

    const letterboxdRaw = await getLetterboxdRating(imdbId);
    const letterboxdScore = parseScaledRating(letterboxdRaw, 5);
    if (letterboxdScore !== null && letterboxdScore > 3) {
      return true;
    }

    return tmdbRating !== undefined && tmdbRating > 6.5;
  } catch {
    return tmdbRating !== undefined && tmdbRating > 6.5;
  }
}

async function passesTopNewSeriesThreshold(seriesId: string, tmdbRating?: number): Promise<boolean> {
  try {
    const imdbId = await getImdbIdForMedia("tv", seriesId);
    if (!imdbId) {
      return tmdbRating !== undefined && tmdbRating >= 7;
    }

    const omdbRatings = await getOmdbRatings(imdbId);
    const imdbScore = parseScaledRating(omdbRatings.imdb, 10);
    if (imdbScore !== null) {
      return imdbScore >= 7;
    }

    return tmdbRating !== undefined && tmdbRating >= 7;
  } catch {
    return tmdbRating !== undefined && tmdbRating >= 7;
  }
}

export async function getTopNewMoviesPage(page: number): Promise<PaginatedMediaResponse> {
  assertCredentials();
  const now = new Date();
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(now.getMonth() - 3);

  const { data } = await tmdbClient.get<TmdbListResponse>("/discover/movie", {
    params: {
      page,
      include_adult: false,
      sort_by: "primary_release_date.desc",
      "primary_release_date.gte": toTmdbDateValue(threeMonthsAgo),
      "primary_release_date.lte": toTmdbDateValue(now),
      "vote_count.gte": 50
    }
  });

  const candidates = mapList(data, "movie");
  const verdicts = await Promise.all(
    candidates.map(async (item) => {
      const isQualified = await passesTopNewThreshold(String(item.id), item.rating);
      return isQualified ? item : null;
    })
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
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(now.getMonth() - 12);

  const { data } = await tmdbClient.get<TmdbListResponse>("/discover/tv", {
    params: {
      page,
      include_adult: false,
      sort_by: "first_air_date.desc",
      "first_air_date.gte": toTmdbDateValue(twelveMonthsAgo),
      "first_air_date.lte": toTmdbDateValue(now),
      "vote_count.gte": 50
    }
  });

  const candidates = mapList(data, "tv");
  const verdicts = await Promise.all(
    candidates.map(async (item) => {
      const isQualified = await passesTopNewSeriesThreshold(String(item.id), item.rating);
      return isQualified ? item : null;
    })
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
        rating: entry.imdbRating,
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
      rating: entry.imdbRating,
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

  const resolved = await Promise.all(
    slice.map(async (entry) => resolveImdbEntryToMediaItem(entry, "movie")),
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

  const resolved = await Promise.all(
    slice.map(async (entry) => resolveImdbEntryToMediaItem(entry, "tv")),
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
  const seed = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
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
  const { data } = await tmdbClient.get<TmdbListResponse>("/movie/popular");
  return enrichItemsWithImdbRatings(mapList(data, "movie"));
}

export async function getMovieDetails(id: string): Promise<MovieDetails> {
  assertCredentials();

  const [detailsResponse, creditsResponse] = await Promise.all([
    tmdbClient.get<TmdbMovieDetailsResponse>(`/movie/${id}`),
    tmdbClient.get<TmdbCreditsResponse>(`/movie/${id}/credits`)
  ]);

  const details = detailsResponse.data;
  const cast = creditsResponse.data.cast
    .sort((left, right) => left.order - right.order)
    .slice(0, 12)
    .map(normalizeCastMember);

  const imdbId = details.imdb_id ?? null;
  let voteAverage = Number.isFinite(details.vote_average) ? details.vote_average : 0;

  if (imdbId) {
    const imdbRating = await getImdbRating(imdbId);
    if (imdbRating !== null && imdbRating > 0) {
      voteAverage = imdbRating;
    }
  }

  return {
    id: details.id,
    title: details.title,
    originalTitle: (details.original_language !== "en" && details.original_title !== details.title)
      ? details.original_title : undefined,
    overview: details.overview ?? "",
    runtimeMinutes: details.runtime,
    genres: details.genres.map((entry) => entry.name),
    genreIds: details.genres.map((entry) => entry.id),
    ageRating: details.adult ? "18+" : "6+",
    posterPath: details.poster_path,
    backdropPath: details.backdrop_path,
    voteAverage,
    voteCount: details.vote_count ?? 0,
    releaseDate: details.release_date ?? "",
    imdbId,
    collectionId: details.belongs_to_collection?.id ?? null,
    cast,
    directors: pickDirectorMembers(creditsResponse.data.crew ?? []),
    crew: pickKeyCrewMembers(creditsResponse.data.crew ?? [])
  };
}

export async function getSeriesDetails(id: string): Promise<SeriesDetails> {
  assertCredentials();

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

  return {
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

  const emptyRatings: ExternalRatings = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null,
    letterboxd: null
  };

  try {
    const imdbId = await getImdbId(movieId, seededImdbId);
    if (!imdbId) {
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

    return {
      imdb: imdbDisplay,
      rottenTomatoes: omdbRatings.rottenTomatoes,
      metacritic: omdbRatings.metacritic,
      letterboxd
    };
  } catch {
    return emptyRatings;
  }
}

export async function getSeriesExternalRatings(
  seriesId: string,
  seededImdbId?: string | null
): Promise<SeriesExternalRatings> {
  assertCredentials();

  const emptyRatings: SeriesExternalRatings = {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null
  };

  try {
    const imdbId = await getImdbIdForMedia("tv", seriesId, seededImdbId);
    if (!imdbId) {
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

    return {
      imdb: imdbDisplay,
      rottenTomatoes: omdbRatings.rottenTomatoes,
      metacritic: omdbRatings.metacritic
    };
  } catch {
    return emptyRatings;
  }
}

export async function getMovieSummary(id: number): Promise<MediaItem> {
  assertCredentials();
  const { data } = await tmdbClient.get<TmdbMediaRecord>(`/movie/${id}`);
  const item = normalizeMedia(data, "movie");
  const [enriched] = await enrichItemsWithImdbRatings([item]);
  return enriched;
}

export async function getSeriesSummary(id: number): Promise<MediaItem> {
  assertCredentials();
  const { data } = await tmdbClient.get<TmdbMediaRecord>(`/tv/${id}`);
  const item = normalizeMedia(data, "tv");
  const [enriched] = await enrichItemsWithImdbRatings([item]);
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

export async function getSmartSimilarMovies(movieId: string, details: MovieDetails): Promise<MediaItem[]> {
  assertCredentials();

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

  return finalizeSmartSimilarResults(scored, "movie");
}

export async function getSmartSimilarSeries(seriesId: string, details: SeriesDetails): Promise<MediaItem[]> {
  assertCredentials();

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

  return finalizeSmartSimilarResults(scored, "tv");
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
    tmdbClient.get<TmdbPersonMovieCreditsResponse>(`/person/${id}/movie_credits`)
  ]);

  const person = personResponse.data;

  // Combine cast and crew works
  const allWorks = [
    ...creditsResponse.data.cast,
    ...(creditsResponse.data.crew ?? [])
  ];

  // Deduplicate by ID and sort by popularity
  const seenIds = new Set<number>();
  const uniqueWorks = allWorks.filter(item => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });

  const knownForMovies = uniqueWorks
    .slice()
    .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0))
    .slice(0, 12)
    .map(normalizeMovieCredit);

  return {
    id: person.id,
    name: person.name,
    biography: person.biography ?? "",
    birthday: person.birthday,
    placeOfBirth: person.place_of_birth,
    knownForDepartment: person.known_for_department,
    popularity: person.popularity,
    profilePath: person.profile_path,
    knownForMovies: knownForMovies.filter(isQualityItem)
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

/**
 * Fetches the official YouTube trailer URL for a movie from TMDB.
 * Prioritizes: Official Trailer > any Trailer > Teaser.
 * Returns null if no YouTube trailer is found.
 */
export async function getMovieTrailerUrl(movieId: string): Promise<string | null> {
  assertCredentials();
  try {
    const { data } = await tmdbClient.get<TmdbVideosResponse>(`/movie/${movieId}/videos`);
    const videos = (data.results ?? []).filter((v) => v.site === "YouTube" && v.key);

    // Priority 1: Official Trailer
    const officialTrailer = videos.find((v) => v.type === "Trailer" && v.official);
    if (officialTrailer) return `https://www.youtube.com/watch?v=${officialTrailer.key}`;

    // Priority 2: Any Trailer
    const anyTrailer = videos.find((v) => v.type === "Trailer");
    if (anyTrailer) return `https://www.youtube.com/watch?v=${anyTrailer.key}`;

    // Priority 3: Teaser
    const teaser = videos.find((v) => v.type === "Teaser");
    if (teaser) return `https://www.youtube.com/watch?v=${teaser.key}`;

    return null;
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
  try {
    const { data } = await tmdbClient.get<TmdbVideosResponse>(`/tv/${seriesId}/videos`);
    const videos = (data.results ?? []).filter((v) => v.site === "YouTube" && v.key);

    // Priority 1: Official Trailer
    const officialTrailer = videos.find((v) => v.type === "Trailer" && v.official);
    if (officialTrailer) return `https://www.youtube.com/watch?v=${officialTrailer.key}`;

    // Priority 2: Any Trailer
    const anyTrailer = videos.find((v) => v.type === "Trailer");
    if (anyTrailer) return `https://www.youtube.com/watch?v=${anyTrailer.key}`;

    // Priority 3: Teaser
    const teaser = videos.find((v) => v.type === "Teaser");
    if (teaser) return `https://www.youtube.com/watch?v=${teaser.key}`;

    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Multi-Search (movies + TV)                                        */
/* ------------------------------------------------------------------ */

export async function searchMulti(
  query: string,
  page: number = 1
): Promise<PaginatedMediaResponse> {
  if (!query.trim()) {
    return { items: [], page: 1, totalPages: 0 };
  }

  const { data } = await tmdbClient.get<TmdbListResponse>("/search/multi", {
    params: { query: query.trim(), page, include_adult: false }
  });

  const filtered = data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((entry) => normalizeMedia(entry, entry.media_type ?? "movie"))
    .filter((item) => item.title !== "Untitled" && item.rating >= 6);

  const items = await enrichItemsWithImdbRatings(filtered);

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

let cachedMovieGenres: Genre[] | null = null;
let cachedTvGenres: Genre[] | null = null;

export async function getMovieGenres(): Promise<Genre[]> {
  if (cachedMovieGenres) return cachedMovieGenres;
  const { data } = await tmdbClient.get<{ genres: Genre[] }>("/genre/movie/list");
  cachedMovieGenres = data.genres;
  return data.genres;
}

export async function getTvGenres(): Promise<Genre[]> {
  if (cachedTvGenres) return cachedTvGenres;
  const { data } = await tmdbClient.get<{ genres: Genre[] }>("/genre/tv/list");
  cachedTvGenres = data.genres;
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


