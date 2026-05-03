import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  MediaItem,
  MovieTasteProfile,
  SeriesDetails,
  discoverMoviesForTaste,
  getMovieDetails,
  getMovieSummary,
  getMovieTasteProfile,
  getSeriesDetails,
  getSeriesSummary,
  getTopNewSeriesPage,
  getTrendingPage,
  resolveTmdbMovieIdFromImdbId,
  resolveTmdbTvIdFromImdbId,
} from "../api/tmdb";
import { getImdbTop250Movies, getImdbTop250Shows, type ImdbTop250Item } from "../api/imdb";
import i18n from "../localization/i18n";
import { normalizeAppLanguage } from "../localization/types";
import { enqueueDailyRecommendationSync } from "./userDataSync";

const CURRENT_MOVIE_KEY = "streambox/movie-of-day/current";
const CURRENT_SERIES_KEY = "streambox/series-of-day/current";
const PROFILE_MEDIA_LIMIT = 30;
const CANDIDATE_PROFILE_LIMIT = 36;
const MOVIE_CANDIDATE_DISCOVER_PAGES = 4;
const SERIES_CANDIDATE_PAGES = 2;
const TOP_SCORING_SLICE = 6;
const IMDB_TOP_FALLBACK_LIMIT = 100;

type StoredDailyPick = {
  dateKey: string;
  media: MediaItem | null;
  language: string;
  personalizationKey: string;
};

type DailyPickOptions = {
  userId?: string | null;
  likedIds: readonly (number | string)[];
  watchedIds?: readonly (number | string)[];
};

type ScoredMediaCandidate = {
  candidate: MediaItem;
  score: number;
};

type SeriesTasteModel = {
  topGenres: number[];
  genreWeights: Map<number, number>;
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

function normalizeIds(values: readonly (number | string)[] | undefined): number[] {
  if (!values) {
    return [];
  }

  const next = new Set<number>();
  values.forEach((value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      next.add(value);
      return;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      next.add(Number.parseInt(value, 10));
    }
  });

  return [...next];
}

function normalizeCurrent(raw: string | null): StoredDailyPick | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredDailyPick;
    if (!parsed?.dateKey) {
      return null;
    }

    return {
      dateKey: parsed.dateKey,
      media: parsed.media ?? null,
      language: typeof parsed.language === "string" ? parsed.language : "en",
      personalizationKey:
        typeof parsed.personalizationKey === "string" ? parsed.personalizationKey : "legacy",
    };
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

function mergeUniqueMedia(existing: MediaItem[], incoming: MediaItem[]): MediaItem[] {
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

function hashString(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createPersonalizationKey(
  mediaType: "movie" | "tv",
  userId: string | null | undefined,
  sourceIds: readonly number[]
): string {
  const normalizedUserId = userId?.trim() || "anonymous";
  const normalizedIds = [...sourceIds].sort((left, right) => left - right);
  return `${mediaType}:${normalizedUserId}:${normalizedIds.join(",")}`;
}

function pickSeededIndex(length: number, seed: string): number {
  if (length <= 1) {
    return 0;
  }

  return hashString(seed) % length;
}

function pickFromScoredCandidates(
  scored: ScoredMediaCandidate[],
  seed: string
): MediaItem | null {
  if (scored.length === 0) {
    return null;
  }

  const shortlist = scored.slice(0, Math.min(TOP_SCORING_SLICE, scored.length));
  return shortlist[pickSeededIndex(shortlist.length, seed)]?.candidate ?? scored[0]?.candidate ?? null;
}

async function persistCurrentPick(
  storageKey: string,
  dateKey: string,
  media: MediaItem | null,
  language: string,
  personalizationKey: string
) {
  const payload: StoredDailyPick = {
    dateKey,
    media,
    language,
    personalizationKey,
  };
  await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
}

async function refreshMediaForActiveLanguage(
  mediaType: "movie" | "tv",
  media: MediaItem | null
): Promise<MediaItem | null> {
  if (!media || typeof media.id !== "number") {
    return media;
  }

  try {
    return mediaType === "movie"
      ? await getMovieSummary(media.id)
      : await getSeriesSummary(media.id);
  } catch {
    return media;
  }
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
      imdbId: movie.imdbId ?? details.imdbId ?? null,
    };
  } catch {
    return movie;
  }
}

async function persistMoviePick(
  dateKey: string,
  movie: MediaItem | null,
  personalizationKey: string
) {
  const currentLanguage = normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  await persistCurrentPick(CURRENT_MOVIE_KEY, dateKey, movie, currentLanguage, personalizationKey);
  if (movie) {
    await enqueueDailyRecommendationSync(movie as unknown as Record<string, unknown>, dateKey);
  }
}

async function readStoredLocalizedPick(
  storageKey: string,
  mediaType: "movie" | "tv",
  dateKey: string,
  personalizationKey: string
): Promise<MediaItem | null> {
  const currentLanguage = normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  const storedRaw = await AsyncStorage.getItem(storageKey);
  const stored = normalizeCurrent(storedRaw);

  if (
    !stored ||
    stored.dateKey !== dateKey ||
    stored.personalizationKey !== personalizationKey
  ) {
    return null;
  }

  const localizedMedia =
    stored.language === currentLanguage
      ? stored.media
      : await refreshMediaForActiveLanguage(mediaType, stored.media);

  const nextMedia =
    mediaType === "movie"
      ? await hydrateMovieGenres(localizedMedia)
      : localizedMedia;

  if (nextMedia !== stored.media || stored.language !== currentLanguage) {
    await persistCurrentPick(storageKey, dateKey, nextMedia, currentLanguage, personalizationKey);
  }

  return nextMedia;
}

async function buildMovieTasteModel(sourceMovieIds: number[]): Promise<MovieTasteProfile[] | null> {
  if (sourceMovieIds.length === 0) {
    return null;
  }

  const sampledIds = sourceMovieIds.slice(0, PROFILE_MEDIA_LIMIT);
  const profiles = (
    await Promise.all(sampledIds.map((id) => getMovieTasteProfile(id)))
  ).filter((profile): profile is MovieTasteProfile => profile !== null);

  return profiles.length > 0 ? profiles : null;
}

function buildMoviePreferenceModel(profiles: MovieTasteProfile[]) {
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
  const minPreferredYear =
    recentRatio >= 0.6
      ? Math.max(2000, (medianYear ?? 2005) - 6)
      : Math.max(1985, (medianYear ?? 2000) - 18);

  return {
    topGenres: topKeys(genreWeights, 3),
    genreWeights,
    actorWeights,
    directorWeights,
    medianYear,
    minPreferredYear,
    recentRatio,
  };
}

function scoreMovieCandidate(
  candidate: MovieTasteProfile,
  model: ReturnType<typeof buildMoviePreferenceModel>
): number {
  const genreScore = candidate.genreIds.reduce(
    (total, genreId) => total + (model.genreWeights.get(genreId) ?? 0),
    0
  );
  const actorOverlap = candidate.castIds.reduce(
    (total, actorId) => total + (model.actorWeights.get(actorId) ?? 0),
    0
  );
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

  if (
    model.recentRatio >= 0.6 &&
    candidate.releaseYear &&
    candidate.releaseYear < model.minPreferredYear
  ) {
    yearScore -= 24;
  }

  const actorDirectorSynergy = actorOverlap > 0 && directorOverlap > 0 ? 8 : 0;

  return (
    ratingScore +
    popularityScore +
    genreScore * 1.9 +
    actorOverlap * 2.2 +
    directorOverlap * 2.8 +
    yearScore +
    actorDirectorSynergy
  );
}

async function pickPersonalizedMovie(
  sourceMovieIds: number[],
  userId: string | null | undefined,
  dateKey: string
): Promise<MediaItem | null> {
  const profiles = await buildMovieTasteModel(sourceMovieIds);
  if (!profiles) {
    return null;
  }

  const model = buildMoviePreferenceModel(profiles);
  let candidates: MediaItem[] = [];
  for (let page = 1; page <= MOVIE_CANDIDATE_DISCOVER_PAGES; page += 1) {
    const response = await discoverMoviesForTaste(page, {
      genreIds: model.topGenres,
      minYear: model.minPreferredYear,
    });
    candidates = mergeUniqueMedia(candidates, response.items);
  }

  const sourceSet = new Set(sourceMovieIds);
  const filteredCandidates = candidates.filter(
    (candidate) => typeof candidate.id === "number" && !sourceSet.has(candidate.id)
  );

  if (filteredCandidates.length === 0) {
    return null;
  }

  const candidateProfiles = (
    await Promise.all(
      filteredCandidates
        .slice(0, CANDIDATE_PROFILE_LIMIT)
        .map((candidate) => getMovieTasteProfile(candidate.id as number))
    )
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
        return { candidate, score: -1000 };
      }

      return {
        candidate: {
          ...candidate,
          imdbId: profile.imdbId,
        },
        score: scoreMovieCandidate(profile, model),
      };
    })
    .sort((left, right) => right.score - left.score);

  return pickFromScoredCandidates(scored, `movie:${userId ?? "anonymous"}:${dateKey}`);
}

function parseYear(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function buildSeriesTasteModel(sourceSeriesIds: number[]): Promise<SeriesTasteModel | null> {
  if (sourceSeriesIds.length === 0) {
    return null;
  }

  const sampledIds = sourceSeriesIds.slice(0, PROFILE_MEDIA_LIMIT);
  const details = (
    await Promise.all(sampledIds.map((id) => getSeriesDetails(String(id)).catch(() => null)))
  ).filter((entry): entry is SeriesDetails => entry !== null);

  if (details.length === 0) {
    return null;
  }

  const genreWeights = new Map<number, number>();
  const years = details
    .map((entry) => parseYear(entry.firstAirDate ? entry.firstAirDate.slice(0, 4) : ""))
    .filter((year): year is number => year !== null);
  const medianYear = median(years);

  details.forEach((entry) => {
    const ratingFactor = 0.8 + entry.voteAverage / 10;
    entry.genreIds.forEach((genreId) => {
      genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + ratingFactor);
    });
  });

  const recentCount = years.filter((year) => year >= 2015).length;
  const recentRatio = years.length > 0 ? recentCount / years.length : 0;
  const minPreferredYear =
    recentRatio >= 0.6
      ? Math.max(2010, (medianYear ?? 2016) - 4)
      : Math.max(2000, (medianYear ?? 2012) - 10);

  return {
    topGenres: topKeys(genreWeights, 3),
    genreWeights,
    medianYear,
    minPreferredYear,
    recentRatio,
  };
}

function scoreSeriesCandidate(candidate: MediaItem, model: SeriesTasteModel): number {
  const genreScore = (candidate.genreIds ?? []).reduce(
    (total, genreId) => total + (model.genreWeights.get(genreId) ?? 0),
    0
  );

  const ratingScore = candidate.rating * 6.2;
  const releaseYear = parseYear(candidate.year);
  let yearScore = 0;

  if (releaseYear && model.medianYear) {
    const distance = Math.abs(releaseYear - model.medianYear);
    yearScore += Math.max(-10, 12 - distance * 1.2);
  }

  if (model.recentRatio >= 0.6 && releaseYear && releaseYear < model.minPreferredYear) {
    yearScore -= 18;
  }

  return ratingScore + genreScore * 2.4 + yearScore;
}

async function buildSeriesCandidatePool(): Promise<MediaItem[]> {
  let candidates: MediaItem[] = [];

  for (let page = 1; page <= SERIES_CANDIDATE_PAGES; page += 1) {
    const [topNew, trending] = await Promise.all([
      getTopNewSeriesPage(page),
      getTrendingPage("tv", page),
    ]);
    candidates = mergeUniqueMedia(candidates, topNew.items);
    candidates = mergeUniqueMedia(candidates, trending.items);
  }

  return candidates;
}

async function pickPersonalizedSeries(
  sourceSeriesIds: number[],
  userId: string | null | undefined,
  dateKey: string
): Promise<MediaItem | null> {
  const model = await buildSeriesTasteModel(sourceSeriesIds);
  if (!model) {
    return null;
  }

  const sourceSet = new Set(sourceSeriesIds);
  const candidates = (await buildSeriesCandidatePool()).filter(
    (candidate) => typeof candidate.id === "number" && !sourceSet.has(candidate.id)
  );

  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreSeriesCandidate(candidate, model),
    }))
    .sort((left, right) => right.score - left.score);

  return pickFromScoredCandidates(scored, `series:${userId ?? "anonymous"}:${dateKey}`);
}

async function resolveImdbFallback(
  entries: ImdbTop250Item[],
  dateKey: string,
  userId: string | null | undefined,
  mediaType: "movie" | "tv",
  excludeTmdbIds: Set<number>
): Promise<MediaItem | null> {
  const pool = entries.slice(0, IMDB_TOP_FALLBACK_LIMIT);
  if (pool.length === 0) {
    return null;
  }

  const startIndex = pickSeededIndex(
    pool.length,
    `${mediaType}:${userId ?? "anonymous"}:${dateKey}`
  );

  for (let offset = 0; offset < pool.length; offset += 1) {
    const entry = pool[(startIndex + offset) % pool.length];
    if (!entry) {
      continue;
    }

    try {
      const resolvedId =
        mediaType === "movie"
          ? await resolveTmdbMovieIdFromImdbId(entry.imdbId)
          : await resolveTmdbTvIdFromImdbId(entry.imdbId);

      if (!resolvedId) {
        continue;
      }

      const numericId = Number.parseInt(resolvedId, 10);
      if (!Number.isFinite(numericId) || excludeTmdbIds.has(numericId)) {
        continue;
      }

      const media =
        mediaType === "movie"
          ? await getMovieSummary(numericId)
          : await getSeriesSummary(numericId);

      return {
        ...media,
        imdbId: media.imdbId ?? entry.imdbId,
        rating: media.rating > 0 ? media.rating : entry.imdbRating,
      };
    } catch {
      // Try the next IMDb fallback item.
    }
  }

  return null;
}

export async function getPersonalizedMovieOfTheDay({
  userId,
  likedIds,
  watchedIds = [],
}: DailyPickOptions): Promise<MediaItem | null> {
  const dateKey = getLocalDateKey();
  const currentLanguage = normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  const sourceMovieIds = Array.from(new Set([...normalizeIds(likedIds), ...normalizeIds(watchedIds)]));
  const personalizationKey = createPersonalizationKey("movie", userId, sourceMovieIds);

  const stored = await readStoredLocalizedPick(
    CURRENT_MOVIE_KEY,
    "movie",
    dateKey,
    personalizationKey
  );
  if (stored) {
    return stored;
  }

  const personalized = await pickPersonalizedMovie(sourceMovieIds, userId, dateKey);
  const fallback = personalized
    ?? (await resolveImdbFallback(
      await getImdbTop250Movies(),
      dateKey,
      userId,
      "movie",
      new Set(sourceMovieIds)
    ));

  const hydrated = await hydrateMovieGenres(fallback);
  await persistCurrentPick(CURRENT_MOVIE_KEY, dateKey, hydrated, currentLanguage, personalizationKey);
  if (hydrated) {
    await enqueueDailyRecommendationSync(hydrated as unknown as Record<string, unknown>, dateKey);
  }

  return hydrated;
}

export async function getPersonalizedSeriesOfTheDay({
  userId,
  likedIds,
  watchedIds = [],
}: DailyPickOptions): Promise<MediaItem | null> {
  const dateKey = getLocalDateKey();
  const currentLanguage = normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  const sourceSeriesIds = Array.from(new Set([...normalizeIds(likedIds), ...normalizeIds(watchedIds)]));
  const personalizationKey = createPersonalizationKey("tv", userId, sourceSeriesIds);

  const stored = await readStoredLocalizedPick(
    CURRENT_SERIES_KEY,
    "tv",
    dateKey,
    personalizationKey
  );
  if (stored) {
    return stored;
  }

  const personalized = await pickPersonalizedSeries(sourceSeriesIds, userId, dateKey);
  const fallback = personalized
    ?? (await resolveImdbFallback(
      await getImdbTop250Shows(),
      dateKey,
      userId,
      "tv",
      new Set(sourceSeriesIds)
    ));

  await persistCurrentPick(
    CURRENT_SERIES_KEY,
    dateKey,
    fallback,
    currentLanguage,
    personalizationKey
  );
  return fallback;
}
