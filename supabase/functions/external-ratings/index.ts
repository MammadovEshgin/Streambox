import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const CACHE_TABLE = "external_ratings_cache";
export const LOG_TABLE = "external_ratings_function_logs";

const HOT_TITLE_TTL_HOURS = 24;
const RECENT_RELEASE_TTL_DAYS = 7;
const MODERN_CATALOG_TTL_DAYS = 21;
const DEEP_CATALOG_TTL_DAYS = 45;
const NEGATIVE_TTL_DAYS = 3;
const HOT_ACCESS_THRESHOLD = 10;
const WARM_ACCESS_THRESHOLD = 3;
const HOT_ACCESS_WINDOW_DAYS = 7;
const WARM_ACCESS_WINDOW_DAYS = 21;

export type RatingsPayload = {
  imdb: string | null;
  rottenTomatoes: string | null;
  metacritic: string | null;
};

export type CacheStatus = "cold" | "warm" | "hot" | "negative";

export type CachedRow = {
  imdb_id: string;
  imdb_rating: string | null;
  rotten_tomatoes: string | null;
  metacritic: string | null;
  raw_payload: unknown;
  fetched_at: string;
  expires_at: string;
  last_accessed_at: string;
  last_error: string | null;
  access_count: number;
  refresh_count: number;
  last_status: CacheStatus | null;
  last_refreshed_by: string | null;
  release_year: number | null;
};

type OmdbRatingRecord = {
  Source: string;
  Value: string;
};

type OmdbResponse = {
  Response?: "True" | "False";
  Year?: string;
  imdbRating?: string;
  Metascore?: string;
  Ratings?: OmdbRatingRecord[];
  Error?: string;
};

type LogEventInput = {
  functionName: string;
  eventType: string;
  statusCode: number;
  imdbId?: string | null;
  cacheSource?: string | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

type RefreshRatingsInput = {
  supabase: ReturnType<typeof createServerClient>;
  imdbId: string;
  omdbApiKey: string;
  trigger: "request" | "schedule";
  incrementAccess: boolean;
  touchedAtIso?: string;
};

type RefreshRatingsResult = {
  source: "omdb" | "stale-cache" | "error";
  row?: CachedRow;
  ratings: RatingsPayload;
  warning?: string;
};

function hoursToMs(hours: number) {
  return hours * 60 * 60 * 1000;
}

function daysToMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

export function emptyRatings(): RatingsPayload {
  return {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null,
  };
}

export function isValidImdbId(imdbId: string) {
  return /^tt\d+$/.test(imdbId);
}

export function createServerClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase server secrets.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getOmdbApiKey() {
  const omdbApiKey = Deno.env.get("OMDB_API_KEY");
  if (!omdbApiKey) {
    throw new Error("Missing OMDb server secret.");
  }

  return omdbApiKey;
}

function normalizeExternalRating(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.toUpperCase() === "N/A") {
    return null;
  }

  return normalized;
}

function formatMetascore(value: string | null | undefined): string | null {
  const normalized = normalizeExternalRating(value);
  if (!normalized) {
    return null;
  }

  return /^\d+$/.test(normalized) ? `${normalized}/100` : normalized;
}

export function normalizeOmdbRatings(data: OmdbResponse): RatingsPayload {
  if (data.Response !== "True") {
    return emptyRatings();
  }

  const imdbRatingFromList =
    data.Ratings?.find((entry) => entry.Source === "Internet Movie Database")?.Value ?? null;
  const rottenTomatoes = data.Ratings?.find((entry) => entry.Source === "Rotten Tomatoes")?.Value ?? null;
  const imdbFromPrimaryField =
    normalizeExternalRating(data.imdbRating) && data.imdbRating !== "N/A" ? `${data.imdbRating}/10` : null;

  return {
    imdb: normalizeExternalRating(imdbRatingFromList) ?? imdbFromPrimaryField,
    rottenTomatoes: normalizeExternalRating(rottenTomatoes),
    metacritic: formatMetascore(data.Metascore),
  };
}

export function mapCachedRow(row: CachedRow): RatingsPayload {
  return {
    imdb: row.imdb_rating,
    rottenTomatoes: row.rotten_tomatoes,
    metacritic: row.metacritic,
  };
}

function hasAnyRatings(ratings: RatingsPayload) {
  return Boolean(ratings.imdb || ratings.rottenTomatoes || ratings.metacritic);
}

export function parseReleaseYear(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\d{4}/);
  if (!match?.[0]) {
    return null;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveCacheStatus(
  accessCount: number,
  lastAccessedAtIso: string,
  ratings: RatingsPayload,
): CacheStatus {
  if (!hasAnyRatings(ratings)) {
    return "negative";
  }

  const ageMs = Date.now() - new Date(lastAccessedAtIso).getTime();
  if (accessCount >= HOT_ACCESS_THRESHOLD && ageMs <= daysToMs(HOT_ACCESS_WINDOW_DAYS)) {
    return "hot";
  }

  if (accessCount >= WARM_ACCESS_THRESHOLD && ageMs <= daysToMs(WARM_ACCESS_WINDOW_DAYS)) {
    return "warm";
  }

  return "cold";
}

export function computeExpiresAt(input: {
  ratings: RatingsPayload;
  releaseYear: number | null;
  accessCount: number;
  lastAccessedAtIso: string;
}) {
  const { ratings, releaseYear, accessCount, lastAccessedAtIso } = input;
  if (!hasAnyRatings(ratings)) {
    return new Date(Date.now() + daysToMs(NEGATIVE_TTL_DAYS)).toISOString();
  }

  const cacheStatus = deriveCacheStatus(accessCount, lastAccessedAtIso, ratings);
  if (cacheStatus === "hot") {
    return new Date(Date.now() + hoursToMs(HOT_TITLE_TTL_HOURS)).toISOString();
  }

  if (releaseYear === null) {
    return new Date(Date.now() + daysToMs(MODERN_CATALOG_TTL_DAYS)).toISOString();
  }

  const releaseAge = new Date().getUTCFullYear() - releaseYear;
  if (releaseAge <= 1) {
    return new Date(Date.now() + daysToMs(RECENT_RELEASE_TTL_DAYS)).toISOString();
  }

  if (releaseAge <= 5) {
    return new Date(Date.now() + daysToMs(MODERN_CATALOG_TTL_DAYS)).toISOString();
  }

  return new Date(Date.now() + daysToMs(DEEP_CATALOG_TTL_DAYS)).toISOString();
}

export async function readCachedRow(
  supabase: ReturnType<typeof createServerClient>,
  imdbId: string,
): Promise<CachedRow | null> {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select(
      "imdb_id, imdb_rating, rotten_tomatoes, metacritic, raw_payload, fetched_at, expires_at, last_accessed_at, last_error, access_count, refresh_count, last_status, last_refreshed_by, release_year",
    )
    .eq("imdb_id", imdbId)
    .maybeSingle<CachedRow>();

  if (error) {
    throw new Error("Failed to read ratings cache.");
  }

  return data;
}

export async function touchCacheAccess(
  supabase: ReturnType<typeof createServerClient>,
  row: CachedRow,
  accessedAtIso: string,
): Promise<CachedRow> {
  const accessCount = (row.access_count ?? 0) + 1;
  const lastStatus = deriveCacheStatus(accessCount, accessedAtIso, mapCachedRow(row));

  const updatePayload = {
    access_count: accessCount,
    last_accessed_at: accessedAtIso,
    last_status: lastStatus,
  };

  const { error } = await supabase.from(CACHE_TABLE).update(updatePayload).eq("imdb_id", row.imdb_id);
  if (error) {
    throw new Error("Failed to update ratings cache access metadata.");
  }

  return {
    ...row,
    ...updatePayload,
  };
}

async function fetchOmdbPayload(imdbId: string, omdbApiKey: string): Promise<OmdbResponse> {
  const omdbUrl = new URL("https://www.omdbapi.com/");
  omdbUrl.searchParams.set("apikey", omdbApiKey);
  omdbUrl.searchParams.set("i", imdbId);

  const omdbResponse = await fetch(omdbUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!omdbResponse.ok) {
    throw new Error(`OMDb request failed with ${omdbResponse.status}`);
  }

  return (await omdbResponse.json()) as OmdbResponse;
}

async function upsertCacheEntry(input: {
  supabase: ReturnType<typeof createServerClient>;
  imdbId: string;
  ratings: RatingsPayload;
  rawPayload: OmdbResponse;
  fetchedAtIso: string;
  lastAccessedAtIso: string;
  accessCount: number;
  refreshCount: number;
  trigger: "request" | "schedule";
  releaseYear: number | null;
  lastError: string | null;
}): Promise<CachedRow> {
  const {
    supabase,
    imdbId,
    ratings,
    rawPayload,
    fetchedAtIso,
    lastAccessedAtIso,
    accessCount,
    refreshCount,
    trigger,
    releaseYear,
    lastError,
  } = input;

  const lastStatus = deriveCacheStatus(accessCount, lastAccessedAtIso, ratings);
  const expiresAt = computeExpiresAt({
    ratings,
    releaseYear,
    accessCount,
    lastAccessedAtIso,
  });

  const payload = {
    imdb_id: imdbId,
    imdb_rating: ratings.imdb,
    rotten_tomatoes: ratings.rottenTomatoes,
    metacritic: ratings.metacritic,
    raw_payload: rawPayload,
    fetched_at: fetchedAtIso,
    expires_at: expiresAt,
    last_accessed_at: lastAccessedAtIso,
    last_error: lastError,
    access_count: accessCount,
    refresh_count: refreshCount,
    last_status: lastStatus,
    last_refreshed_by: trigger,
    release_year: releaseYear,
  };

  const { error } = await supabase.from(CACHE_TABLE).upsert(payload);
  if (error) {
    throw new Error("Failed to write ratings cache.");
  }

  return payload;
}

export async function safeLogFunctionEvent(
  supabase: ReturnType<typeof createServerClient> | null,
  input: LogEventInput,
) {
  const logPayload = {
    function_name: input.functionName,
    event_type: input.eventType,
    status_code: input.statusCode,
    imdb_id: input.imdbId ?? null,
    cache_source: input.cacheSource ?? null,
    latency_ms: input.latencyMs ?? null,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? null,
  };

  console.log(JSON.stringify(logPayload));

  if (!supabase) {
    return;
  }

  try {
    const { error } = await supabase.from(LOG_TABLE).insert(logPayload);
    if (error) {
      console.error(`Failed to persist function log: ${error.message}`);
    }
  } catch (error) {
    console.error(`Failed to persist function log: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function refreshRatingsForImdbId(input: RefreshRatingsInput): Promise<RefreshRatingsResult> {
  const { supabase, imdbId, omdbApiKey, trigger, incrementAccess, touchedAtIso } = input;
  const existingRow = await readCachedRow(supabase, imdbId);
  const accessCount = (existingRow?.access_count ?? 0) + (incrementAccess ? 1 : 0);
  const lastAccessedAtIso = incrementAccess
    ? touchedAtIso ?? new Date().toISOString()
    : existingRow?.last_accessed_at ?? new Date().toISOString();

  try {
    const payload = await fetchOmdbPayload(imdbId, omdbApiKey);
    const ratings = normalizeOmdbRatings(payload);
    const releaseYear = parseReleaseYear(payload.Year);
    const row = await upsertCacheEntry({
      supabase,
      imdbId,
      ratings,
      rawPayload: payload,
      fetchedAtIso: new Date().toISOString(),
      lastAccessedAtIso,
      accessCount,
      refreshCount: (existingRow?.refresh_count ?? 0) + 1,
      trigger,
      releaseYear,
      lastError: payload.Response === "True" ? null : payload.Error ?? "OMDb returned False",
    });

    return {
      source: "omdb",
      row,
      ratings,
    };
  } catch (error) {
    if (existingRow) {
      const staleRow = incrementAccess
        ? await touchCacheAccess(supabase, existingRow, touchedAtIso ?? new Date().toISOString())
        : existingRow;

      return {
        source: "stale-cache",
        row: staleRow,
        ratings: mapCachedRow(staleRow),
        warning: error instanceof Error ? error.message : "OMDb refresh failed. Returned stale cache.",
      };
    }

    return {
      source: "error",
      ratings: emptyRatings(),
      warning: error instanceof Error ? error.message : "Failed to fetch ratings.",
    };
  }
}

export async function getHotRatingsCandidates(
  supabase: ReturnType<typeof createServerClient>,
  batchSize: number,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_hot_external_ratings_candidates", {
    batch_size: batchSize,
  });

  if (error) {
    throw new Error("Failed to load hot ratings refresh candidates.");
  }

  return (data ?? [])
    .map((row: { imdb_id?: string | null }) => row.imdb_id?.trim() ?? "")
    .filter((imdbId: string) => imdbId.length > 0);
}

Deno.serve(async (request) => {
  const startedAt = Date.now();

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let supabase = null;
  try {
    supabase = createServerClient();
    getOmdbApiKey();
  } catch {
    return json({ error: "Missing Supabase or OMDb server secrets." }, 500);
  }

  let body: { imdbId?: string };
  try {
    body = await request.json();
  } catch {
    await safeLogFunctionEvent(supabase, {
      functionName: "external-ratings",
      eventType: "invalid_json",
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorMessage: "Invalid JSON body.",
    });
    return json({ error: "Invalid JSON body." }, 400);
  }

  const imdbId = String(body.imdbId ?? "").trim();
  if (!isValidImdbId(imdbId)) {
    await safeLogFunctionEvent(supabase, {
      functionName: "external-ratings",
      eventType: "invalid_imdb_id",
      statusCode: 400,
      imdbId,
      latencyMs: Date.now() - startedAt,
      errorMessage: "A valid imdbId is required.",
    });
    return json({ error: "A valid imdbId is required." }, 400);
  }

  try {
    const cachedRow = await readCachedRow(supabase, imdbId);
    const nowIso = new Date().toISOString();

    if (cachedRow && new Date(cachedRow.expires_at).getTime() > Date.now()) {
      const touchedRow = await touchCacheAccess(supabase, cachedRow, nowIso);
      await safeLogFunctionEvent(supabase, {
        functionName: "external-ratings",
        eventType: "cache_hit",
        statusCode: 200,
        imdbId,
        cacheSource: "cache",
        latencyMs: Date.now() - startedAt,
        metadata: {
          accessCount: touchedRow.access_count,
          expiresAt: touchedRow.expires_at,
          cacheStatus: touchedRow.last_status,
        },
      });

      return json({
        source: "cache",
        imdbId,
        cachedAt: touchedRow.fetched_at,
        expiresAt: touchedRow.expires_at,
        ratings: mapCachedRow(touchedRow),
      });
    }

    const refreshResult = await refreshRatingsForImdbId({
      supabase,
      imdbId,
      omdbApiKey: getOmdbApiKey(),
      trigger: "request",
      incrementAccess: true,
      touchedAtIso: nowIso,
    });

    if (refreshResult.source === "omdb" && refreshResult.row) {
      await safeLogFunctionEvent(supabase, {
        functionName: "external-ratings",
        eventType: "omdb_refresh",
        statusCode: 200,
        imdbId,
        cacheSource: "omdb",
        latencyMs: Date.now() - startedAt,
        metadata: {
          accessCount: refreshResult.row.access_count,
          expiresAt: refreshResult.row.expires_at,
          cacheStatus: refreshResult.row.last_status,
          refreshCount: refreshResult.row.refresh_count,
        },
      });

      return json({
        source: "omdb",
        imdbId,
        cachedAt: refreshResult.row.fetched_at,
        expiresAt: refreshResult.row.expires_at,
        ratings: refreshResult.ratings,
      });
    }

    if (refreshResult.source === "stale-cache" && refreshResult.row) {
      await safeLogFunctionEvent(supabase, {
        functionName: "external-ratings",
        eventType: "stale_cache_served",
        statusCode: 200,
        imdbId,
        cacheSource: "stale-cache",
        latencyMs: Date.now() - startedAt,
        errorMessage: refreshResult.warning ?? null,
        metadata: {
          accessCount: refreshResult.row.access_count,
          expiresAt: refreshResult.row.expires_at,
          cacheStatus: refreshResult.row.last_status,
        },
      });

      return json({
        source: "stale-cache",
        imdbId,
        cachedAt: refreshResult.row.fetched_at,
        expiresAt: refreshResult.row.expires_at,
        ratings: refreshResult.ratings,
        warning: refreshResult.warning,
      });
    }

    await safeLogFunctionEvent(supabase, {
      functionName: "external-ratings",
      eventType: "omdb_refresh_failed",
      statusCode: 502,
      imdbId,
      cacheSource: "omdb",
      latencyMs: Date.now() - startedAt,
      errorMessage: refreshResult.warning ?? "Failed to fetch ratings.",
    });

    return json(
      {
        error: refreshResult.warning ?? "Failed to fetch ratings.",
        ratings: emptyRatings(),
      },
      502,
    );
  } catch (error) {
    await safeLogFunctionEvent(supabase, {
      functionName: "external-ratings",
      eventType: "unexpected_error",
      statusCode: 500,
      imdbId,
      latencyMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Unexpected ratings failure.",
    });

    return json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch ratings.",
        ratings: emptyRatings(),
      },
      500,
    );
  }
});


