import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  MediaItem,
  MovieTasteProfile,
  discoverMoviesForTaste,
  getMovieDetails,
  getMovieTasteProfile,
  getTrendingPage
} from "../api/tmdb";
import { enqueueDailyRecommendationSync } from "./userDataSync";

const CURRENT_MOVIE_KEY = "streambox/movie-of-day/current";
const MOVIE_HISTORY_KEY = "streambox/movie-of-day/history";
const PROFILE_MOVIE_LIMIT = 30;
const CANDIDATE_PROFILE_LIMIT = 36;
const CANDIDATE_DISCOVER_PAGES = 4;

type StoredMovieOfDay = {
  dateKey: string;
  movie: MediaItem | null;
};

type StoredHistory = {
  tmdbIds: number[];
  imdbIds: string[];
};

type TasteModel = {
  topGenres: number[];
  genreWeights: Map<number, number>;
  actorWeights: Map<number, number>;
  directorWeights: Map<number, number>;
  medianYear: number | null;
  minPreferredYear: number;
  recentRatio: number;
};

function getLocalDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeHistory(raw: string | null): StoredHistory {
  if (!raw) {
    return {
      tmdbIds: [],
      imdbIds: []
    };
  }

  try {
    const parsed = JSON.parse(raw) as StoredHistory;
    return {
      tmdbIds: Array.isArray(parsed.tmdbIds) ? parsed.tmdbIds.filter((id) => Number.isFinite(id)) : [],
      imdbIds: Array.isArray(parsed.imdbIds)
        ? parsed.imdbIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : []
    };
  } catch {
    return {
      tmdbIds: [],
      imdbIds: []
    };
  }
}

function normalizeCurrent(raw: string | null): StoredMovieOfDay | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredMovieOfDay;
    if (!parsed?.dateKey) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  return sorted[mid] ?? null;
}

function topKeys(map: Map<number, number>, limit: number): number[] {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([id]) => id);
}

function mergeUniqueMovies(existing: MediaItem[], incoming: MediaItem[]): MediaItem[] {
  const existingIds = new Set(existing.map((item) => item.id));
  const merged = existing.slice();

  incoming.forEach((item) => {
    if (!existingIds.has(item.id)) {
      existingIds.add(item.id);
      merged.push(item);
    }
  });

  return merged;
}

async function buildTasteModel(likedMovieIds: number[]): Promise<TasteModel | null> {
  if (likedMovieIds.length === 0) {
    return null;
  }

  const sampledIds = likedMovieIds.slice(0, PROFILE_MOVIE_LIMIT);
  const profiles = (
    await Promise.all(sampledIds.map((id) => getMovieTasteProfile(id)))
  ).filter((profile): profile is MovieTasteProfile => profile !== null);

  if (profiles.length === 0) {
    return null;
  }

  const genreWeights = new Map<number, number>();
  const actorWeights = new Map<number, number>();
  const directorWeights = new Map<number, number>();
  const years = profiles
    .map((profile) => profile.releaseYear)
    .filter((year): year is number => typeof year === "number" && Number.isFinite(year));
  const medianYear = median(years);

  profiles.forEach((profile) => {
    const ratingFactor = 0.8 + profile.rating / 10;

    profile.genreIds.forEach((genreId) => {
      genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + ratingFactor);
    });

    profile.castIds.slice(0, 5).forEach((actorId, index) => {
      const positionalWeight = Math.max(0.5, 1.3 - index * 0.2);
      actorWeights.set(actorId, (actorWeights.get(actorId) ?? 0) + ratingFactor * positionalWeight);
    });

    profile.directorIds.forEach((directorId) => {
      directorWeights.set(directorId, (directorWeights.get(directorId) ?? 0) + ratingFactor * 1.5);
    });
  });

  const recentCount = years.filter((year) => year >= 2000).length;
  const recentRatio = years.length > 0 ? recentCount / years.length : 0;
  const minPreferredYear = recentRatio >= 0.6 ? Math.max(2000, (medianYear ?? 2005) - 6) : Math.max(1985, (medianYear ?? 2000) - 18);

  return {
    topGenres: topKeys(genreWeights, 3),
    genreWeights,
    actorWeights,
    directorWeights,
    medianYear,
    minPreferredYear,
    recentRatio
  };
}

function scoreCandidate(candidate: MovieTasteProfile, model: TasteModel): number {
  const genreScore = candidate.genreIds.reduce((total, genreId) => total + (model.genreWeights.get(genreId) ?? 0), 0);
  const actorOverlap = candidate.castIds.reduce((total, actorId) => total + (model.actorWeights.get(actorId) ?? 0), 0);
  const directorOverlap = candidate.directorIds.reduce(
    (total, directorId) => total + (model.directorWeights.get(directorId) ?? 0),
    0
  );

  const ratingScore = candidate.rating * 5.5;
  const popularityScore = Math.min(10, Math.log10(candidate.popularity + 1) * 4);

  let yearScore = 0;
  if (candidate.releaseYear && model.medianYear) {
    const distance = Math.abs(candidate.releaseYear - model.medianYear);
    yearScore += Math.max(-12, 14 - distance * 1.5);
  }

  if (model.recentRatio >= 0.6 && candidate.releaseYear && candidate.releaseYear < model.minPreferredYear) {
    yearScore -= 24;
  }

  const actorDirectorSynergy = actorOverlap > 0 && directorOverlap > 0 ? 8 : 0;

  return ratingScore + popularityScore + genreScore * 1.9 + actorOverlap * 2.2 + directorOverlap * 2.8 + yearScore + actorDirectorSynergy;
}

async function pickFromPersonalizedCandidates(
  likedMovieIds: number[],
  historyTmdbIds: Set<number>,
  historyImdbIds: Set<string>
): Promise<MediaItem | null> {
  const model = await buildTasteModel(likedMovieIds);
  if (!model) {
    return null;
  }

  let candidates: MediaItem[] = [];
  for (let page = 1; page <= CANDIDATE_DISCOVER_PAGES; page += 1) {
    const response = await discoverMoviesForTaste(page, {
      genreIds: model.topGenres,
      minYear: model.minPreferredYear
    });
    candidates = mergeUniqueMovies(candidates, response.items);
  }

  const likedSet = new Set(likedMovieIds);
  const filteredCandidates = candidates.filter((candidate) => {
    if (likedSet.has(candidate.id as number)) {
      return false;
    }
    if (historyTmdbIds.has(candidate.id as number)) {
      return false;
    }
    if (candidate.imdbId && historyImdbIds.has(candidate.imdbId)) {
      return false;
    }
    return true;
  });

  if (filteredCandidates.length === 0) {
    return null;
  }

  const candidateProfiles = (
    await Promise.all(filteredCandidates.slice(0, CANDIDATE_PROFILE_LIMIT).map((candidate) => getMovieTasteProfile(candidate.id as number)))
  ).filter((profile): profile is MovieTasteProfile => profile !== null);

  if (candidateProfiles.length === 0) {
    return filteredCandidates[0] ?? null;
  }

  const candidateProfileById = new Map(candidateProfiles.map((profile) => [profile.id, profile]));

  const scored = filteredCandidates
    .slice(0, CANDIDATE_PROFILE_LIMIT)
    .map((candidate) => {
      const profile = candidateProfileById.get(candidate.id as number);
      if (!profile) {
        return {
          candidate,
          score: -1000
        };
      }

      return {
        candidate: {
          ...candidate,
          imdbId: profile.imdbId
        },
        score: scoreCandidate(profile, model)
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.candidate ?? null;
}

async function pickFallbackMovie(historyTmdbIds: Set<number>, historyImdbIds: Set<string>): Promise<MediaItem | null> {
  let pool: MediaItem[] = [];

  for (let page = 1; page <= 3; page += 1) {
    const response = await getTrendingPage("movie", page);
    pool = mergeUniqueMovies(pool, response.items);
  }

  const unseen = pool.filter((movie) => {
    if (historyTmdbIds.has(movie.id as number)) {
      return false;
    }

    if (movie.imdbId && historyImdbIds.has(movie.imdbId)) {
      return false;
    }

    return true;
  });

  if (unseen.length > 0) {
    return unseen.sort((left, right) => right.rating - left.rating)[0] ?? null;
  }

  return null;
}

async function persistCurrentMovie(dateKey: string, movie: MediaItem | null) {
  const payload: StoredMovieOfDay = {
    dateKey,
    movie
  };
  await AsyncStorage.setItem(CURRENT_MOVIE_KEY, JSON.stringify(payload));
}

async function hydrateMovieGenres(movie: MediaItem | null): Promise<MediaItem | null> {
  if (!movie) {
    return null;
  }

  if (Array.isArray(movie.genreIds) && movie.genreIds.length > 0) {
    return movie;
  }

  try {
    const details = await getMovieDetails(String(movie.id));
    return {
      ...movie,
      genreIds: details.genreIds,
      imdbId: movie.imdbId ?? details.imdbId ?? null
    };
  } catch {
    return movie;
  }
}

async function persistDailyPick(dateKey: string, movie: MediaItem | null) {
  await persistCurrentMovie(dateKey, movie);
  if (movie) {
    await enqueueDailyRecommendationSync(movie as unknown as Record<string, unknown>, dateKey);
  }
}

async function persistHistory(movie: MediaItem, history: StoredHistory) {
  const nextTmdbIds = history.tmdbIds.includes(movie.id as number) ? history.tmdbIds : [...history.tmdbIds, movie.id as number];
  const nextImdbIds =
    movie.imdbId && !history.imdbIds.includes(movie.imdbId) ? [...history.imdbIds, movie.imdbId] : history.imdbIds;

  await AsyncStorage.setItem(
    MOVIE_HISTORY_KEY,
    JSON.stringify({
      tmdbIds: nextTmdbIds,
      imdbIds: nextImdbIds
    } satisfies StoredHistory)
  );
}

export async function getPersonalizedMovieOfTheDay(likedMovieIds: number[]): Promise<MediaItem | null> {
  const dateKey = getLocalDateKey();
  const [storedCurrentRaw, historyRaw] = await Promise.all([
    AsyncStorage.getItem(CURRENT_MOVIE_KEY),
    AsyncStorage.getItem(MOVIE_HISTORY_KEY)
  ]);

  const current = normalizeCurrent(storedCurrentRaw);
  if (current?.dateKey === dateKey) {
    const hydratedCurrent = await hydrateMovieGenres(current.movie);
    if (hydratedCurrent !== current.movie) {
      await persistCurrentMovie(dateKey, hydratedCurrent);
    }
    return hydratedCurrent;
  }

  const history = normalizeHistory(historyRaw);
  const historyTmdbIds = new Set(history.tmdbIds);
  const historyImdbIds = new Set(history.imdbIds);

  const personalized = await pickFromPersonalizedCandidates(likedMovieIds, historyTmdbIds, historyImdbIds);
  const fallback = personalized ?? (await pickFallbackMovie(historyTmdbIds, historyImdbIds));

  const hydratedFallback = await hydrateMovieGenres(fallback);
  await persistDailyPick(dateKey, hydratedFallback);
  if (hydratedFallback) {
    await persistHistory(hydratedFallback, history);
  }

  return hydratedFallback;
}


