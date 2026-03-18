import AsyncStorage from "@react-native-async-storage/async-storage";

import { resolveAzClassicImageUri, warmAzClassicImageCache } from "../services/azClassicImageCache";
import { supabase } from "../services/supabase";

export const AZ_CLASSICS_CACHE_KEY = "@streambox/az-classics-cache";

export type AzClassicCastMember = {
  id: string;
  name: string;
  character: string | null;
  photoUrl: string | null;
  cachedPhotoUrl?: string | null;
  displayOrder: number;
};

export type AzClassicCrewMember = {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  cachedPhotoUrl?: string | null;
  displayOrder: number;
};

export type AzClassicMovie = {
  id: string;
  title: string;
  year: number;
  synopsis: string | null;
  genre: string | null;
  posterUrl: string | null;
  cachedPosterUrl?: string | null;
  videoId: string | null;
};

export type AzClassicMovieDetails = AzClassicMovie & {
  cast: AzClassicCastMember[];
  crew: AzClassicCrewMember[];
};

function stripCachedFieldsFromMovie(movie: AzClassicMovie): AzClassicMovie {
  const { cachedPosterUrl: _cachedPosterUrl, ...rest } = movie;
  return rest;
}

function normalizeCachedMovies(rawValue: string | null): AzClassicMovie[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((movie) => ({
        id: typeof movie.id === "string" ? movie.id : "",
        title: typeof movie.title === "string" ? movie.title : "Untitled",
        year: typeof movie.year === "number" ? movie.year : 0,
        synopsis: typeof movie.synopsis === "string" ? movie.synopsis : null,
        genre: typeof movie.genre === "string" ? movie.genre : null,
        posterUrl: typeof movie.posterUrl === "string"
          ? movie.posterUrl
          : typeof movie.poster_url === "string"
            ? movie.poster_url
            : null,
        videoId: typeof movie.videoId === "string"
          ? movie.videoId
          : typeof movie.video_id === "string"
            ? movie.video_id
            : null
      }))
      .filter((movie) => movie.id.length > 0);
  } catch {
    return [];
  }
}

async function fetchAzClassicsFromSupabase(): Promise<AzClassicMovie[]> {
  const { data, error } = await supabase
    .from("az_classic_movies")
    .select("id, title, year, synopsis, genre, poster_url, video_id")
    .order("title", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch Azerbaijan classics: ${error.message}`);
  }

  return (data || []).map((movie) => ({
    id: movie.id,
    title: movie.title,
    year: movie.year,
    synopsis: movie.synopsis,
    genre: movie.genre,
    posterUrl: movie.poster_url,
    videoId: movie.video_id
  }));
}

async function hydrateMoviePoster(movie: AzClassicMovie): Promise<AzClassicMovie> {
  return {
    ...movie,
    cachedPosterUrl: await resolveAzClassicImageUri(movie.posterUrl)
  };
}

async function hydrateMoviesPosters(movies: AzClassicMovie[]): Promise<AzClassicMovie[]> {
  const hydratedMovies = await Promise.all(movies.map((movie) => hydrateMoviePoster(movie)));
  void warmAzClassicImageCache(movies.map((movie) => movie.posterUrl));
  return hydratedMovies;
}

async function hydrateCastMember(member: AzClassicCastMember): Promise<AzClassicCastMember> {
  return {
    ...member,
    cachedPhotoUrl: await resolveAzClassicImageUri(member.photoUrl, 800)
  };
}

async function hydrateCrewMember(member: AzClassicCrewMember): Promise<AzClassicCrewMember> {
  return {
    ...member,
    cachedPhotoUrl: await resolveAzClassicImageUri(member.photoUrl, 800)
  };
}

export async function getAzClassicMovies(): Promise<AzClassicMovie[]> {
  try {
    const parsed = normalizeCachedMovies(await AsyncStorage.getItem(AZ_CLASSICS_CACHE_KEY));
    if (parsed.length > 0) {
      void fetchAzClassicsFromSupabase()
        .then(async (fresh) => {
          await AsyncStorage.setItem(
            AZ_CLASSICS_CACHE_KEY,
            JSON.stringify(fresh.map((movie) => stripCachedFieldsFromMovie(movie)))
          );
          await warmAzClassicImageCache(fresh.map((movie) => movie.posterUrl));
        })
        .catch(() => undefined);

      return hydrateMoviesPosters(parsed);
    }
  } catch {
    // Cache miss or corrupt, proceed to network.
  }

  const movies = await fetchAzClassicsFromSupabase();
  AsyncStorage.setItem(
    AZ_CLASSICS_CACHE_KEY,
    JSON.stringify(movies.map((movie) => stripCachedFieldsFromMovie(movie)))
  ).catch(() => undefined);
  return hydrateMoviesPosters(movies);
}

export async function getAzClassicMovieDetails(movieId: string): Promise<AzClassicMovieDetails> {
  const { data: movieData, error: movieError } = await supabase
    .from("az_classic_movies")
    .select("id, title, year, synopsis, genre, poster_url, video_id")
    .eq("id", movieId)
    .single();

  if (movieError || !movieData) {
    throw new Error(`Failed to fetch movie details: ${movieError?.message || "Movie not found"}`);
  }

  const { data: castData, error: castError } = await supabase
    .from("az_classic_cast")
    .select("id, name, character, photo_url, display_order")
    .eq("movie_id", movieId)
    .order("display_order", { ascending: true });

  if (castError) {
    throw new Error(`Failed to fetch cast: ${castError.message}`);
  }

  const { data: crewData, error: crewError } = await supabase
    .from("az_classic_crew")
    .select("id, name, role, photo_url, display_order")
    .eq("movie_id", movieId)
    .order("display_order", { ascending: true });

  if (crewError) {
    throw new Error(`Failed to fetch crew: ${crewError.message}`);
  }

  const cast = await Promise.all(
    (castData || []).map((member) =>
      hydrateCastMember({
        id: member.id,
        name: member.name,
        character: member.character,
        photoUrl: member.photo_url,
        displayOrder: member.display_order
      })
    )
  );

  const crew = await Promise.all(
    (crewData || []).map((member) =>
      hydrateCrewMember({
        id: member.id,
        name: member.name,
        role: member.role,
        photoUrl: member.photo_url,
        displayOrder: member.display_order
      })
    )
  );

  return {
    id: movieData.id,
    title: movieData.title,
    year: movieData.year,
    synopsis: movieData.synopsis,
    genre: movieData.genre,
    posterUrl: movieData.poster_url,
    cachedPosterUrl: await resolveAzClassicImageUri(movieData.poster_url),
    videoId: movieData.video_id,
    cast,
    crew
  };
}

export async function getSimilarAzClassicMovies(
  movieId: string,
  genreFilter?: string,
  castNames?: string[],
  crewNames?: string[]
): Promise<AzClassicMovie[]> {
  const { data: allMovies, error: moviesError } = await supabase
    .from("az_classic_movies")
    .select("id, title, year, synopsis, genre, poster_url, video_id")
    .neq("id", movieId);

  if (moviesError || !allMovies) {
    return [];
  }

  const { data: allCast, error: castError } = await supabase
    .from("az_classic_cast")
    .select("movie_id, name");

  const { data: allCrew, error: crewError } = await supabase
    .from("az_classic_crew")
    .select("movie_id, name, role");

  if (castError || crewError) {
    return [];
  }

  const castByMovie = new Map<string, string[]>();
  const crewByMovie = new Map<string, string[]>();

  allCast?.forEach((castMember) => {
    const list = castByMovie.get(castMember.movie_id) || [];
    list.push(castMember.name.toLowerCase());
    castByMovie.set(castMember.movie_id, list);
  });

  allCrew?.forEach((crewMember) => {
    const list = crewByMovie.get(crewMember.movie_id) || [];
    list.push(crewMember.name.toLowerCase());
    crewByMovie.set(crewMember.movie_id, list);
  });

  const targetGenre = genreFilter?.toLowerCase();
  const targetCast = castNames?.map((name) => name.toLowerCase()) || [];
  const targetCrew = crewNames?.map((name) => name.toLowerCase()) || [];

  const scoredMovies = allMovies
    .map((movie) => {
      let score = 0;

      if (targetGenre && movie.genre?.toLowerCase().includes(targetGenre)) {
        score += 3;
      }

      const movieCast = castByMovie.get(movie.id) || [];
      targetCast.forEach((name) => {
        if (movieCast.includes(name)) {
          score += 2;
        }
      });

      const movieCrew = crewByMovie.get(movie.id) || [];
      targetCrew.forEach((name) => {
        if (movieCrew.includes(name)) {
          score += 2.5;
        }
      });

      return {
        movie: {
          id: movie.id,
          title: movie.title,
          year: movie.year,
          synopsis: movie.synopsis,
          genre: movie.genre,
          posterUrl: movie.poster_url,
          videoId: movie.video_id
        },
        score
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((item) => item.movie);

  if (scoredMovies.length === 0) {
    return hydrateMoviesPosters(
      allMovies.slice(0, 10).map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        synopsis: movie.synopsis,
        genre: movie.genre,
        posterUrl: movie.poster_url,
        videoId: movie.video_id
      }))
    );
  }

  return hydrateMoviesPosters(scoredMovies);
}

export async function getAzClassicMovieSummary(movieId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("az_classic_movies")
    .select("id, title, year, synopsis, genre, poster_url, video_id")
    .eq("id", movieId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    posterPath: data.poster_url,
    backdropPath: null,
    mediaType: "movie",
    rating: 0,
    overview: data.synopsis || "",
    year: String(data.year),
    imdbId: `az-${data.id}`,
    genreIds: [],
  };
}
