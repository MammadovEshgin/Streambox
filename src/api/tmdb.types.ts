/**
 * Public type contracts for the TMDB API client.
 *
 * Lives separately from `tmdb.ts` because dozens of screens, services, and
 * hooks import these types — keeping them in their own file means consumers
 * pull a small types module, not the entire ~3k-line API client.
 *
 * The internal TmdbXxx response types (the raw JSON shapes returned by
 * TMDB / TVmaze / etc.) stay private to `tmdb.ts` — only the normalized
 * domain types (MediaItem, MovieDetails, SeriesDetails, …) live here.
 *
 * `tmdb.ts` re-exports everything from this file, so existing imports of the
 * form `import { MediaItem } from "../api/tmdb"` keep working unchanged.
 */

export type MediaType = "movie" | "tv";
export type CastGender = "male" | "female" | null;

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
