import axios from "axios";

// ── Types ──────────────────────────────────────────────────────────────

type ImdbTop250MovieEntry = {
  Rank: string;
  "Movie Name": string;
  "IMDb Rating": string;
  "Movie Link": string;
};

type ImdbTop250ShowEntry = {
  Rank: string;
  "Show Name": string;
  "IMDb Rating": string;
  "Show Link": string;
};

export type ImdbTop250Item = {
  rank: number;
  title: string;
  imdbId: string;
  imdbRating: number;
};

type ImdbApiTitleResponse = {
  id: string;
  rating?: {
    aggregateRating: number;
    voteCount: number;
  };
};

// ── Constants ──────────────────────────────────────────────────────────

const GITHUB_TOP250_MOVIES_URL =
  "https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/movies.json";

const GITHUB_TOP250_SHOWS_URL =
  "https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/shows.json";

const IMDBAPI_BASE_URL = "https://api.imdbapi.dev";

const GITHUB_FETCH_TIMEOUT = 15_000;
const IMDBAPI_FETCH_TIMEOUT = 8_000;

// ── Caches ─────────────────────────────────────────────────────────────

let cachedTop250Movies: ImdbTop250Item[] | null = null;
let cachedTop250Shows: ImdbTop250Item[] | null = null;
let moviesLastFetch = 0;
let showsLastFetch = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const imdbRatingCache = new Map<string, number | null>();
const inFlightImdbRatingRequests = new Map<string, Promise<number | null>>();

// ── IMDb ID Extraction ─────────────────────────────────────────────────

function extractImdbId(link: string): string | null {
  const match = link.match(/\/(tt\d+)/);
  return match?.[1] ?? null;
}

// ── GitHub JSON: Top 250 Lists ─────────────────────────────────────────

function parseMovieEntry(entry: ImdbTop250MovieEntry): ImdbTop250Item | null {
  const imdbId = extractImdbId(entry["Movie Link"]);
  if (!imdbId) return null;

  return {
    rank: parseInt(entry.Rank, 10),
    title: decodeHtmlEntities(entry["Movie Name"]),
    imdbId,
    imdbRating: parseFloat(entry["IMDb Rating"]) || 0,
  };
}

function parseShowEntry(entry: ImdbTop250ShowEntry): ImdbTop250Item | null {
  const imdbId = extractImdbId(entry["Show Link"]);
  if (!imdbId) return null;

  return {
    rank: parseInt(entry.Rank, 10),
    title: decodeHtmlEntities(entry["Show Name"]),
    imdbId,
    imdbRating: parseFloat(entry["IMDb Rating"]) || 0,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function getImdbTop250Movies(): Promise<ImdbTop250Item[]> {
  const now = Date.now();
  if (cachedTop250Movies && now - moviesLastFetch < CACHE_TTL_MS) {
    return cachedTop250Movies;
  }

  try {
    const { data } = await axios.get<ImdbTop250MovieEntry[]>(GITHUB_TOP250_MOVIES_URL, {
      timeout: GITHUB_FETCH_TIMEOUT,
    });

    const items = data
      .map(parseMovieEntry)
      .filter((item): item is ImdbTop250Item => item !== null);

    cachedTop250Movies = items;
    moviesLastFetch = now;
    return items;
  } catch {
    return cachedTop250Movies ?? [];
  }
}

export async function getImdbTop250Shows(): Promise<ImdbTop250Item[]> {
  const now = Date.now();
  if (cachedTop250Shows && now - showsLastFetch < CACHE_TTL_MS) {
    return cachedTop250Shows;
  }

  try {
    const { data } = await axios.get<ImdbTop250ShowEntry[]>(GITHUB_TOP250_SHOWS_URL, {
      timeout: GITHUB_FETCH_TIMEOUT,
    });

    const items = data
      .map(parseShowEntry)
      .filter((item): item is ImdbTop250Item => item !== null);

    cachedTop250Shows = items;
    showsLastFetch = now;
    return items;
  } catch {
    return cachedTop250Shows ?? [];
  }
}

// ── imdbapi.dev: Individual IMDb Ratings ───────────────────────────────

export async function getImdbRating(imdbId: string): Promise<number | null> {
  if (!imdbId || !imdbId.startsWith("tt")) return null;

  if (imdbRatingCache.has(imdbId)) {
    return imdbRatingCache.get(imdbId) ?? null;
  }

  const existing = inFlightImdbRatingRequests.get(imdbId);
  if (existing) return existing;

  const request = (async (): Promise<number | null> => {
    try {
      const { data } = await axios.get<ImdbApiTitleResponse>(
        `${IMDBAPI_BASE_URL}/titles/${imdbId}`,
        { timeout: IMDBAPI_FETCH_TIMEOUT },
      );

      const rating = data.rating?.aggregateRating ?? null;
      imdbRatingCache.set(imdbId, rating);
      return rating;
    } catch {
      imdbRatingCache.set(imdbId, null);
      return null;
    } finally {
      inFlightImdbRatingRequests.delete(imdbId);
    }
  })();

  inFlightImdbRatingRequests.set(imdbId, request);
  return request;
}

/**
 * Seed the rating cache with a known IMDb rating value
 * (e.g. from the Top 250 JSON where we already have the rating).
 */
export function seedImdbRatingCache(imdbId: string, rating: number): void {
  imdbRatingCache.set(imdbId, rating);
}
