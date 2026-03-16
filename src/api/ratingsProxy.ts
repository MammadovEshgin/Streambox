import axios from "axios";

type CachedOmdbRatings = {
  imdb: string | null;
  rottenTomatoes: string | null;
  metacritic: string | null;
};

type RatingsFunctionResponse = {
  ratings?: CachedOmdbRatings;
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ratingsFunctionName = process.env.EXPO_PUBLIC_SUPABASE_RATINGS_FUNCTION_NAME?.trim() || "external-ratings";
const ratingsFunctionUrl = supabaseUrl
  ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${ratingsFunctionName}`
  : null;
const inFlightRatingsRequests = new Map<string, Promise<CachedOmdbRatings | null>>();

function normalizeRatings(payload?: CachedOmdbRatings): CachedOmdbRatings {
  return {
    imdb: payload?.imdb ?? null,
    rottenTomatoes: payload?.rottenTomatoes ?? null,
    metacritic: payload?.metacritic ?? null,
  };
}

export async function getCachedOmdbRatings(imdbId: string): Promise<CachedOmdbRatings | null> {
  const normalizedImdbId = imdbId.trim();
  if (!ratingsFunctionUrl || !supabaseAnonKey || !normalizedImdbId) {
    return null;
  }

  const existingRequest = inFlightRatingsRequests.get(normalizedImdbId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const response = await axios.post<RatingsFunctionResponse>(
        ratingsFunctionUrl,
        { imdbId: normalizedImdbId },
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
        },
      );

      return normalizeRatings(response.data.ratings);
    } catch {
      return null;
    } finally {
      inFlightRatingsRequests.delete(normalizedImdbId);
    }
  })();

  inFlightRatingsRequests.set(normalizedImdbId, request);
  return request;
}
