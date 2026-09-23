/**
 * WebPlayerService
 *
 * Multi-provider resolver for StreamBox playback.
 *
 * Strategy:
 *  1. Try HDFilmCehennemi first because the app already has a tuned player flow.
 *  2. If HDFilm is missing or the page has no real playable video, fall back to Dizipal.
 *  3. For Dizipal, use their structured search API and validate the real player config
 *     before returning a URL so we avoid dead shells whenever possible.
 */

import axios from "axios";
import { getAllProviderConfigs, getProviderConfig, isProviderConfigReady, recordObservedBaseUrl, refreshProviderConfigs } from "./providerConfigService";
import { caesarShift, decodeBase64Binary, reverseString, runRapidrameDecoder } from "./rapidrameScript";
import { foldNonDecomposingLetters } from "../utils/textFolding";

// Pulls the post-redirect origin out of an axios response so the caller can
// teach providerConfigService where the provider actually lives now. Axios
// in React Native exposes the final XHR URL on `response.request.responseURL`
// (the W3C XMLHttpRequest field). On the rare RN runtime where that is
// undefined we fall through silently — the request still worked, the
// observation just doesn't update config.
function getResponseFinalOrigin(response: any): string | null {
  const finalUrl: string | undefined =
    response?.request?.responseURL ??
    response?.request?._response?.url ??
    response?.request?.url ??
    response?.config?.url;
  if (!finalUrl) return null;
  try {
    return new URL(finalUrl).origin;
  } catch {
    return null;
  }
}
import { getTurkishAlternativeTitle } from "../api/tmdb";

// Maximum time we'll spend resolving before giving up and showing "Not Available".
// 15s — the happy paths (HDFilm native, Dizipal native, Dizibal scraper) all
// return in 1-3s. The 15s ceiling exists for pathological cases where multiple
// providers stall in series; the user sees "Not Available" instead of spinning.
const RESOLVER_TOTAL_TIMEOUT_MS = 15_000;

// Dizibal third-tier scraper budget. The chain is up to 4 sequential HTTP calls
// (search → [title page] → watch page → player config, or a HEAD for a direct
// MP4); on a healthy network each is ~150-400ms, so 12s covers the worst case
// while keeping "Not Available" from ever exceeding the user's patience.
const DIRECT_FALLBACK_TIMEOUT_MS = 12_000;

// Best-effort wait before resolution: if provider config hasn't loaded yet,
// give it a brief window (Supabase fetch is ~500ms typical) so we don't run
// the resolver against stale cached URLs.
const PROVIDER_CONFIG_WAIT_TIMEOUT_MS = 3_000;

async function ensureProviderConfigReady(): Promise<void> {
  if (isProviderConfigReady()) return;
  try {
    await Promise.race([
      refreshProviderConfigs(),
      new Promise<void>((resolve) => setTimeout(resolve, PROVIDER_CONFIG_WAIT_TIMEOUT_MS)),
    ]);
  } catch {
    /* fall through with whatever config is in memory */
  }
}

export type WebPlayerRequest = {
  mediaType: "movie" | "tv";
  title: string;
  originalTitle?: string;
  tmdbId?: string;
  imdbId?: string | null;
  year?: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  castNames?: string[];
  videoId?: string | null;
};

export type WebPlayerResult = {
  url: string;
  source: "hdfilm" | "dizipal" | "dizipal_embed" | "dizipal_direct" | "dizipal_html5" | "youtube_embed" | "direct" | "not_found";
  streamUrl?: string;
  streamType?: string;
  poster?: string;
  referer?: string;
  embedUrl?: string;
  subtitles?: Array<{ url: string; label: string; lang: string }>;
  qualityOptions?: Array<{ label: string; height: number; url: string }>;
  /** If set, the stream is low quality (e.g. "CAM", "TS") — UI should warn the user before playback */
  qualityWarning?: string;
  /**
   * Set only on HDFilm-derived `direct` results: the original HDFilm page URL.
   * If the native stream fails (broken segment, geo block, expired token, etc.)
   * PlayerScreen asks Dizipal/Dizibal for a native stream of the same title.
   * The page itself is never shown — the provider's own player is off-limits.
   */
  webViewFallbackUrl?: string;
};

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function debugLog(...args: unknown[]) {
  if (__DEV__) {
    console.log(...args);
  }
}

function getHdfilmBaseUrl(): string {
  return getProviderConfig("hdfilm").baseUrl;
}

function getDizipalBaseUrl(): string {
  return getProviderConfig("dizipal").baseUrl;
}

function getHdfilmReferer(): string {
  return getProviderConfig("hdfilm").referer;
}

function getDizipalReferer(): string {
  return getProviderConfig("dizipal").referer;
}

type SearchResult = {
  href: string;
  text: string;
  /** Parsed title from <h4 class="title"> — may be "Turkish Title - English Title" */
  title: string;
  /** Parsed year from <span class="year"> */
  resultYear: string;
};

type MatchResult = {
  url: string;
  qualityWarning?: string;
  title?: string;
  resultYear?: string;
  score?: number;
};

const LOW_QUALITY_MARKERS = ["cam", "hdcam", "ts", "telesync", "screener"];

/** Check search result text/href for low-quality markers (CAM, TS, etc.) */
function detectQualityWarning(result: SearchResult): string | undefined {
  const haystack = `${result.text} ${result.href}`.toLowerCase();
  for (const marker of LOW_QUALITY_MARKERS) {
    // Match as whole word to avoid false positives (e.g. "camera" containing "cam")
    if (new RegExp(`\\b${marker}\\b`).test(haystack)) {
      return marker.toUpperCase();
    }
  }
  return undefined;
}

type DizipalSearchResponse = {
  success?: boolean;
  results?: Array<{
    id?: number;
    title?: string;
    year?: number;
    type?: string;
    poster?: string;
    url?: string;
    rating?: string;
  }>;
};

/**
 * How many extra attempts a provider page fetch gets after a Cloudflare
 * challenge. Measured against HDFilm (2026-09-02): a `/dizi/` URL answers 403
 * `cf-mitigated: challenge` on the FIRST request over a fresh connection and
 * 200 on every request after it — 9/10 with connection reuse, 0/10 when each
 * request opened a new connection. No cookie is involved; the clearance rides
 * on the connection, so simply asking again is the whole fix.
 *
 * This mattered a lot: `findSeriesEpisodeUrl` and `checkVideoAvailability`
 * treated that first 403 as "HDFilm doesn't have it", so every series fell
 * through to Dizipal — which is Turkish-dub-only and several hundred ms
 * slower. Two retries take the observed failure rate to ~0.
 *
 * Dizipal joined the club on 2026-09-09: it started answering 403 challenge
 * pages to a fraction of requests, which took tier 2 down for 36 hours in the
 * monitor while the site itself was fine. Dizipal's calls used a bare
 * `axios.get`, so a challenged request dropped the whole tier for that play
 * instead of asking again. Both providers now share this helper.
 */
const PROVIDER_CHALLENGE_RETRIES = 2;

function isCloudflareChallengeStatus(status: number | undefined): boolean {
  return status === 403 || status === 503;
}

/**
 * Provider requests that failed for a reason asking again can fix: no answer
 * at all (timeout, dropped connection, DNS), a 5xx, or a challenge / WAF / rate
 * limit that outlasted its retries. A 404 is an answer and never counts.
 *
 * Every fetcher below swallows its errors into "no results", so without this a
 * pass in which one request of the 7-20 in the chain dropped looked exactly
 * like a title no provider has — "Not available", then the viewer's second tap
 * played it. `resolveWebPlayerUrl` compares this across a pass to tell the two
 * apart.
 */
let transientProviderFailures = 0;

function noteProviderFailure(error: unknown): void {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === undefined || status >= 500 || status === 403 || status === 408 || status === 429) {
    transientProviderFailures += 1;
  }
}

/**
 * A provider whose origin is down answers nothing at all, so every call to it
 * costs the full request timeout before the chain can move on. On 2026-09-24
 * Dizipal's origin went 502 behind its WAF and its four calls ate 24s of the
 * resolver's 20s budget: Dizibal, which had the film, was never reached, and
 * "Star Wars" reported "Not available" while being perfectly watchable.
 *
 * Two dead calls in a row are enough to conclude the host is unreachable. The
 * rest of that pass — and every resolve for the next minute — skips it
 * instantly and spends the budget on the providers that are answering.
 *
 * Only a request that got NO answer counts. Any HTTP reply, including 404,
 * 403 and 500, proves the host is alive and clears the record: a provider is
 * never skipped for saying "no".
 */
const PROVIDER_UNREACHABLE_STRIKES = 2;
const PROVIDER_UNREACHABLE_COOLDOWN_MS = 60_000;
/**
 * A provider that is still silent when its cooldown ends is in an outage, not
 * a blip, so each further opening waits longer — 1, 2, 4, … minutes up to a
 * quarter of an hour. A one-off glitch still costs a single minute.
 */
const PROVIDER_UNREACHABLE_MAX_COOLDOWN_MS = 900_000;
/** Strikes older than this are a different incident and start the count over. */
const PROVIDER_STRIKE_WINDOW_MS = 120_000;
/** Nothing heard from a provider for this long: forget the outage entirely. */
const PROVIDER_SILENCE_FORGET_MS = 1_800_000;

type ProviderSilence = { strikes: number; lastStrikeAt: number; skipUntil: number; outages: number };
const providerSilence = new Map<string, ProviderSilence>();

/** Thrown instead of making a request the breaker says will not be answered. */
class ProviderSkippedError extends Error {
  constructor(provider: string) {
    super(`${provider} answered nothing recently — skipped`);
    this.name = "ProviderSkippedError";
  }
}

function isProviderSkipped(provider: string): boolean {
  const state = providerSilence.get(provider);
  if (!state) return false;
  const now = Date.now();
  if (state.skipUntil > now) return true;
  // The cooldown is over: let the next call through as a probe. The outage
  // count survives it, so a provider that is still dead waits longer next
  // time — unless nothing has been heard from it in so long that this is a
  // new story.
  if (now - state.lastStrikeAt > PROVIDER_SILENCE_FORGET_MS) providerSilence.delete(provider);
  else if (state.skipUntil > 0) providerSilence.set(provider, { ...state, strikes: 0, skipUntil: 0 });
  return false;
}

/** The host replied, so it is up — forget everything held against it. */
function noteProviderAnswered(provider: string): void {
  providerSilence.delete(provider);
}

function noteProviderSilence(provider: string, error: unknown): void {
  if ((error as { response?: unknown } | null)?.response !== undefined) {
    noteProviderAnswered(provider);
    return;
  }

  const now = Date.now();
  const previous = providerSilence.get(provider);
  const fresh = previous && now - previous.lastStrikeAt < PROVIDER_STRIKE_WINDOW_MS;
  const strikes = (fresh ? previous.strikes : 0) + 1;
  const opening = strikes >= PROVIDER_UNREACHABLE_STRIKES;
  const outages = (previous?.outages ?? 0) + (opening ? 1 : 0);
  const cooldown = Math.min(
    PROVIDER_UNREACHABLE_COOLDOWN_MS * 2 ** Math.max(0, outages - 1),
    PROVIDER_UNREACHABLE_MAX_COOLDOWN_MS
  );
  providerSilence.set(provider, {
    strikes,
    lastStrikeAt: now,
    skipUntil: opening ? now + cooldown : 0,
    outages,
  });
  if (opening) {
    debugLog(`[WebPlayer] ${provider} answered nothing ${strikes}x — skipping it for ${cooldown / 1000}s`);
  }
}

/**
 * GET a provider URL, retrying past the Cloudflare interstitial. Rejects on a
 * non-challenge error exactly like a bare `axios.get`, so callers keep their
 * existing try/catch shape.
 */
async function providerGet<T = string>(
  provider: string,
  url: string,
  config: Parameters<typeof axios.get>[1]
): Promise<import("axios").AxiosResponse<T>> {
  if (isProviderSkipped(provider)) {
    // Not a failure: the breaker already knows this host is not answering, and
    // counting it would send the resolver into a pointless second pass.
    throw new ProviderSkippedError(provider);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= PROVIDER_CHALLENGE_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, config);
      noteProviderAnswered(provider);
      return response;
    } catch (error: any) {
      lastError = error;
      if (!isCloudflareChallengeStatus(error?.response?.status)) {
        noteProviderFailure(error);
        noteProviderSilence(provider, error);
        throw error;
      }
      if (attempt === PROVIDER_CHALLENGE_RETRIES) break;
      debugLog(`[WebPlayer] ${provider} challenge on ${url} — retry ${attempt + 1}`);
    }
  }
  noteProviderFailure(lastError);
  noteProviderSilence(provider, lastError);
  throw lastError;
}

/** HDFilm-flavoured `providerGet`. Kept as a named helper for call-site clarity. */
function hdFilmGet<T = string>(
  url: string,
  config: Parameters<typeof axios.get>[1]
): Promise<import("axios").AxiosResponse<T>> {
  return providerGet<T>("HDFilm", url, config);
}

/** Dizipal-flavoured `providerGet`. */
function dizipalGet<T = string>(
  url: string,
  config: Parameters<typeof axios.get>[1]
): Promise<import("axios").AxiosResponse<T>> {
  return providerGet<T>("Dizipal", url, config);
}

/**
 * POST a provider URL. Same breaker and challenge handling as `providerGet` —
 * Dizipal's search became a POST when the site was rebuilt, and a form post
 * that silently bypassed both would have re-opened the hole they close.
 */
async function providerPost<T = string>(
  provider: string,
  url: string,
  body: string,
  config: Parameters<typeof axios.post>[2]
): Promise<import("axios").AxiosResponse<T>> {
  if (isProviderSkipped(provider)) throw new ProviderSkippedError(provider);

  let lastError: unknown;
  for (let attempt = 0; attempt <= PROVIDER_CHALLENGE_RETRIES; attempt++) {
    try {
      const response = await axios.post<T>(url, body, config);
      noteProviderAnswered(provider);
      return response;
    } catch (error: any) {
      lastError = error;
      if (!isCloudflareChallengeStatus(error?.response?.status)) {
        noteProviderFailure(error);
        noteProviderSilence(provider, error);
        throw error;
      }
      if (attempt === PROVIDER_CHALLENGE_RETRIES) break;
      debugLog(`[WebPlayer] ${provider} challenge on ${url} — retry ${attempt + 1}`);
    }
  }
  noteProviderFailure(lastError);
  noteProviderSilence(provider, lastError);
  throw lastError;
}

function dizipalPost<T = string>(
  url: string,
  body: string,
  config: Parameters<typeof axios.post>[2]
): Promise<import("axios").AxiosResponse<T>> {
  return providerPost<T>("Dizipal", url, body, config);
}

/** Dizibal-flavoured `providerGet`, so the breaker covers the third tier too. */
function dizibalGet<T = string>(
  url: string,
  config: Parameters<typeof axios.get>[1]
): Promise<import("axios").AxiosResponse<T>> {
  return providerGet<T>("Dizibal", url, config);
}

function extractHref(html: string): string | null {
  const match = html.match(/href=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function extractHrefs(html: string): string[] {
  const matches = html.matchAll(/href=["']([^"']+)["']/gi);
  return Array.from(matches, (match) => match[1]).filter((value): value is string => Boolean(value));
}

function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Fold letters NFD cannot decompose, so the `[^a-z0-9\s]` strip downstream
 * keeps them instead of deleting them (ı → i, ə → e, ø → o, …). Apply BEFORE
 * that strip in every title normalization path, or Turkish-titled provider
 * results stop matching their TMDB-localized titles.
 *
 * Shared with the app's own TMDB search, which had the identical bug and no
 * fold at all — see src/utils/textFolding.ts.
 */
const foldTurkishDotlessI = foldNonDecomposingLetters;

/** Extract title from <h4 class="title">...</h4>, decode HTML entities */
function extractH4Title(html: string): string {
  const match = html.match(/<h4[^>]*class=["']title["'][^>]*>(.*?)<\/h4>/i);
  if (!match?.[1]) return "";
  return match[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&Ccedil;/g, "Ç").replace(/&ccedil;/g, "ç")
    .replace(/&Ouml;/g, "Ö").replace(/&ouml;/g, "ö")
    .replace(/&Uuml;/g, "Ü").replace(/&uuml;/g, "ü")
    .replace(/&Iuml;/g, "İ").replace(/&#304;/g, "İ")
    .replace(/&[a-zA-Z]+;/g, " ") // remaining entities → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract year from <span class="year">2021</span> */
function extractResultYear(html: string): string {
  const match = html.match(/<span[^>]*class=["']year["'][^>]*>(\d{4})<\/span>/i);
  return match?.[1] ?? "";
}

/**
 * For HDFilm results with format "Turkish Title - English Title",
 * split and return all title variants to match against.
 */
function splitDualTitle(title: string): string[] {
  const parts = title.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
  // Also add the full combined title
  return [title, ...parts];
}

type NormalizedTitle = {
  text: string;
  compact: string;
  tokens: string[];
};

const TITLE_INITIAL_STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to", "with"]);

function normalizeTitle(value: string): NormalizedTitle {
  const text = foldTurkishDotlessI(value.toLowerCase())
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = text.split(/\s+/).filter(Boolean);

  return {
    text,
    compact: tokens.join(""),
    tokens
  };
}

function getSignificantInitials(tokens: string[]): string {
  return tokens
    .filter((token) => token.length > 0 && !TITLE_INITIAL_STOP_WORDS.has(token))
    .map((token) => token[0])
    .join("");
}

function isShortOrAcronymTitle(value: string): boolean {
  const normalized = normalizeTitle(value);
  if (!normalized.compact) return false;
  if (normalized.compact.length <= 3) return true;
  return normalized.tokens.length > 1 && normalized.tokens.every((token) => token.length === 1);
}

function hasStrictTitleIdentity(candidate: string, target: string): boolean {
  const candidateTitle = normalizeTitle(candidate);
  const targetTitle = normalizeTitle(target);

  if (!candidateTitle.compact || !targetTitle.compact) return false;
  if (candidateTitle.text === targetTitle.text) return true;
  if (candidateTitle.compact === targetTitle.compact) return true;

  if (!isShortOrAcronymTitle(target)) return false;

  const targetCompact = targetTitle.compact;
  const candidateInitials = getSignificantInitials(candidateTitle.tokens);
  const allCandidateInitials = candidateTitle.tokens.map((token) => token[0]).join("");

  return candidateInitials === targetCompact || allCandidateInitials === targetCompact;
}

function isAlternateTitleSafeForDizipal(title: string, alternateTitle?: string): boolean {
  if (!alternateTitle) return false;
  if (!isShortOrAcronymTitle(title)) return true;

  return hasStrictTitleIdentity(alternateTitle, title);
}

export function scoreMatch(resultText: string, target: string, year?: string | number | null): number {
  if (!resultText || !target) return 0;
  // Fold ı/İ → i AND apply NFD diacritic stripping so Turkish-only chars
  // (Yadigârları, Bölüm, Aşk, …) compare cleanly against ASCII slugs.
  const foldForCompare = (value: string): string =>
    foldTurkishDotlessI(value.toLowerCase())
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const normalizedResult = foldForCompare(resultText);
  const normalizedTarget = foldForCompare(target);
  const yearStr = year ? String(year) : null;

  // Strip year from result text for title-only comparison (sites often append "2021", "1080p" etc.)
  const resultWithoutYear = yearStr
    ? normalizedResult.replace(new RegExp(`\\b${yearStr}\\b`, "g"), "").replace(/\s+/g, " ").trim()
    : normalizedResult;

  // Strip common quality/format tags from result for cleaner title matching
  const resultTitle = resultWithoutYear
    .replace(/\b(1080p|720p|480p|360p|hd|full hd|4k|uhd|bluray|webrip|webdl|hdcam)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let score = 0;

  // Exact title match (after stripping year/quality) — strongest signal
  if (resultTitle === normalizedTarget) {
    score = 100;
  } else if (normalizedResult === normalizedTarget) {
    score = 100;
  } else if (resultTitle.startsWith(normalizedTarget + " ") || resultTitle.startsWith(normalizedTarget)) {
    // Result starts with target but has extra words (e.g. "dune part two" for "dune")
    // Penalize proportional to how many extra words there are
    const targetWordCount = normalizedTarget.split(/\s+/).length;
    const resultWordCount = resultTitle.split(/\s+/).length;
    const extraRatio = targetWordCount / Math.max(resultWordCount, 1);
    score = Math.round(60 + extraRatio * 30); // Range: 60-90, exact prefix = 90
  } else if (resultTitle.includes(normalizedTarget)) {
    // Target is a substring but not at the start (e.g. "planet dune" for "dune")
    // This is a weak match — heavily penalize
    const targetWordCount = normalizedTarget.split(/\s+/).length;
    const resultWordCount = resultTitle.split(/\s+/).length;
    const extraRatio = targetWordCount / Math.max(resultWordCount, 1);
    score = Math.round(30 + extraRatio * 20); // Range: 30-50, much lower than prefix
  } else {
    // Word overlap fallback
    const targetWords = normalizedTarget.split(/\s+/).filter(Boolean);
    const resultWords = resultTitle.split(/\s+/).filter(Boolean);
    if (targetWords.length > 0) {
      const matchedCount = targetWords.filter((word) => resultWords.includes(word)).length;
      const overlapRatio = matchedCount / targetWords.length;
      // Also penalize if result has many extra unmatched words
      const precision = resultWords.length > 0 ? matchedCount / resultWords.length : 0;
      let rawScore = Math.round((overlapRatio * 0.7 + precision * 0.3) * 50);
      // Hard gate: if less than 70% of target words are covered, cap score to prevent
      // weak partial matches (e.g. "The House on Pine Street" for "The House on the Dune")
      if (overlapRatio < 0.70) rawScore = Math.min(rawScore, 25);
      score = rawScore;
    }
  }

  // Boost for year match
  if (yearStr && resultText.includes(yearStr)) {
    score += 20;
  }

  return score;
}

function scoreStrictDizipalTitle(variant: string, target: string): number {
  if (!variant || !target) return 0;

  if (isShortOrAcronymTitle(target)) {
    return hasStrictTitleIdentity(variant, target) ? 100 : 0;
  }

  const score = scoreMatch(variant, target);
  const normalizedTarget = normalizeTitle(target);
  const normalizedVariant = normalizeTitle(variant);
  const targetWordCount = normalizedTarget.tokens.length;

  if (targetWordCount <= 2 && score < 90 && normalizedVariant.compact !== normalizedTarget.compact) {
    return 0;
  }

  return score;
}

function normalizeName(name: string): string {
  return foldTurkishDotlessI(name.toLowerCase())
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type SearchQueryPlan = {
  queries: string[];
  /**
   * How many leading entries of `queries` are bare names (the original-language
   * spelling and the display title). The empty-result cutoff must never fire
   * before all of them have been sent — see EMPTY_SEARCH_QUERY_LIMIT.
   */
  bareTitleCount: number;
};

function generateSearchQueries(
  title: string,
  year?: string | null,
  originalTitle?: string
): SearchQueryPlan {
  const queries: string[] = [];
  const seen = new Set<string>();

  function add(query: string) {
    const cleaned = query.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length >= 2 && !seen.has(key)) {
      seen.add(key);
      queries.push(cleaned);
    }
  }

  // 0. Every BARE name first: the original-language spelling, the display
  //    title, then each of those with punctuation stripped. These are all
  //    DIFFERENT names for the film rather than cheap variants of one, so every
  //    one of them has to go out before any year-qualified query — the
  //    empty-result cutoff below only budgets a couple of rounds.
  //
  //    Concrete bug this prevents (non-Latin): Harakiri (1962), whose TMDB
  //    original title is "切腹". Emitting "切腹" and "切腹 1962" first spent the
  //    entire budget on a script the Turkish catalogue doesn't carry — both
  //    returned zero rows, the sweep stopped, and the film reported "Not
  //    Available" even though /search/?q=Harakiri returns it.
  //
  //    Concrete bug this prevents (apostrophes): HDFilm's search does not
  //    tokenize an apostrophe. /search/?q=Rosemary's Baby returns ZERO rows
  //    while /search/?q=Rosemarys Baby returns the film. With the cleaned
  //    spelling sitting BEHIND the year-qualified variants, the two-query
  //    cutoff fired before it was ever sent, and "Rosemary's Baby" reported
  //    "Not Available" even though HDFilm carries it. Every possessive title —
  //    Ocean's Eleven, Schindler's List, Pandora's Box — failed the same way.
  const cleanSpelling = (value: string) =>
    value
      .replace(/['''\u2019]/g, "")         // strip apostrophes (Don't → Dont)
      .replace(/[:,\u201C\u201D"!?.,]/g, " ") // replace separators with space
      .replace(/[&]/g, "and")
      // \w is ASCII-only in JS, so this used to delete every non-ASCII
      // LETTER too: "Rosemary'nin Bebeği" cleaned to "Rosemarynin Bebei",
      // a spelling no Turkish catalogue has ever heard of. Keep letters and
      // digits in any script; strip only the punctuation.
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  if (originalTitle) add(originalTitle);
  add(title);
  const cleanTitle = cleanSpelling(title);
  if (originalTitle) add(cleanSpelling(originalTitle));
  add(cleanTitle);
  const bareTitleCount = queries.length;

  // 1. Year-qualified variants for disambiguation.
  if (originalTitle && year) add(`${originalTitle} ${year}`);
  if (year) add(`${title} ${year}`);
  if (year) add(`${cleanTitle} ${year}`);

  // 4. Prefix before colon/dash (for subtitled movies like "Alien: Romulus")
  if (title.includes(":")) add(title.split(":")[0].trim());
  if (title.includes(" - ")) add(title.split(" - ")[0].trim());

  // 5. Partial word combinations for very long titles
  const significantWords = cleanTitle.split(/\s+/).filter((word) => word.length >= 2);
  if (significantWords.length > 4) add(significantWords.slice(0, 4).join(" "));
  if (significantWords.length > 3) add(significantWords.slice(0, 3).join(" "));

  // 6. Without articles as last resort
  const withoutArticles = cleanTitle
    .replace(/\b(the|a|an|of|and|in|at|to|for|on|with|by)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutArticles !== cleanTitle) add(withoutArticles);

  return { queries, bareTitleCount };
}

// How many query variants a provider gets before "nothing at all came back" is
// treated as "this provider does not have the title".
//
// generateSearchQueries emits up to ~8 spellings of the same name. When the
// first few return literally zero rows, the remaining variants (articles
// stripped, first three words, …) are progressively WEAKER versions of a query
// the catalogue already failed to match, so they cost ~300ms each and change
// nothing. Cutting them off is what keeps the "Not Available" path from
// spending its whole budget on a title no provider carries. A provider that
// returned even one row still gets the full sweep — there the extra variants
// are what break ties between near-matches.
//
// The cutoff is a FLOOR, not a cap: `bareTitleCount` raises it so the sweep can
// never stop before both the original-language title and the display title have
// each been searched once. Cheap variants of one name are what we want to skip;
// a different name entirely is not a variant.
const EMPTY_SEARCH_QUERY_LIMIT = 2;

/**
 * Maximum query rounds a provider gets per lookup, unless the title has more
 * distinct bare spellings than that (then every spelling still goes out).
 * Each round is one HTTP request against a provider that is already slow.
 */
const SEARCH_QUERY_BUDGET = 5;

function shouldStopSearchingAfterEmptyQueries(
  queryIndex: number,
  resultCount: number,
  bareTitleCount = 1
): boolean {
  const limit = Math.max(EMPTY_SEARCH_QUERY_LIMIT, bareTitleCount);
  return resultCount === 0 && queryIndex + 1 >= limit;
}

function toAbsoluteUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

async function queryHdFilm(query: string): Promise<SearchResult[]> {
  try {
    const response = await hdFilmGet<{ results?: string[] }>(
      `${getHdfilmBaseUrl()}/search/?q=${encodeURIComponent(query)}`,
      {
        timeout: 6000,
        headers: {
          "X-Requested-With": "fetch",
          "Accept": "application/json",
          "User-Agent": UA,
          "Referer": getHdfilmReferer()
        }
      }
    );

    recordObservedBaseUrl("hdfilm", getResponseFinalOrigin(response));

    const rawResults = response.data?.results;
    if (!Array.isArray(rawResults) || rawResults.length === 0) return [];

    return rawResults
      .map((html) => ({
        href: extractHref(html) ?? "",
        text: extractText(html),
        title: extractH4Title(html),
        resultYear: extractResultYear(html)
      }))
      .filter((result) => result.href.length > 0);
  } catch (error: any) {
    debugLog(`[WebPlayer] HdFilm search error for "${query}":`, error?.message);
    return [];
  }
}

async function verifyCast(pageUrl: string, castNames: string[]): Promise<number> {
  if (castNames.length === 0) return 0;

  try {
    const response = await hdFilmGet<string>(pageUrl, {
      timeout: 6000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: getHdfilmReferer()
      }
    });

    const pageText = normalizeName(response.data);
    let matches = 0;

    for (const name of castNames) {
      const normalized = normalizeName(name);
      const parts = normalized.split(" ");
      const lastName = parts[parts.length - 1];

      if (lastName.length >= 3 && pageText.includes(lastName)) {
        matches += 1;
      } else if (pageText.includes(normalized)) {
        matches += 1;
      }
    }

    return matches;
  } catch {
    return 0;
  }
}

/**
 * How many years apart the provider's listing and TMDB are, or null when
 * either side doesn't state one.
 */
function yearDistance(candidateYear?: string | null, targetYear?: string | null): number | null {
  const candidate = Number.parseInt(candidateYear ?? "", 10);
  const target = Number.parseInt(targetYear ?? "", 10);
  if (!Number.isFinite(candidate) || !Number.isFinite(target)) return null;
  return Math.abs(candidate - target);
}

/**
 * Turkish providers date a film by its LOCAL release, which routinely lands in
 * the next calendar year (Dune: Part Two is 2024 on TMDB and 2023 on HDFilm).
 * One year apart is the same film; anything wider is a different one —
 * remakes, sequels and the Dune 1984/2021 pair are all far outside this.
 *
 * A near-miss year is still worse than an exact one: the scoring below keeps
 * the +50 exact-year boost, so when both listings exist the exact match wins.
 */
const NEAR_YEAR_TOLERANCE = 1;

function isYearIncompatible(candidateYear?: string | null, targetYear?: string | null): boolean {
  const distance = yearDistance(candidateYear, targetYear);
  return distance !== null && distance > NEAR_YEAR_TOLERANCE;
}

/**
 * Score an HDFilm search result against the target title + year.
 *
 * HDFilm titles often use the format "Turkish Title - English Title".
 * We split on " - " and score each part independently, taking the best.
 * The year from the structured <span class="year"> is used for disambiguation.
 */
function scoreHdFilmResult(result: SearchResult, target: string, targetYear?: string | null): number {
  const titleVariants = splitDualTitle(result.title);
  // Also try the full extracted text as a last-resort variant
  const allVariants = [...titleVariants, result.text];

  let bestScore = 0;
  for (const variant of allVariants) {
    const s = scoreMatch(variant, target);
    if (s > bestScore) bestScore = s;
  }

  // Year handling: year match is a TIE-BREAKER for already-strong title matches,
  // never a LIFTER for weak ones.
  //
  // Concrete bug this prevents: target "Fury" (2014). HDFilm has "Aşkın Dansı -
  // Cuban Fury" (2014). scoreMatch returns 40 for the substring overlap. A
  // naive +50 year boost lifts that to 90 — above the 50-point filter cutoff —
  // and "Cuban Fury" wins, even though the real Fury (2014) only exists on
  // Dizipal. By gating the boost on bestScore >= 60 (i.e. at least a clean
  // prefix or exact match), substring-only results stay weak, HDFilm returns
  // null for searches whose title isn't actually present, and the Dizipal
  // fallback kicks in correctly.
  if (targetYear && result.resultYear) {
    const distance = yearDistance(result.resultYear, targetYear);
    if (distance === 0) {
      if (bestScore >= 60) {
        bestScore += 50; // strong title + correct year → near-certain match
      }
      // bestScore < 60 → no boost. Substring-only matches stay strictly below
      // the findBestHdFilmMatch 50-point cutoff so they can't beat the real
      // match on another provider just because the year coincides.
    } else if (distance !== null && distance <= NEAR_YEAR_TOLERANCE) {
      // Off by one — almost always the local release date, not a different
      // film. Nudge it below an exact-year rival without sinking it under the
      // 50-point cutoff.
      bestScore -= 10;
    } else if (bestScore >= 80) {
      // High title match but WRONG year — penalize heavily so year-matching
      // results always win when both exist.
      bestScore -= 40;
    } else if (bestScore >= 50) {
      // Medium title match with wrong year — moderate penalty.
      bestScore -= 20;
    }
  }

  return bestScore;
}

function scoreDizipalResult(result: SearchResult, target: string, targetYear?: string | null): number {
  const titleVariants = splitDualTitle(result.title);

  let bestScore = 0;
  for (const variant of titleVariants) {
    const score = scoreStrictDizipalTitle(variant, target);
    if (score > bestScore) bestScore = score;
  }

  if (bestScore === 0 && !isShortOrAcronymTitle(target)) {
    bestScore = scoreStrictDizipalTitle(result.text, target);
  }

  if (bestScore === 0) return 0;

  if (targetYear && result.resultYear) {
    const distance = yearDistance(result.resultYear, targetYear);
    if (distance === 0) {
      bestScore += 50;
    } else if (distance !== null && distance <= NEAR_YEAR_TOLERANCE) {
      // See NEAR_YEAR_TOLERANCE: the local release year, not a different film.
      // The penalty has to stay small — Dizipal's own cutoff is 80.
      bestScore -= 10;
    } else if (bestScore >= 80) {
      bestScore -= 55;
    } else if (bestScore >= 50) {
      bestScore -= 30;
    }
  }

  return Math.max(0, bestScore);
}

/**
 * Find the single best HDFilm match for the given title + year.
 * Returns the URL of the best match, or null if nothing relevant is found.
 *
 * Strategy:
 *  - Score every result using structured title parsing (Turkish-English split)
 *  - Year match gives +50, year mismatch on close titles gives -40
 *  - Return only the #1 result — no array, no fallback to wrong movies
 */
async function findBestHdFilmMatch(title: string, castNames: string[], year?: string | null, originalTitle?: string): Promise<MatchResult | null> {
  const { queries, bareTitleCount } = generateSearchQueries(title, year, originalTitle);
  const allResults = new Map<string, SearchResult>();

  for (let qi = 0; qi < queries.length; qi++) {
    const results = await queryHdFilm(queries[qi]);
    for (const result of results) {
      const absoluteHref = toAbsoluteUrl(getHdfilmBaseUrl(), result.href);
      if (absoluteHref && !allResults.has(absoluteHref)) {
        allResults.set(absoluteHref, { ...result, href: absoluteHref });
      }
    }

    const bestSoFar = Math.max(0, ...[...allResults.values()].map(r => {
      const s1 = scoreHdFilmResult(r, title, year);
      const s2 = originalTitle ? scoreHdFilmResult(r, originalTitle, year) : 0;
      return Math.max(s1, s2);
    }));
    if (bestSoFar >= 120) break;
    if (shouldStopSearchingAfterEmptyQueries(qi, allResults.size, bareTitleCount)) break;
    // Hard budget. It is a FLOOR of five rounds, raised when the title has more
    // than five distinct spellings, so the bare-name sweep can never be cut off
    // half-way through (see generateSearchQueries).
    if (qi + 1 >= Math.max(SEARCH_QUERY_BUDGET, bareTitleCount)) break;
  }

  if (allResults.size === 0) return null;

  const scored = [...allResults.entries()]
    .map(([href, result]) => ({
      href,
      titleScore: Math.max(
        scoreHdFilmResult(result, title, year),
        originalTitle ? scoreHdFilmResult(result, originalTitle, year) : 0
      ),
      resultYear: result.resultYear,
      qualityWarning: detectQualityWarning(result)
    }))
    .filter((entry) => {
      if (entry.titleScore < 50) return false;
      // Hard year gate. The soft -40 penalty in scoreHdFilmResult can still
      // leave a wrong-year exact-title page above the 50 cutoff (e.g. Dune
      // 1984's page title "Dune: Çöl Gezegeni  - Dune 1984" contains the
      // 2021 Turkish title "Dune: Çöl Gezegeni" verbatim → variant score
      // 100, year mismatch → 60, passes — and that movie then plays even
      // though the user clicked the 2021 poster). When we know both years and
      // they disagree by more than NEAR_YEAR_TOLERANCE, the candidate is the
      // wrong movie. Reject it outright so the resolver falls through to
      // Dizipal / direct.
      if (isYearIncompatible(entry.resultYear, year)) return false;
      return true;
    })
    .sort((a, b) => b.titleScore - a.titleScore);

  if (scored.length === 0) return null;

  // If ambiguous (no clear winner by title+year), use cast to pick between top candidates
  if (scored.length > 1 && scored[0].titleScore < 120 && castNames.length > 0) {
    const top3 = scored.slice(0, 3);
    const withCast = await Promise.all(top3.map(async c => ({
      href: c.href,
      qualityWarning: c.qualityWarning,
      totalScore: c.titleScore * 10 + await verifyCast(c.href, castNames)
    })));
    withCast.sort((a, b) => b.totalScore - a.totalScore);
    return { url: withCast[0].href, qualityWarning: withCast[0].qualityWarning };
  }

  return { url: scored[0].href, qualityWarning: scored[0].qualityWarning };
}

type VideoCheck = {
  available: boolean;
  qualityWarning?: string;
  nativeFallback?: DizipalStreamInfo | null;
};

async function checkVideoAvailability(pageUrl: string): Promise<VideoCheck> {
  try {
    const response = await hdFilmGet<string>(pageUrl, {
      timeout: 6000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: getHdfilmReferer()
      }
    });

    const html = response.data;
    const hasRapidrame = /rapidrame/i.test(html);
    const hasAlternativeLink = /alternative-link|class=["']server|data-link|data-video/i.test(html);
    const hasPlayerIframe = /iframe[^>]+src=[^>]+(rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape)/i.test(html);

    const available = hasRapidrame || hasAlternativeLink || hasPlayerIframe || html.includes('kePlayerTitle');
    if (!available) return { available: false };

    // Attempt native extraction whenever the page carries a trusted HDFilm
    // embed iframe — NOT only when the literal "rapidrame" string is present.
    // Many titles (e.g. "Obsession") embed hdfilmcehennemi.mobi/video/embed/…
    // without that word yet still decode to a native HLS stream via the same
    // Rapidrame decoder. Gating on the literal string sent those titles to the
    // WebView player even though native playback was fully available.
    // extractHdFilmEmbedUrl is a pure regex on the already-fetched HTML, and
    // resolveHdFilmNativeFallback returns null cleanly when nothing decodes, so
    // pages with no real native stream still fall through to the WebView path.
    const hasExtractableEmbed = extractHdFilmEmbedUrl(html, pageUrl) !== null;
    const nativeFallback = (hasRapidrame || hasExtractableEmbed)
      ? await getCachedHdFilmNativeFallback(pageUrl, html)
      : null;

    // Check server/source buttons for low-quality markers (CAM Sürüm, TS, etc.)
    const linkButtons = html.match(/<button[^>]*class=["'][^"']*alternative-link[^"']*["'][^>]*>[\s\S]*?<\/button>/gi) || [];
    if (linkButtons.length > 0) {
      const allCam = linkButtons.every(btn => {
        const text = btn.replace(/<[^>]+>/g, " ").toLowerCase();
        return /\b(cam|hdcam|ts|telesync|screener)\b/.test(text);
      });
      if (allCam) {
        // Extract the specific marker from the first button for the warning message
        const firstText = (linkButtons[0] ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
        const markerMatch = firstText.match(/\b(cam|hdcam|ts|telesync|screener)\b/);
        return { available: true, qualityWarning: markerMatch ? markerMatch[1].toUpperCase() : "CAM", nativeFallback };
      }
    }

    return { available: true, nativeFallback };
  } catch {
    return { available: false };
  }
}

function matchesSeriesEpisodeUrl(url: string, seasonNumber: number, episodeNumber: number): boolean {
  const normalized = url.toLowerCase();
  
  const seasonRegex = new RegExp(`(sezon[/-]?${seasonNumber}\\b|\\b${seasonNumber}[/-]?sezon|\\bs${seasonNumber}\\b)`, 'i');
  const episodeRegex = new RegExp(`(bolum[/-]?${episodeNumber}\\b|\\b${episodeNumber}[/-]?bolum|\\be${episodeNumber}\\b|ep[/-]?${episodeNumber}\\b)`, 'i');

  return seasonRegex.test(normalized) && episodeRegex.test(normalized);
}

function buildHdFilmResult(pageUrl: string, qualityWarning?: string, nativeFallback?: DizipalStreamInfo | null): WebPlayerResult {
  // If the decoder produced a real stream URL, ALWAYS go native.
  //
  // Why: the WebView path is structurally fragile across Android skins. It
  // requires our injected JS to win a race against the provider's pre-roll ad
  // overlay — heuristic click-through that's been observed to fail on HyperOS
  // (POCO F7) and similar non-stock Androids, leaving the user with a black
  // screen and an unclickable "Skip in 10s" prompt. Native expo-video has no
  // pre-rolls, no overlays, and no per-OS DOM/JS timing quirks, so this is the
  // only way to get deterministic playback on every device.
  //
  // The previous `preferNative` heuristic (disguised-.jpg HLS segments only) is
  // kept on `DizipalStreamInfo` for telemetry/diagnostics but no longer gates
  // playback. expo-video plays both proper master playlists AND the disguised
  // shape correctly.
  if (nativeFallback?.streamUrl) {
    return {
      url: nativeFallback.streamUrl,
      source: "direct",
      streamUrl: nativeFallback.streamUrl,
      streamType: nativeFallback.streamType,
      poster: nativeFallback.poster,
      referer: nativeFallback.referer,
      embedUrl: nativeFallback.referer,
      subtitles: nativeFallback.subtitles,
      // Marks the stream as HDFilm-derived: if it fails at runtime (broken
      // segment, expired token, regional block) PlayerScreen asks the other
      // providers for a native stream instead.
      webViewFallbackUrl: pageUrl,
      qualityWarning
    };
  }

  // Decoder couldn't extract a stream. The page result has no `streamUrl`, and
  // the resolver treats that as "HDFilm has nothing playable" — it never hands
  // the provider's own page player to the user.
  return {
    url: pageUrl,
    source: "hdfilm",
    qualityWarning
  };
}

async function findSeriesEpisodeUrl(
  seriesPageUrl: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  if (matchesSeriesEpisodeUrl(seriesPageUrl, seasonNumber, episodeNumber)) {
    return seriesPageUrl;
  }

  try {
    const response = await hdFilmGet<string>(seriesPageUrl, {
      timeout: 6000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: getHdfilmReferer()
      }
    });

    const hrefs = extractHrefs(response.data);
    const episodeUrls = Array.from(
      new Set(
        hrefs.map((href) => toAbsoluteUrl(seriesPageUrl, href))
          .filter((href): href is string => Boolean(href))
      )
    );

    const directMatch = episodeUrls.find((href) => matchesSeriesEpisodeUrl(href, seasonNumber, episodeNumber));
    if (directMatch) return directMatch;
    
    return episodeUrls.find(href => {
        const parts = href.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1] || "";
        return matchesSeriesEpisodeUrl(lastPart, seasonNumber, episodeNumber);
    }) ?? null;

  } catch (e: any) {
    debugLog(`[WebPlayer] Error fetching series page: ${seriesPageUrl}`, e?.message || String(e));
    return null;
  }
}

async function resolvePlayableSeriesEpisodeUrl(
  seriesPageUrl: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<{ url: string; qualityWarning?: string; nativeFallback?: DizipalStreamInfo | null } | null> {
  try {
    const episodeUrl = await findSeriesEpisodeUrl(seriesPageUrl, seasonNumber, episodeNumber);
    if (!episodeUrl) return null;

    const check = await checkVideoAvailability(episodeUrl);
    if (!check.available) return null;

    return { url: episodeUrl, qualityWarning: check.qualityWarning, nativeFallback: check.nativeFallback };
  } catch {
    return null;
  }
}

/**
 * Dizipal's search, as the site's own header box calls it.
 *
 * The rebuilt site replaced `/ajax-search` (a GET returning JSON rows) with a
 * POST to `/bg/searchcontent` that answers `{data:{result,html}}` — the html
 * being the dropdown's markup. The form carries a `cKey`/`cValue` pair minted
 * per page render; without them the endpoint answers an empty result set
 * rather than an error, which is exactly what "Dizipal has nothing" looks
 * like, so a stale pair must expire rather than linger.
 */
const DIZIPAL_SEARCH_CREDENTIAL_TTL_MS = 10 * 60 * 1000;
/** How long a home page that would not answer is left alone. */
const DIZIPAL_SEARCH_CREDENTIAL_RETRY_MS = 30 * 1000;

type DizipalSearchCredentials = { base: string; cKey: string; cValue: string; expiresAt: number };
let dizipalSearchCredentials: DizipalSearchCredentials | null = null;

async function getDizipalSearchCredentials(): Promise<DizipalSearchCredentials | null> {
  const base = getDizipalBaseUrl();
  const cached = dizipalSearchCredentials;
  if (cached && cached.base === base && cached.expiresAt > Date.now()) {
    // An empty pair is a remembered failure: the home page did not answer, and
    // asking it again inside the same resolve only spends the budget twice.
    return cached.cKey ? cached : null;
  }

  try {
    const response = await dizipalGet<string>(`${base}/`, {
      timeout: 6000,
      headers: { "User-Agent": UA, Accept: "text/html", Referer: getDizipalReferer() },
    });
    recordObservedBaseUrl("dizipal", getResponseFinalOrigin(response));
    const html = typeof response.data === "string" ? response.data : "";
    const cKey = html.match(/name=["']cKey["']\s+value=["']([^"']+)["']/i)?.[1];
    const cValue = html.match(/name=["']cValue["']\s+value=["']([^"']+)["']/i)?.[1];
    if (!cKey || !cValue) {
      debugLog("[WebPlayer] Dizipal home page carries no search credentials");
      dizipalSearchCredentials = { base, cKey: "", cValue: "", expiresAt: Date.now() + DIZIPAL_SEARCH_CREDENTIAL_RETRY_MS };
      return null;
    }
    dizipalSearchCredentials = {
      base,
      cKey,
      cValue,
      expiresAt: Date.now() + DIZIPAL_SEARCH_CREDENTIAL_TTL_MS,
    };
    return dizipalSearchCredentials;
  } catch (error: any) {
    debugLog("[WebPlayer] Dizipal search credentials failed:", error?.message ?? error);
    dizipalSearchCredentials = { base, cKey: "", cValue: "", expiresAt: Date.now() + DIZIPAL_SEARCH_CREDENTIAL_RETRY_MS };
    return null;
  }
}

/** Rows out of the search dropdown's markup. */
export function parseDizipalSearchResults(html: string, mediaType: "movie" | "tv"): SearchResult[] {
  const wanted = mediaType === "movie" ? "/film/" : "/dizi/";
  const results: SearchResult[] = [];

  for (const match of html.matchAll(
    /<a\b[^>]*class=["'][^"']*dp-search-result[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const href = match[1];
    if (!href.includes(wanted)) continue;
    const inner = match[2];
    const title = decodeHtmlAttribute(inner.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const year = inner.match(/<em[^>]*>\s*((?:19|20)\d{2})\s*<\/em>/i)?.[1] ?? "";
    results.push({
      href,
      text: `${title} ${year}`.trim().toLowerCase(),
      title,
      resultYear: year,
    });
  }

  return results;
}

async function queryDizipal(query: string, mediaType: "movie" | "tv"): Promise<SearchResult[]> {
  const credentials = await getDizipalSearchCredentials();
  if (!credentials) return [];

  try {
    const response = await dizipalPost<{ data?: { html?: string } }>(
      `${getDizipalBaseUrl()}/bg/searchcontent`,
      new URLSearchParams({
        cKey: credentials.cKey,
        cValue: credentials.cValue,
        type: "hepsi",
        searchterm: query,
      }).toString(),
      {
        timeout: 6000,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Referer: getDizipalReferer(),
        },
      }
    );
    recordObservedBaseUrl("dizipal", getResponseFinalOrigin(response));

    const html = response.data?.data?.html;
    if (typeof html !== "string" || html.length === 0) return [];
    return parseDizipalSearchResults(html, mediaType);
  } catch (error: any) {
    debugLog(`[WebPlayer] Dizipal search error for "${query}":`, error?.message ?? error);
    // A pair that the site has rotated answers 200 with nothing; drop ours so
    // the next attempt mints a fresh one rather than repeating the miss.
    dizipalSearchCredentials = null;
    return [];
  }
}

/**
 * Slugify a title the way Dizipal builds its page URLs: lowercase, fold the
 * Turkish dotless-i, strip diacritics, and collapse every non-alphanumeric run
 * to a single dash (e.g. "From" → "from", "Alcatraz'dan Kaçış" → "alcatrazdan-kacis").
 */
export function slugifyForDizipal(title: string): string {
  return foldTurkishDotlessI(title.toLowerCase())
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes are removed (not dashed) — Dizipal slugs "Alcatraz'dan" as
    // "alcatrazdan" and "Don't" as "dont", matching how it drops them entirely.
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract the production year from a Dizipal title page. Deliberately
 * conservative: only structured spots count — JSON-LD release dates, a
 * year/yıl-classed element, the "Yapım Yılı" label, or a "(YYYY)" suffix in
 * the page/og title. A bare 4-digit number anywhere in the HTML is NOT
 * trusted. Returns null when nothing reliable is found so callers can decide
 * how to fail.
 */
export function extractDizipalPageYear(html: string): string | null {
  if (!html) return null;

  const jsonLd = html.match(
    /"(?:datePublished|dateCreated|releaseDate|startDate)"\s*:\s*"((?:19|20)\d{2})/i
  );
  if (jsonLd?.[1]) return jsonLd[1];

  const yearNode = html.match(
    /class=["'][^"']*\b(?:year|yil)\b[^"']*["'][^>]*>\s*((?:19|20)\d{2})\b/i
  );
  if (yearNode?.[1]) return yearNode[1];

  // Label and value may sit in adjacent tags (<td>Yapım Yılı</td><td>1984</td>),
  // so the gap may cross tag boundaries — but stays short to keep the match local.
  const yapimYili = html.match(/yap[ıi]m\s*y[ıi]l[ıi][^0-9]{0,60}?((?:19|20)\d{2})\b/i);
  if (yapimYili?.[1]) return yapimYili[1];

  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
  const ogTitle = html.match(/property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "";
  for (const candidate of [titleTag, ogTitle]) {
    const inParens = candidate.match(/\(((?:19|20)\d{2})\)/);
    if (inParens?.[1]) return inParens[1];
  }

  return null;
}

/**
 * Dizipal's `/ajax-search` caps at ~10 fuzzy results and buries short
 * common-word titles: e.g. searching "from" returns "Notes from the Last Row",
 * "Agent From Above", … but never the actual series "From", even though its
 * page exists at `/dizi/from`. When the normal search finds nothing, hit the
 * deterministic slug URL directly. Gated on HTTP 200 (Dizipal returns a real
 * 404 for missing pages) plus the same title-compatibility check the search
 * path uses, so a wrong slug fails closed rather than mismatching.
 *
 * Year disambiguation: Dizipal hosts same-title remakes at year-suffixed
 * slugs (extractDizipalTitleFromUrl strips a `-YYYY` suffix for exactly this
 * reason), so when the target year is known we probe `slug-year` first — a
 * hit there is year-verified by construction. A plain-slug movie hit is then
 * checked against the year printed on the page itself: /film/dune can be
 * Dune 1984 while the user tapped the 2021 poster, and title compatibility
 * alone can't tell them apart. TV keeps failing open on an unreadable page
 * year (regional premiere years drift), which preserves the "From" fix.
 */
async function probeDizipalDirectSlug(
  title: string,
  mediaType: "movie" | "tv",
  year?: string | null,
  originalTitle?: string,
): Promise<MatchResult | null> {
  const kind = mediaType === "movie" ? "film" : "dizi";
  const base = getDizipalBaseUrl();
  const baseSlugs = [title, originalTitle]
    .filter((value): value is string => Boolean(value))
    .map((value) => slugifyForDizipal(value))
    .filter((slug) => slug.length > 0);
  const slugs = Array.from(
    new Set(baseSlugs.flatMap((slug) => (year ? [`${slug}-${year}`, slug] : [slug])))
  );

  for (const slug of slugs) {
    // Every page slug on the rebuilt site ends in its own section:
    // /film/oppenheimer-film-izle, /dizi/breaking-bad-dizi-izle.
    const url = `${base}/${kind}/${slug}-${kind}-izle`;
    try {
      const response = await dizipalGet<string>(url, {
        timeout: 6000,
        // No explicit maxRedirects: Dizipal's rotation means a base that has
        // fallen a few days behind is a 10-20 hop 301 chain, and a cap of 5
        // turned that into a hard ERR_FR_TOO_MANY_REDIRECTS — this probe was
        // the one Dizipal call that failed outright on a stale base while the
        // others merely got slow. Axios' default 21 matches them.
        headers: { "User-Agent": UA, Referer: getDizipalReferer() },
        validateStatus: (status) => status === 200,
      });
      recordObservedBaseUrl("dizipal", getResponseFinalOrigin(response));

      if (!isDizipalUrlTitleCompatible(url, title, originalTitle)) continue;

      const isYearVerifiedSlug = Boolean(year) && slug.endsWith(`-${year}`);
      const pageYear = isYearVerifiedSlug
        ? year ?? null
        : extractDizipalPageYear(typeof response.data === "string" ? response.data : "");
      if (isYearIncompatible(pageYear, year)) {
        debugLog(
          `[WebPlayer] Dizipal direct-slug ${url} is year ${pageYear}, wanted ${year} — rejected`
        );
        continue;
      }
      // Movies with a known target year must positively confirm the page year:
      // same-title remakes share the plain slug, so an unreadable year is not
      // safe to play. (TV stays fail-open — see doc comment.)
      if (mediaType === "movie" && year && !pageYear) {
        debugLog(
          `[WebPlayer] Dizipal direct-slug ${url} has no readable year, wanted ${year} — rejected`
        );
        continue;
      }

      debugLog(`[WebPlayer] Dizipal direct-slug hit ${url} for "${title}"`);
      return { url, title, resultYear: pageYear ?? "" };
    } catch (error) {
      // Missing page (404) or network error — try the next slug candidate.
      noteProviderFailure(error);
    }
  }
  return null;
}

async function searchDizipal(title: string, mediaType: "movie" | "tv", year?: string | null, originalTitle?: string): Promise<MatchResult | null> {
  const safeOriginalTitle = isAlternateTitleSafeForDizipal(title, originalTitle) ? originalTitle : undefined;
  const { queries, bareTitleCount } = generateSearchQueries(title, year, safeOriginalTitle);
  const allResults = new Map<string, SearchResult>();

  for (let qi = 0; qi < queries.length; qi++) {
    const results = await queryDizipal(queries[qi], mediaType);
    for (const result of results) {
      if (result.href && !allResults.has(result.href)) {
        allResults.set(result.href, result);
      }
    }

    // Early exit if we already have a strong match
    const bestSoFar = Math.max(0, ...[...allResults.values()].map(r => {
      const s1 = scoreDizipalResult(r, title, year);
      const s2 = safeOriginalTitle ? scoreDizipalResult(r, safeOriginalTitle, year) : 0;
      return Math.max(s1, s2);
    }));
    if (bestSoFar >= 120) break;
    if (shouldStopSearchingAfterEmptyQueries(qi, allResults.size, bareTitleCount)) break;
    // Hard budget. It is a FLOOR of five rounds, raised when the title has more
    // than five distinct spellings, so the bare-name sweep can never be cut off
    // half-way through (see generateSearchQueries).
    if (qi + 1 >= Math.max(SEARCH_QUERY_BUDGET, bareTitleCount)) break;
  }

  if (allResults.size === 0) {
    return probeDizipalDirectSlug(title, mediaType, year, safeOriginalTitle);
  }

  const scored = [...allResults.entries()]
    .map(([href, result]) => ({
      href,
      score: Math.max(
        scoreDizipalResult(result, title, year),
        safeOriginalTitle ? scoreDizipalResult(result, safeOriginalTitle, year) : 0
      ),
      title: result.title,
      resultYear: result.resultYear,
      qualityWarning: detectQualityWarning(result)
    }))
    .filter((entry) => {
      if (entry.score < 80) return false;
      // Same hard year gate as HDFilm: if the user clicked a specific
      // year's poster (e.g. Dune 2021), never substitute a same-title
      // different-year movie (Dune 1984) just because the title scored
      // high enough after the -55 penalty.
      if (isYearIncompatible(entry.resultYear, year)) return false;
      return isDizipalUrlTitleCompatible(entry.href, title, safeOriginalTitle);
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Fuzzy search returned candidates but none matched (e.g. short
    // common-word titles like "From" drowned out by "…from…" results).
    return probeDizipalDirectSlug(title, mediaType, year, safeOriginalTitle);
  }
  return {
    url: scored[0].href,
    qualityWarning: scored[0].qualityWarning,
    title: scored[0].title,
    resultYear: scored[0].resultYear,
    score: scored[0].score
  };
}

/**
 * An HTML attribute value as written in markup → the string the DOM exposes.
 * Since 2026-09-18 Dizipal's `data-cfg` is a JSON object serialised with
 * `&quot;` entities; `dataset.cfg` in the browser decodes them, so the site's
 * own POST carries real quotes. Sending the raw markup gets "Invalid config".
 */
function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&#x0*22;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&"); // last, so "&amp;quot;" does not double-decode
}

function extractDizipalTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url, getDizipalBaseUrl());
    const segments = parsed.pathname.split("/").filter(Boolean);
    // An episode lives at /dizi/{slug}/{n}-sezon/{n}-bolum, so the last segment
    // is the episode number — the title is the segment after the section.
    const isEpisode = /^\d+-bolum$/i.test(segments[segments.length - 1] ?? "");
    const rawSlug = (isEpisode ? segments[1] : segments[segments.length - 1]) ?? "";
    const cleanedSlug = decodeURIComponent(rawSlug)
      .replace(/-\d+-sezon-\d+-bolum$/i, "")
      // The rebuilt site suffixes every page slug: "oppenheimer-film-izle".
      .replace(/-(?:film|dizi)-izle$/i, "")
      .replace(/-\d{4}$/i, "")
      .replace(/-(?:turkce-dublaj|turkce-altyazili|altyazili|dublaj|izle)$/i, "")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleanedSlug;
  } catch {
    return "";
  }
}

function isDizipalUrlTitleCompatible(
  url: string,
  title: string,
  originalTitle?: string,
): boolean {
  const slugTitle = extractDizipalTitleFromUrl(url);
  if (!slugTitle) return false;

  if (hasStrictTitleIdentity(slugTitle, title)) return true;

  if (isAlternateTitleSafeForDizipal(title, originalTitle)) {
    return hasStrictTitleIdentity(slugTitle, originalTitle ?? "");
  }

  if (isShortOrAcronymTitle(title)) return false;

  const titleScore = scoreStrictDizipalTitle(slugTitle, title);
  const originalScore = originalTitle ? scoreStrictDizipalTitle(slugTitle, originalTitle) : 0;

  return Math.max(titleScore, originalScore) >= 80;
}

async function fetchDizipalPageHtml(pageUrl: string): Promise<string | null> {
  try {
    const response = await dizipalGet<string>(pageUrl, {
      timeout: 7000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: getDizipalReferer()
      }
    });

    recordObservedBaseUrl("dizipal", getResponseFinalOrigin(response));

    return response.data;
  } catch {
    return null;
  }
}

type SubtitleTrack = {
  url: string;
  label: string;
  lang: string;
};

type DizipalStreamInfo = {
  streamUrl: string;
  streamType: string;
  poster: string;
  referer: string;
  subtitles: SubtitleTrack[];
  preferNative?: boolean;
};

const HDFILM_NATIVE_FALLBACK_CACHE_LIMIT = 80;
const hdfilmNativeFallbackCache = new Map<string, Promise<DizipalStreamInfo | null>>();

function getStreamTypeFromUrl(url: string): string {
  return /\.m3u8(?:[?#].*)?$/i.test(url) ? "m3u8" : "mp4";
}

function isDirectStreamUrl(url: string): boolean {
  return /\.(?:m3u8|mp4)(?:[?#].*)?$/i.test(url);
}

function isTrustedHdFilmEmbedUrl(url: string): boolean {
  return /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape/i.test(url);
}

function getCachedHdFilmNativeFallback(pageUrl: string, pageHtml: string) {
  const cacheKey = pageUrl;
  const cached = hdfilmNativeFallbackCache.get(cacheKey);
  if (cached) return cached;

  const task = resolveHdFilmNativeFallback(pageUrl, pageHtml);
  hdfilmNativeFallbackCache.set(cacheKey, task);
  // Only a success is worth remembering. A miss (embed unreachable, decoder
  // rotated) memoised for the whole session made the resolver's own retry and
  // every manual Retry return the same cached null instantly.
  void task.then(
    (stream) => {
      if (!stream && hdfilmNativeFallbackCache.get(cacheKey) === task) hdfilmNativeFallbackCache.delete(cacheKey);
    },
    () => {
      if (hdfilmNativeFallbackCache.get(cacheKey) === task) hdfilmNativeFallbackCache.delete(cacheKey);
    }
  );

  if (hdfilmNativeFallbackCache.size > HDFILM_NATIVE_FALLBACK_CACHE_LIMIT) {
    const oldestKey = hdfilmNativeFallbackCache.keys().next().value;
    if (oldestKey) hdfilmNativeFallbackCache.delete(oldestKey);
  }

  return task;
}

function rot13(value: string): string {
  return caesarShift(value, 13);
}

/**
 * Final byte de-scramble shared by every Rapidrame obfuscation scheme:
 * each char is shifted back by `<modConstant> % (i + 5)`.
 *
 * The provider rotates `modConstant` inside the inline `dc_*()` helper on the
 * embed page (observed: 399756995 → 112511818). We parse the live value from
 * the embed HTML at runtime (see parseRapidrameUnmixConstant) so a rotation of
 * just this number can no longer break playback; the known values below are
 * fallbacks for the rare case the parse misses.
 */
const KNOWN_RAPIDRAME_UNMIX_CONSTANTS = [3708627584, 112511818, 399756995];
// The `(i + N)` divisor offset inside the unmix loop. The provider rotated it
// from 5 to 10; both are tried so an embed on either scheme still decodes.
const KNOWN_RAPIDRAME_UNMIX_OFFSETS = [10, 5];

type RapidrameUnmixParams = { constant: number; offset: number };

function unmixRapidrameBytes(
  value: string,
  modConstant = KNOWN_RAPIDRAME_UNMIX_CONSTANTS[0],
  offset = KNOWN_RAPIDRAME_UNMIX_OFFSETS[0]
): string {
  let unmix = "";
  for (let index = 0; index < value.length; index += 1) {
    const nextCode = (value.charCodeAt(index) - (modConstant % (index + offset)) + 256) % 256;
    unmix += String.fromCharCode(nextCode);
  }
  return unmix;
}

/**
 * Read the unmix constant AND the divisor offset straight out of the embed
 * page's `dc_*()` body, e.g. `charCode - (3708627584 % (i + 10))`. Both numbers
 * are rotated by the provider (offset seen: 5 → 10), so we parse whatever is
 * live. Returns null when the shape changed enough that the numbers aren't
 * where we expect — the caller then falls back to the known values.
 */
function parseRapidrameUnmixConstant(embedHtml: string): RapidrameUnmixParams | null {
  const match = embedHtml.match(/(\d{6,})\s*%\s*\(\s*[A-Za-z_$][\w$]*\s*\+\s*(\d+)\s*\)/);
  if (!match) return null;
  const constant = Number(match[1]);
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(constant) || constant <= 0) return null;
  if (!Number.isSafeInteger(offset) || offset <= 0) return null;
  return { constant, offset };
}

/**
 * Pre-`unmix` transforms for the Rapidrame `s_*` source array, newest first.
 *
 * Rapidrame periodically rotates the obfuscation that wraps the stream URL
 * (the inline `dc_*()` helper on the embed page). We don't control that page,
 * so instead of hardcoding a single scheme we try each KNOWN scheme and let
 * the caller keep the first candidate that decodes to a real http(s) URL.
 *
 *  - "double-base64" (current): join → reverse → base64 → base64 → unmix
 *  - "rot13-legacy"  (older):   join → base64 → rot13 → reverse → unmix
 *
 * If the provider flips between these, playback keeps working with no release.
 */
const RAPIDRAME_PRE_UNMIX_TRANSFORMS: Array<(joined: string) => string> = [
  // Current scheme (Aug 2026): reverse → base64 → caesar(+18) → base64.
  // The dc_*() body applies three reverses (net one) before the first base64.
  (joined) => decodeBase64Binary(caesarShift(decodeBase64Binary(reverseString(joined)), 18)),
  (joined) => rot13(decodeBase64Binary(reverseString(joined))), // auto-derived by check-hdfilm-resolver
  (joined) => reverseString(decodeBase64Binary(rot13(joined))), // auto-derived by check-hdfilm-resolver
  (joined) => decodeBase64Binary(rot13(reverseString(joined))), // auto-derived by check-hdfilm-resolver
  // Current scheme — reverse the joined parts, then base64-decode twice.
  (joined) => decodeBase64Binary(decodeBase64Binary(reverseString(joined))),
  // Legacy scheme — base64-decode once, rot13, then reverse.
  (joined) => reverseString(rot13(decodeBase64Binary(joined)))
];

/**
 * Decode the Rapidrame `s_*` parts array into the underlying stream URL.
 * Returns every scheme's candidate so the caller can pick the valid URL;
 * an unrecognised/garbage decode simply fails the http(s) check upstream.
 *
 * `modConstant` is the value parsed from the live embed page when available.
 * We try it first, then the known constants, so playback survives a rotation
 * of just the unmix number even if the parse fails.
 */
function decodeRapidrameValueCandidates(
  valueParts: string[],
  unmixParams?: RapidrameUnmixParams | null
): string[] {
  const joined = valueParts.join("");
  const constants = Array.from(
    new Set([...(unmixParams ? [unmixParams.constant] : []), ...KNOWN_RAPIDRAME_UNMIX_CONSTANTS])
  );
  const offsets = Array.from(
    new Set([...(unmixParams ? [unmixParams.offset] : []), ...KNOWN_RAPIDRAME_UNMIX_OFFSETS])
  );
  const candidates: string[] = [];
  for (const transform of RAPIDRAME_PRE_UNMIX_TRANSFORMS) {
    let transformed: string;
    try {
      transformed = transform(joined);
    } catch {
      continue;
    }
    for (const constant of constants) {
      for (const offset of offsets) {
        try {
          candidates.push(unmixRapidrameBytes(transformed, constant, offset));
        } catch {
          /* skip this constant/offset pair */
        }
      }
    }
  }
  return candidates;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Index of `var <name>` / `let <name>` / `const <name>`, matched on a whole
 * identifier so `var s_a` is not found inside `var s_abc`.
 */
function findVariableDeclaration(html: string, name: string): number {
  return html.search(new RegExp(`\\b(?:var|let|const)\\s+${escapeRegExp(name)}\\b`));
}

function extractJsonArrayLiteral(value: string): string | null {
  const start = value.indexOf("[");
  if (start === -1) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

/** `text` up to its first `;` outside a string literal (all of it if none). */
function sliceStatement(text: string): string {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ";") return text.slice(0, index);
  }
  return text;
}

/** The JS string literal starting at `text[start]`, decoded, plus where it ends. */
function readStringLiteral(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return null;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char !== quote) continue;
    const inner = text.slice(start + 1, index);
    // JSON covers every escape the provider emits; a single-quoted body only
    // needs its quotes swapped round first.
    const asJson = quote === '"' ? inner : inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
    try {
      return { value: JSON.parse(`"${asJson}"`) as string, end: index + 1 };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The decoder's argument, as string parts. Two call forms are live:
 *   name(["a","b",…])            — array literal (until 2026-09-19)
 *   name("a|b|…".split("|"))     — delimited string (since 2026-09-20)
 * `declarationSnippet` starts at `var <sourceVariable>`; only that statement is
 * read, so an unrelated `[` later in the script (the decoy `hzz2([...])` call,
 * the jwplayer setup) can never be picked up.
 */
function extractRapidrameParts(declarationSnippet: string): string[] | null {
  const statement = sliceStatement(declarationSnippet);
  const open = statement.indexOf("(");
  if (open === -1) return null;

  let cursor = open + 1;
  while (/\s/.test(statement[cursor] ?? "")) cursor += 1;

  let parts: unknown;
  if (statement[cursor] === "[") {
    const literal = extractJsonArrayLiteral(statement.slice(cursor));
    if (!literal) return null;
    try {
      parts = JSON.parse(literal);
    } catch {
      return null;
    }
  } else {
    const literal = readStringLiteral(statement, cursor);
    if (!literal) return null;
    const split = statement.slice(literal.end).match(/^\s*\.\s*split\s*\(\s*/);
    if (!split) return null;
    const separatorStart = literal.end + split[0].length;
    const separator = readStringLiteral(statement, separatorStart);
    if (!separator || !/^\s*\)/.test(statement.slice(separator.end))) return null;
    parts = literal.value.split(separator.value);
  }

  return Array.isArray(parts) && parts.length > 0 && parts.every((part) => typeof part === "string")
    ? parts
    : null;
}

function normalizeExtractedMediaUrl(value: string | null): string | null {
  const normalized = value
    ?.replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  return normalized && /^https?:\/\//i.test(normalized) ? normalized : null;
}

function isRapidrameNativeSafeStream(streamUrl: string): boolean {
  return isDirectStreamUrl(streamUrl);
}

/**
 * Inline packer.js (`eval(function(p,a,c,k,e,d){...}(...))`) unpacker.
 *
 * The HDFilmCehennemi /rplayer/ flow wraps its `dc_*()` decoder AND the
 * `var s_* = dc_*([...])` parts assignment inside one of these packed blocks.
 * Without unpacking we can't see the assignment, so `extractRapidrameStreamUrl`
 * fails its regex lookup and the result falls back to the WebView player — which
 * is what kept titles like "Still Alice" / "Unutma Beni" off the native path
 * even after the global decoder scheme was fixed.
 *
 * Returns the original HTML with the FIRST packed block replaced by its
 * expansion. Idempotent / safe to call on HTML with no packed block.
 */
function tryUnpackInlinePackerJs(html: string): string {
  const match = html.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*?)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*?)'\.split\('\|'\)/);
  if (!match) return html;

  const [fullEvalPrefix, payload, baseStr, , wordsStr] = match;
  const base = parseInt(baseStr, 10);
  if (!Number.isFinite(base) || base < 2 || base > 62) return html;

  const words = wordsStr.split("|");
  const digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function fromBase(token: string): number {
    let n = 0;
    for (const ch of token) {
      const v = digits.indexOf(ch);
      if (v < 0 || v >= base) return -1;
      n = n * base + v;
    }
    return n;
  }

  const expanded = payload.replace(/\b\w+\b/g, (token) => {
    const idx = fromBase(token);
    if (idx < 0 || idx >= words.length) return token;
    const word = words[idx];
    return word === "" ? token : word;
  });

  // Replace the full eval(...) call — find its closing paren by scanning from
  // the start of the match. Regex-only matching is fragile around the trailing
  // `{}))` so we walk parentheses to be safe.
  const startIdx = html.indexOf(fullEvalPrefix);
  if (startIdx < 0) return html;
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx + "eval".length; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx < 0) return html;
  return html.slice(0, startIdx) + expanded + html.slice(endIdx + 1);
}

/**
 * Interpret the live `dc_*()` decoder body instead of matching it to a fixed
 * scheme. HDFilm RANDOMIZES the decoder per request — the reverse count, the
 * Caesar shifts, the de-scramble constants, and (since Aug 2026) the whole
 * de-scramble family all change on every embed fetch — so no static transform
 * list can keep up.
 *
 * The body is plain, un-obfuscated JS. `runRapidrameDecoder` parses and replays
 * it (see rapidrameScript.ts for why that is safe and what subset is allowed).
 * Returns null if the body steps outside that subset, so the caller can fall
 * back to the static schemes.
 */
function decodeRapidrameByInterpretingDcBody(embedHtml: string, sourceVariable: string, valueParts: string[]): string | null {
  const assignmentIndex = findVariableDeclaration(embedHtml, sourceVariable);
  if (assignmentIndex === -1) return null;

  // The decoder used to be named `dc_*`; since Sep 2026 it is a random short
  // identifier, so match any callee here and let the `function <name>` lookup
  // below decide whether it is a real local function. A built-in like `atob`
  // simply finds no declaration and falls through to the static schemes.
  const decoderName = embedHtml
    .slice(assignmentIndex, assignmentIndex + 120)
    .match(/=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/)?.[1];
  if (!decoderName) return null;

  // `function name(…) {…}` until 2026-09-19; since then a function EXPRESSION,
  // `var name = function (…) {…};`, which is rewritten into the declaration
  // form the interpreter parses.
  let fnStart = embedHtml.search(new RegExp(`\\bfunction\\s+${escapeRegExp(decoderName)}\\s*\\(`));
  let declarationPrefix = "";
  if (fnStart === -1) {
    const expression = new RegExp(
      `\\b(?:var|let|const)\\s+${escapeRegExp(decoderName)}\\s*=\\s*function\\s*\\(`
    ).exec(embedHtml);
    if (!expression) return null;
    fnStart = embedHtml.indexOf("(", expression.index + expression[0].length - 1);
    declarationPrefix = `function ${decoderName}`;
  }

  const braceStart = embedHtml.indexOf("{", fnStart);
  if (braceStart === -1) return null;

  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < embedHtml.length; i += 1) {
    const ch = embedHtml[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) { braceEnd = i; break; }
    }
  }
  if (braceEnd === -1) return null;

  return runRapidrameDecoder(declarationPrefix + embedHtml.slice(fnStart, braceEnd + 1), valueParts);
}

function extractRapidrameStreamUrl(embedHtmlInput: string): string | null {
  // Unpack any inline packer.js block first. For the older /video/embed/ flow
  // this is a no-op (no packed block). For the newer /rplayer/ flow it's what
  // makes the `s_* = dc_*(…)` assignment visible to the regex below.
  const embedHtml = tryUnpackInlinePackerJs(embedHtmlInput);
  // The parts variable was `s_*` until Sep 2026 and is a random short
  // identifier since, so match any identifier. A quoted URL (`file: "http…"`)
  // is not an identifier and correctly falls through to the m3u8 scrape.
  const sourceVariable = embedHtml.match(
    /sources\s*:\s*\[\s*\{\s*file\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/
  )?.[1];
  if (!sourceVariable) {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }

  const variableIndex = findVariableDeclaration(embedHtml, sourceVariable);
  if (variableIndex === -1) {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }

  // Wide enough for the largest parts payload seen in the wild (~6 KB); the
  // statement scanner in extractRapidrameParts stops at the `;` regardless.
  const variableSnippet = embedHtml.slice(variableIndex, variableIndex + 16000);
  const parts = extractRapidrameParts(variableSnippet);
  if (!parts) {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }

  // Read the live unmix constant + divisor offset from the dc_*() body so a
  // rotation of just those numbers (the provider's most common change)
  // self-heals without a release.
  const unmixParams = parseRapidrameUnmixConstant(embedHtml);

  try {
    // Primary path: interpret the live dc_*() body (handles the per-request
    // randomized schemes). Falls through to the static schemes on any mismatch.
    const interpreted = decodeRapidrameByInterpretingDcBody(embedHtml, sourceVariable, parts);
    const normalizedInterpreted = interpreted ? normalizeExtractedMediaUrl(interpreted) : null;
    if (normalizedInterpreted) return normalizedInterpreted;

    // Fallback: try every known static Rapidrame scheme and keep the first
    // candidate that normalizes to a real http(s) URL.
    for (const candidate of decodeRapidrameValueCandidates(parts, unmixParams)) {
      const normalized = normalizeExtractedMediaUrl(candidate);
      if (normalized) return normalized;
    }

    // No scheme produced a usable URL — fall back to scraping a plain m3u8.
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  } catch {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }
}

function extractHdFilmEmbedUrl(pageHtml: string, pageUrl: string): string | null {
  // Iframe URLs may live on a few different attributes depending on how the
  // page was authored. Some titles (e.g. "Still Alice" / "Unutma Beni") use
  // lazy-loaded iframes where the real URL is on `data-src` and `src` is
  // empty or absent — missing this case sends the user to the WebView player
  // instead of native expo-video, which is the same fragile path that caused
  // the POCO F7 black-screen-on-pre-roll incident.
  const iframeAttrRegexes = [
    /<iframe[^>]+\bsrc=["']([^"']+)["']/i,
    /<iframe[^>]+\bdata-src=["']([^"']+)["']/i,
    /<iframe[^>]+\bdata-lazy-src=["']([^"']+)["']/i
  ];
  for (const regex of iframeAttrRegexes) {
    const match = pageHtml.match(regex);
    if (match?.[1] && /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer/i.test(match[1])) {
      return toAbsoluteUrl(pageUrl, match[1]);
    }
  }

  const dataVideoMatch = pageHtml.match(/data-(?:video|link|url)=["']([^"']+)["']/i);
  if (dataVideoMatch?.[1] && /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer/i.test(dataVideoMatch[1])) {
    return toAbsoluteUrl(pageUrl, dataVideoMatch[1]);
  }

  return null;
}

function extractRapidrameSubtitles(embedHtml: string): SubtitleTrack[] {
  const subtitles: SubtitleTrack[] = [];
  const trackBlock = embedHtml.match(/tracks\s*:\s*(\[[\s\S]*?\])\s*,\s*captions\s*:/i)?.[1];
  if (!trackBlock) return subtitles;

  const regex = /"file"\s*:\s*"([^"]+)"[\s\S]*?"kind"\s*:\s*"captions"[\s\S]*?"label"\s*:\s*"([^"]*)"/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(trackBlock)) !== null) {
    const url = match[1].replace(/\\\//g, "/");
    const label = match[2] || "Subtitle";
    const langMatch = url.match(/[-_/]([a-z]{2,3})(?:[-_.][^/?#]*)?\.vtt/i);
    subtitles.push({ url, label, lang: langMatch?.[1] ?? label.toLowerCase().slice(0, 3) });
  }

  return subtitles;
}

type RapidramePlaylistInspection = {
  preferNative: boolean;
  childPlaylistUrls: string[];
};

const HDFILM_NATIVE_PLAYLIST_PROBE_LIMIT = 3;

function getPlaylistMediaLines(playlist: string): string[] {
  return playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function resolvePlaylistUrl(baseUrl: string, value: string): string | null {
  const cleaned = value.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) return null;
  return toAbsoluteUrl(baseUrl, cleaned);
}

function inspectRapidramePlaylist(playlist: string, playlistUrl: string): RapidramePlaylistInspection {
  if (!playlist || !playlist.includes("#EXTM3U")) {
    return { preferNative: false, childPlaylistUrls: [] };
  }

  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const mediaLines = getPlaylistMediaLines(playlist);
  const hasVariantPlaylist = /#EXT-X-STREAM-INF/i.test(playlist);
  const hasMediaSegments = /#EXTINF/i.test(playlist);
  const usesDisguisedImageSegments = mediaLines.some((line) =>
    /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(line)
  );

  const childPlaylistUrls: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/#EXT-X-STREAM-INF/i.test(lines[index])) continue;
    const nextLine = lines.slice(index + 1).find((line) => line && !line.startsWith("#"));
    if (!nextLine) continue;
    const childUrl = resolvePlaylistUrl(playlistUrl, nextLine);
    if (childUrl && !childPlaylistUrls.includes(childUrl)) {
      childPlaylistUrls.push(childUrl);
    }
  }

  for (const mediaLine of mediaLines) {
    if (!/\.m3u8(?:[?#].*)?$/i.test(mediaLine)) continue;
    const childUrl = resolvePlaylistUrl(playlistUrl, mediaLine);
    if (childUrl && childUrl !== playlistUrl && !childPlaylistUrls.includes(childUrl)) {
      childPlaylistUrls.push(childUrl);
    }
  }

  // Rapidrame sometimes serves real transport-stream bytes through .jpg segment URLs.
  // Android WebView/JWPlayer can play audio for those uploads while the video surface
  // stays black, but expo-video handles the same HLS stream reliably.
  const preferNative = hasMediaSegments && !hasVariantPlaylist && usesDisguisedImageSegments;

  return { preferNative, childPlaylistUrls };
}

async function fetchHlsPlaylist(url: string, referer: string): Promise<string | null> {
  try {
    const response = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
        Referer: referer
      },
      transformResponse: [(data) => (typeof data === "string" ? data : String(data ?? ""))]
    });

    return response.data;
  } catch {
    return null;
  }
}

async function shouldPreferNativeForRapidrameStream(streamUrl: string, referer: string): Promise<boolean> {
  const playlist = await fetchHlsPlaylist(streamUrl, referer);
  if (!playlist) return false;

  const rootInspection = inspectRapidramePlaylist(playlist, streamUrl);
  if (rootInspection.preferNative) return true;

  const childUrls = rootInspection.childPlaylistUrls.slice(0, HDFILM_NATIVE_PLAYLIST_PROBE_LIMIT);
  if (childUrls.length === 0) return false;

  const childPlaylists = await Promise.all(
    childUrls.map((childUrl) => fetchHlsPlaylist(childUrl, referer).then((childPlaylist) => ({
      childUrl,
      childPlaylist
    })))
  );

  for (const { childUrl, childPlaylist } of childPlaylists) {
    if (!childPlaylist) continue;
    if (inspectRapidramePlaylist(childPlaylist, childUrl).preferNative) {
      return true;
    }
  }

  return false;
}

async function resolveHdFilmNativeFallback(pageUrl: string, pageHtml: string): Promise<DizipalStreamInfo | null> {
  const embedUrl = extractHdFilmEmbedUrl(pageHtml, pageUrl);
  if (!embedUrl) return null;

  try {
    const response = await hdFilmGet<string>(embedUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: pageUrl
      }
    });

    const streamUrl = extractRapidrameStreamUrl(response.data);
    if (!streamUrl) return null;
    const preferNative = isRapidrameNativeSafeStream(streamUrl)
      ? true
      : await shouldPreferNativeForRapidrameStream(streamUrl, embedUrl);

    return {
      streamUrl,
      streamType: "m3u8",
      poster: "",
      referer: embedUrl,
      subtitles: extractRapidrameSubtitles(response.data),
      preferNative
    };
  } catch {
    return null;
  }
}

export async function resolveHdFilmRuntimeStream(discoveredUrl: string, pageUrl: string): Promise<WebPlayerResult | null> {
  const absoluteUrl = toAbsoluteUrl(pageUrl, discoveredUrl);
  if (!absoluteUrl) return null;

  if (isDirectStreamUrl(absoluteUrl)) {
    return {
      url: absoluteUrl,
      source: "direct",
      streamUrl: absoluteUrl,
      streamType: getStreamTypeFromUrl(absoluteUrl),
      referer: pageUrl,
      embedUrl: pageUrl,
      subtitles: []
    };
  }

  if (!isTrustedHdFilmEmbedUrl(absoluteUrl)) return null;

  try {
    const response = await hdFilmGet<string>(absoluteUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: pageUrl
      }
    });

    const streamUrl = extractRapidrameStreamUrl(response.data);
    if (streamUrl) {
      return {
        url: streamUrl,
        source: "direct",
        streamUrl,
        streamType: getStreamTypeFromUrl(streamUrl),
        poster: "",
        referer: absoluteUrl,
        embedUrl: absoluteUrl,
        subtitles: [
          ...extractRapidrameSubtitles(response.data),
          ...extractSubtitlesFromEmbedHtml(response.data)
        ]
      };
    }

    const embedStream = await resolveEmbedToM3u8(absoluteUrl, pageUrl);
    if (!embedStream) return null;

    return {
      url: embedStream.streamUrl,
      source: "direct",
      streamUrl: embedStream.streamUrl,
      streamType: embedStream.streamType,
      poster: embedStream.poster,
      referer: embedStream.referer || absoluteUrl,
      embedUrl: absoluteUrl,
      subtitles: embedStream.subtitles
    };
  } catch {
    return null;
  }
}

function extractM3u8FromEmbedHtml(html: string): string | null {
  const sourcesMatch = html.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
  if (sourcesMatch?.[1]) return sourcesMatch[1];

  const fileMatch = html.match(/file\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
  if (fileMatch?.[1]) return fileMatch[1];

  const srcMatch = html.match(/src\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
  if (srcMatch?.[1]) return srcMatch[1];

  return null;
}

function extractSubtitlesFromEmbedHtml(html: string): Array<{ url: string; label: string; lang: string }> {
  const subs: Array<{ url: string; label: string; lang: string }> = [];
  const regex = /file\s*:\s*"([^"]+\.vtt[^"]*)"\s*,\s*label\s*:\s*"([^"]*)"\s*,\s*kind\s*:\s*"captions"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1];
    const label = match[2];
    const langMatch = url.match(/_([a-z]{2,3})\.vtt/i);
    subs.push({ url, label, lang: langMatch?.[1] ?? label.toLowerCase().slice(0, 3) });
  }
  return subs;
}

function extractVideoHash(embedUrl: string, html: string): string | null {
  const urlPathMatch = embedUrl.match(/\/video\/([a-f0-9]{20,})/i);
  if (urlPathMatch?.[1]) return urlPathMatch[1];

  const embedPathMatch = embedUrl.match(/\/embed-([a-z0-9]{8,})\.html/i);
  if (embedPathMatch?.[1]) return embedPathMatch[1];

  const firePlayerMatch = html.match(/FirePlayer\s*\(\s*["']([a-f0-9]{20,})["']/i);
  if (firePlayerMatch?.[1]) return firePlayerMatch[1];

  const fileIdMatch = html.match(/file_id['"]\s*,\s*['"](\d+)['"]/i);
  if (fileIdMatch?.[1]) return fileIdMatch[1];

  return null;
}

/**
 * FirePlayer's `playerjsSubtitle` list: "[Label]url,[Label]url". imagestoo
 * writes ROOT-RELATIVE urls ("[Turkish]/netflix/altyazi/CMS01E01.srt"), which
 * resolve against the embed. Dropping them (Criminal Minds, 2026-09) left the
 * CC menu with ExoPlayer's copy of the same file from the master playlist,
 * where LANGUAGE="" reads as `",name=` and a raw .srt is not a loadable HLS
 * rendition, so picking it did nothing.
 */
function extractSubtitlesFromPlayerJs(html: string, embedUrl: string): SubtitleTrack[] {
  const match = html.match(/playerjsSubtitle\s*=\s*"([^"]+)"/);
  if (!match?.[1]) return [];

  const subs: SubtitleTrack[] = [];
  for (const part of match[1].split(",")) {
    const m = part.match(/\[([^\]]+)\]\s*(\S+)/);
    if (!m || !/^(?:https?:\/\/|\/)/i.test(m[2])) continue;
    const url = toAbsoluteUrl(embedUrl, m[2]);
    if (!url) continue;
    const label = m[1].trim();
    const langMatch = url.match(/_([a-z]{2,3})\.vtt/i);
    subs.push({ url, label, lang: langMatch?.[1] ?? label.toLowerCase().slice(0, 3) });
  }
  return subs;
}

async function resolveViaGetVideoApi(embedUrl: string, html: string): Promise<DizipalStreamInfo | null> {
  const hash = extractVideoHash(embedUrl, html);
  if (!hash) return null;

  const embedOrigin = new URL(embedUrl).origin;

  try {
    const resp = await axios.post<{
      hls?: boolean;
      videoSource?: string;
      securedLink?: string;
    }>(
      `${embedOrigin}/player/index.php?data=${hash}&do=getVideo`,
      `hash=${encodeURIComponent(hash)}&r=${encodeURIComponent(getDizipalReferer())}`,
      {
        timeout: 8000,
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: embedUrl
        }
      }
    );

    const m3u8 = resp.data?.securedLink || resp.data?.videoSource || "";
    if (!m3u8 || (!m3u8.includes(".m3u8") && !m3u8.includes(".mp4"))) {
      return null;
    }

    const subs = [
      ...extractSubtitlesFromPlayerJs(html, embedUrl),
      ...extractSubtitlesFromEmbedHtml(html)
    ];
    const seen = new Set<string>();
    const uniqueSubs = subs.filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    return {
      streamUrl: m3u8,
      streamType: m3u8.includes(".m3u8") ? "m3u8" : "mp4",
      poster: "",
      referer: embedUrl,
      subtitles: uniqueSubs
    };
  } catch (e) {
    noteProviderFailure(e);
    return null;
  }
}

async function resolveEmbedToM3u8(embedUrl: string, referer: string): Promise<DizipalStreamInfo | null> {
  try {
    const resp = await axios.get<string>(embedUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: referer
      }
    });

    const html = resp.data;

    const m3u8 = extractM3u8FromEmbedHtml(html);
    if (m3u8) {
      const subs = extractSubtitlesFromEmbedHtml(html);
      return {
        streamUrl: m3u8,
        streamType: "m3u8",
        poster: "",
        referer: embedUrl,
        subtitles: subs
      };
    }

    const apiResult = await resolveViaGetVideoApi(embedUrl, html);
    if (apiResult) return apiResult;

    return null;
  } catch (e) {
    noteProviderFailure(e);
    return null;
  }
}

type DizipalStreamResult = {
  stream: DizipalStreamInfo | null;
  embedUrl: string | null;
};

/**
 * Mint a fresh token and exchange the page's `cfg` for the player config.
 *
 * Two properties of the live endpoint drive this shape:
 *  - the token is SINGLE-USE, so it must be fetched immediately before each
 *    POST and can never be cached or replayed; and
 *  - validation covers the whole cookie set (`_ct`, `PHPSESSID` and the
 *    DDoS-Guard `__ddg*` cookies), not just `_ct`. Hand-setting a `Cookie`
 *    header REPLACES the platform cookie jar for that request, dropping the
 *    others and failing validation — verified against the live endpoint. So we
 *    let the native cookie store (OkHttp / NSURLSession) carry them and only
 *    fall back to an explicit header if the jar-based attempt is rejected,
 *    which covers runtimes without a cookie jar.
 */
/**
 * Dizipal's `data-cfg` attribute is base64(url) of the exact JSON the
 * player-config endpoint hands back: `{"v":…,"t":…,"p":…}`. Decoding it on
 * device skips a token mint plus a POST (two round-trips on the critical path
 * of every play) and, more importantly, keeps playback working across the
 * endpoint renames the provider does every few months — 2026-09's
 * `/ajax-player-config` → `/ajax/player-config` move broke every Dizipal
 * title until this landed.
 *
 * Returns null on anything that isn't the expected shape so the caller falls
 * back to the network path rather than playing something wrong.
 */

/**
 * Paths the player-config endpoint has lived at, newest first. Dizipal renamed
 * `/ajax-player-config` to `/ajax/player-config` in Sept 2026; the old path now
 * answers 404, which the caller treated as "no stream" and silently dropped
 * every Dizipal title. Both are tried so a rename in either direction is a
 * one-request penalty rather than an outage. `/ajax` is what the site's
 * `main.js` posts to since 2026-09-18; `/ajax/player-config` still answers as
 * of 2026-09-20.
 */

/**
 * Turn a watch page into a stream through the resolver Worker.
 *
 * WHY A WORKER. Dizipal's player host answers 403 "Attention Required" to our
 * users' networks for every dynamic path — `iframe.php`, `source2.php`, the
 * variant playlist `l.php` — while serving the static ones (the master
 * playlist, and the `.jpg`-disguised MPEG-TS segments on its CDN) perfectly.
 * The device can therefore stream Dizipal but cannot ASK for the stream, so
 * that one question is asked from Cloudflare's network, which the rule lets
 * through. The Worker hands back a playlist URL; the segments, which are all
 * of the bytes, still go straight from the CDN to the device.
 *
 * Nothing here is decrypted on-device: the blob, its passphrase and the whole
 * `openPlayer` chain live in `workers/dizipal-resolver`.
 */
const DIZIPAL_RESOLVER_TIMEOUT_MS = 10_000;

/**
 * Both hosts the resolver answers on, custom domain first: Bakcell's mobile
 * network cannot reach `*.workers.dev` at all (see `tmdb.ts`), so the zone
 * host has to be the one tried first, with workers.dev as the safety net for
 * a DNS or certificate problem on our own zone.
 */
const DIZIPAL_RESOLVER_BASE_URLS = [
  "https://dizipal.streamboxapp.stream",
  "https://streambox-dizipal-resolver.polyana-eam.workers.dev",
];
let activeDizipalResolverIndex = 0;

type DizipalResolverResponse = {
  stream?: string;
  streamType?: string;
  referer?: string;
  subtitles?: Array<{ url?: string; label?: string; lang?: string }>;
};

async function resolveDizipalStreamViaWorker(pageUrl: string): Promise<DizipalStreamInfo | null> {
  const payload = JSON.stringify({ url: pageUrl, base: getDizipalBaseUrl() });

  for (let attempt = 0; attempt < DIZIPAL_RESOLVER_BASE_URLS.length; attempt++) {
    const index = (activeDizipalResolverIndex + attempt) % DIZIPAL_RESOLVER_BASE_URLS.length;
    const host = DIZIPAL_RESOLVER_BASE_URLS[index];
    try {
      const response = await axios.post<DizipalResolverResponse>(`${host}/player`, payload, {
        timeout: DIZIPAL_RESOLVER_TIMEOUT_MS,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
      // Remember the host that answered: the other one costs a full timeout.
      activeDizipalResolverIndex = index;

      const data = response.data;
      if (!data?.stream || !/^https:\/\//i.test(data.stream)) {
        debugLog("[WebPlayer] Dizipal resolver returned no stream for", pageUrl);
        return null;
      }
      return {
        streamUrl: data.stream,
        streamType: data.streamType === "mp4" ? "mp4" : "m3u8",
        poster: "",
        referer: typeof data.referer === "string" ? data.referer : "",
        subtitles: (data.subtitles ?? [])
          .filter((track): track is { url: string; label?: string; lang?: string } =>
            typeof track?.url === "string" && /^https:\/\//i.test(track.url)
          )
          .map((track) => ({
            url: track.url,
            label: track.label?.trim() || "Altyazı",
            lang: track.lang && /^[a-z]{2,3}$/i.test(track.lang) ? track.lang.toLowerCase() : "und",
          })),
      };
    } catch (error: any) {
      // A 4xx is the resolver's answer — the page carried nothing playable —
      // and trying the other host would only repeat it.
      const status = error?.response?.status;
      debugLog(`[WebPlayer] Dizipal resolver ${host} failed:`, status ?? error?.message ?? error);
      if (typeof status === "number" && status >= 400 && status < 500) return null;
    }
  }

  return null;
}

async function fetchDizipalStreamUrl(pageUrl: string): Promise<DizipalStreamResult | null> {
  // The page is deliberately NOT read here. The player host binds the token
  // inside it to whoever fetched the page, so a page read on the device makes
  // the Worker's request 403 — the resolver has to do both halves itself.
  const stream = await resolveDizipalStreamViaWorker(pageUrl);
  return stream ? { stream, embedUrl: null } : null;
}

function matchesDizipalEpisodeUrl(url: string, seasonNumber: number, episodeNumber: number): boolean {
  // /dizi/{slug}/{season}-sezon/{episode}-bolum — the rebuilt site's shape.
  return new RegExp(`/dizi/[^/]+/${seasonNumber}-sezon/${episodeNumber}-bolum/?$`, "i").test(url);
}

async function findDizipalEpisodeUrl(
  seriesPageUrl: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  if (matchesDizipalEpisodeUrl(seriesPageUrl, seasonNumber, episodeNumber)) {
    return seriesPageUrl;
  }

  const html = await fetchDizipalPageHtml(seriesPageUrl);
  if (!html) return null;

  const episodeUrls = Array.from(
    new Set(
      extractHrefs(html)
        .map((href) => toAbsoluteUrl(seriesPageUrl, href))
        .filter((href): href is string => Boolean(href && /-bolum\/?$/i.test(href)))
    )
  );

  return episodeUrls.find((href) => matchesDizipalEpisodeUrl(href, seasonNumber, episodeNumber)) ?? null;
}

type DizipalResolveResult = {
  pageUrl: string;
  stream: DizipalStreamInfo | null;
  embedUrl: string | null;
  qualityWarning?: string;
};

async function resolvePlayableDizipalUrl(request: WebPlayerRequest): Promise<DizipalResolveResult | null> {
  const dizipalMatch = await searchDizipal(request.title, request.mediaType, request.year, request.originalTitle);
  if (!dizipalMatch) return null;

  let targetUrl = dizipalMatch.url;
  const qualityWarning = dizipalMatch.qualityWarning;

  if (request.mediaType === "tv" && request.seasonNumber && request.episodeNumber) {
    const episodeUrl = await findDizipalEpisodeUrl(
      dizipalMatch.url,
      request.seasonNumber,
      request.episodeNumber
    );
    if (!episodeUrl) return null;
    targetUrl = episodeUrl;
  } else if (request.mediaType === "tv") return null;

  if (!isDizipalUrlTitleCompatible(targetUrl, request.title, request.originalTitle)) {
    debugLog("[WebPlayer] Dizipal rejected mismatched page:", targetUrl, "for", request.title);
    return null;
  }

  const result = await fetchDizipalStreamUrl(targetUrl);
  if (result?.stream) {
    return { pageUrl: targetUrl, stream: result.stream, embedUrl: result.embedUrl, qualityWarning };
  }

  // No extractable stream. There is deliberately no "the page looks playable"
  // consolation result any more — see the caller: handing back a page or embed
  // shell only puts the user inside the provider's own player.
  return null;
}

// A result carries a real playable native stream (as opposed to a WebView
// fallback or "Not Available"). This is the only outcome worth stopping at.
export function isNativeResult(result: WebPlayerResult): boolean {
  return Boolean(result.streamUrl) && (result.source === "direct" || result.source === "dizipal_direct");
}

// Pick the better of two resolutions so a retry never returns something worse
// than the first attempt already found: native > any watchable page (WebView
// fallback / embed) > "Not Available".
export function preferResolution(a: WebPlayerResult, b: WebPlayerResult): WebPlayerResult {
  const rank = (r: WebPlayerResult) => (isNativeResult(r) ? 2 : r.source === "not_found" ? 0 : 1);
  return rank(b) > rank(a) ? b : a;
}

// Ceiling for a single pipeline pass, and for the whole resolve including the
// one retry. The common path (first pass returns native) is unaffected; only
// a degraded first pass pays for the refresh + retry, and never beyond the
// total ceiling — so the "Not Available" spinner stays bounded.
const RESOLVER_ATTEMPT_TIMEOUT_MS = RESOLVER_TOTAL_TIMEOUT_MS;
const RESOLVER_MAX_TOTAL_MS = 20_000;
const RESOLVER_RETRY_REFRESH_TIMEOUT_MS = 3_000;

/** The pipeline's answer, or `null` when it is still running after `timeoutMs`. */
async function awaitResolveWithin(
  pending: Promise<WebPlayerResult>,
  timeoutMs: number
): Promise<WebPlayerResult | null> {
  // Bound the wait. Without this, a combination of slow provider failures can
  // stack to 60-90 seconds and the user sees an unbounded spinner. The pass
  // itself is NOT cancelled — the caller can keep waiting on the same promise.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startResolvePass(request: WebPlayerRequest): Promise<WebPlayerResult> {
  // A rejection here is a bug, not a provider failure (every provider helper
  // swallows its own errors), but the caller races this promise twice, so it
  // must never reject.
  return resolveWebPlayerUrlInner(request).catch(() => ({ url: "", source: "not_found" }));
}

/** Published base URLs, to tell "the operator rotated a domain" from "nothing changed". */
function summariseProviderBaseUrls(): string {
  const configs = getAllProviderConfigs();
  return `${configs.hdfilm.baseUrl}|${configs.dizipal.baseUrl}|${configs.dizibal.baseUrl}`;
}

export async function resolveWebPlayerUrl(request: WebPlayerRequest): Promise<WebPlayerResult> {
  if (request.videoId) {
    return {
      url: request.videoId,
      source: "youtube_embed"
    };
  }

  // Wait briefly for provider config so we don't run against stale hardcoded URLs.
  await ensureProviderConfigReady();

  const deadline = Date.now() + RESOLVER_MAX_TOTAL_MS;
  const transientFailuresBefore = transientProviderFailures;
  const pending = startResolvePass(request);
  const first = await awaitResolveWithin(pending, RESOLVER_ATTEMPT_TIMEOUT_MS);
  if (first && isNativeResult(first)) return first;

  // Still running. It used to be abandoned here and the whole pipeline started
  // again from the top — re-paying for the very requests that were slow, with
  // less budget left than the first pass had. Wait on the pass already in
  // flight instead: a stale Dizipal domain, the usual cause, self-heals inside
  // it (recordObservedBaseUrl pins the post-redirect origin as soon as one
  // request completes), so the answer is on its way.
  if (!first) {
    const remainingForPass = deadline - Date.now();
    const late = remainingForPass > 0 ? await awaitResolveWithin(pending, remainingForPass) : null;
    return late ?? { url: "", source: "not_found" };
  }

  // A miss. When every provider actually answered and none had a native
  // stream, running them again changes nothing unless the published domains
  // moved — that is what makes "Not available" arrive after one pass for a
  // title that is genuinely on no provider. But a pass in which a request got
  // no answer proved nothing: the fetchers read a timeout as "no results", and
  // that is the "Not available, then it plays on the second tap" report. Take
  // the second tap for the viewer.
  const sawTransientFailure = transientProviderFailures !== transientFailuresBefore;
  const remaining = deadline - Date.now();
  if (remaining < 3_000) return first;

  const baseUrlsBefore = summariseProviderBaseUrls();
  await Promise.race([
    refreshProviderConfigs(),
    new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(RESOLVER_RETRY_REFRESH_TIMEOUT_MS, remaining))
    ),
  ]).catch(() => undefined);
  if (!sawTransientFailure && summariseProviderBaseUrls() === baseUrlsBefore) return first;

  const retryBudget = deadline - Date.now();
  if (retryBudget <= 0) return first;

  const retry = await awaitResolveWithin(startResolvePass(request), retryBudget);
  return retry ? preferResolution(first, retry) : first;
}

async function resolveWebPlayerUrlInner(request: WebPlayerRequest): Promise<WebPlayerResult> {
  // 1. HDFilm — only a real extracted stream counts. An HDFilm page whose
  //    decoder yields nothing used to be kept as a last-resort WebView result,
  //    which put the user inside hdfilmcehennemi's own player (pre-rolls, its
  //    controls) whenever no other provider had the title. Playback is native
  //    or it is "Not available"; the page is never a result.
  const isSeries = request.mediaType !== "movie";
  const hdfilmMatch = await findBestHdFilmMatch(request.title, request.castNames ?? [], request.year, request.originalTitle);

  const considerHdFilmResult = (result: WebPlayerResult): WebPlayerResult | null =>
    result.streamUrl ? result : null;

  if (hdfilmMatch) {
    if (isSeries) {
      if (request.seasonNumber && request.episodeNumber) {
        const episodeResult = await resolvePlayableSeriesEpisodeUrl(
          hdfilmMatch.url,
          request.seasonNumber,
          request.episodeNumber
        );
        if (episodeResult) {
          const built = buildHdFilmResult(
            episodeResult.url,
            episodeResult.qualityWarning,
            episodeResult.nativeFallback
          );
          const ret = considerHdFilmResult(built);
          if (ret) return ret;
        }
      }
    } else {
      const videoCheck = await checkVideoAvailability(hdfilmMatch.url);
      if (videoCheck.available) {
        const built = buildHdFilmResult(hdfilmMatch.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
        const ret = considerHdFilmResult(built);
        if (ret) return ret;
      }
    }
  }

  // 2. Dizipal — primary fallback when HDFilm produced no native stream.
  //
  //    ONLY a real extracted stream counts. Dizipal's page and embed shells
  //    used to be returned as playable results too, but those render the
  //    provider's own Playerjs in a WebView — the user ended up inside a
  //    third-party player complete with its pre-roll ads and its own controls.
  //    When the extraction fails we fall through to the next provider instead.
  {
    const dizipalResult = await resolvePlayableDizipalUrl(request);
    if (dizipalResult?.stream) {
      const { pageUrl, stream, embedUrl, qualityWarning } = dizipalResult;
      return {
        url: pageUrl,
        source: "dizipal_direct",
        streamUrl: stream.streamUrl,
        streamType: stream.streamType,
        poster: stream.poster,
        referer: stream.referer || "",
        embedUrl: embedUrl ?? undefined,
        subtitles: stream.subtitles,
        qualityWarning,
      };
    }
  }

  // 2b. Retry Turkish sources with the localized title from TMDB.
  //
  //    For most cross-language titles ("Harry Potter and the Deathly
  //    Hallows" vs "Harry Potter ve Ölüm Yadigârları") the English search
  //    in step 2 scores too low against the Turkish-only Dizipal entry to
  //    pass the strict 80-point cutoff. Asking TMDB for the canonical
  //    Turkish translation and retrying matches with score ≥ 100.
  if (request.tmdbId) {
    try {
      const altTitle = await getTurkishAlternativeTitle(request.tmdbId, request.mediaType);
      if (altTitle && altTitle !== request.title && altTitle !== request.originalTitle) {
        const hdRetry = await findBestHdFilmMatch(altTitle, request.castNames ?? [], request.year);
        if (hdRetry) {
          if (isSeries) {
            if (request.seasonNumber && request.episodeNumber) {
              const episodeResult = await resolvePlayableSeriesEpisodeUrl(
                hdRetry.url, request.seasonNumber, request.episodeNumber
              );
              if (episodeResult) {
                const built = buildHdFilmResult(
                  episodeResult.url,
                  episodeResult.qualityWarning,
                  episodeResult.nativeFallback
                );
                const ret = considerHdFilmResult(built);
                if (ret) return ret;
              }
            }
          } else {
            const videoCheck = await checkVideoAvailability(hdRetry.url);
            if (videoCheck.available) {
              const built = buildHdFilmResult(hdRetry.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
              const ret = considerHdFilmResult(built);
              if (ret) return ret;
            }
          }
        }

        // resolvePlayableDizipalUrl runs the search itself, so probing with a
        // separate searchDizipal call first only duplicated the whole query
        // sweep (up to five HTTP round-trips) and threw the result away.
        const retryRequest: WebPlayerRequest = { ...request, title: altTitle, originalTitle: undefined };
        const dizipalResult = await resolvePlayableDizipalUrl(retryRequest);
        // Same rule as step 2: a Dizipal page/embed shell is not a playable
        // result, only an extracted stream is.
        if (dizipalResult?.stream) {
          const { pageUrl, stream, embedUrl, qualityWarning } = dizipalResult;
          return {
            url: pageUrl, source: "dizipal_direct",
            streamUrl: stream.streamUrl, streamType: stream.streamType,
            poster: stream.poster, referer: stream.referer || "",
            embedUrl: embedUrl ?? undefined, subtitles: stream.subtitles, qualityWarning,
          };
        }
      }
    } catch { /* silent */ }
  }

  // 3. Dizibal scraper — third source of native streams, used when both
  //    HDFilm and Dizipal couldn't yield a playable URL (typical case:
  //    Dizipal resolved an imagestoo m3u8 whose underlying media was
  //    deleted). Dizibal serves HLS from its own player CDN (pilavyer*.top).
  const directFallback = await resolveDirectWebPlayerFallback(request);
  if (directFallback.source !== "not_found") return directFallback;

  return { url: "", source: "not_found" };
}

/**
 * A native stream of the same title from a provider OTHER than HDFilm — for
 * when an HDFilm stream resolved but will not play on this device. Dizipal
 * first (same catalog depth, native), then Dizibal. Never throws; answers
 * `not_found` when neither has it within the budget.
 */
export async function resolveNativeAlternativeToHdFilm(request: WebPlayerRequest): Promise<WebPlayerResult> {
  try {
    const dizipal = await Promise.race([
      resolvePlayableDizipalUrl(request),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DIRECT_FALLBACK_TIMEOUT_MS)),
    ]);
    if (dizipal?.stream) {
      const { pageUrl, stream, embedUrl, qualityWarning } = dizipal;
      return {
        url: pageUrl,
        source: "dizipal_direct",
        streamUrl: stream.streamUrl,
        streamType: stream.streamType,
        poster: stream.poster,
        referer: stream.referer || "",
        embedUrl: embedUrl ?? undefined,
        subtitles: stream.subtitles,
        qualityWarning,
      };
    }
  } catch {
    /* fall through to Dizibal */
  }
  return resolveDirectWebPlayerFallback(request);
}

// ===========================================================================
// Tier 3 — Dizibal scraper (on-device, residential IP)
// ===========================================================================
//
// Dizibal rebuilt its site in Sept 2026 (Laravel). The JSON API this resolver
// used (/api/movies, /api/series, /api/anime, /api/stream/embed) is GONE —
// every route answers 404 — so it now reads the pages a browser reads:
//
//   1. GET /ara/oneri?q={title}   (the header search box; Accept: application/json)
//        → { movies: [{ title, url, meta }], series: [{ title, url, meta }] }
//        `title` is the Turkish release name ("Siyah Telefon 2") but the search
//        also matches the English/original one ("black phone 2" finds it).
//        `meta` is "Film · 2025" / "Dizi · 2005" / "Anime · 2002"; anime series
//        sit in `series` with an /anime/{slug} url. No TMDB/IMDb ids anywhere,
//        and the search is loose (a dozen "The …" titles for "the office").
//   2. The watch page: the movie url itself, or
//        {series url}/season/{S}/episode/{E} (404 when the episode is missing).
//        A title page's JSON-LD carries `name` plus the English `alternateName`.
//   3. The page's player box, by `data-player-type`:
//        "embed"  → <div data-pv="{slug}"> + <script src="https://{host}/assets/js/core.js">;
//                   GET https://{host}/assets/js/s.php?s={slug} is origin-locked
//                   (403 unless the Referer is the Dizibal origin) and its
//                   `window.__PLAYER__` JSON carries `stream` — an AES-128 HLS
//                   playlist whose token lives ~7 days and which plays without a
//                   Referer — and `subs` [{ src, label, lang }] (WebVTT).
//        "direct" → <video data-src="{base}/video/bolum/{id}">, a range-served MP4.
//                   Some ids 502 or hang upstream, so it is probed before use.
//        "none"   → nothing to play.
//
// Result is a regular source:"direct" WebPlayerResult so it flows through
// the existing PlayerScreen native-video path with no special-casing.

const DIZIBAL_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

const DIZIBAL_REQUEST_TIMEOUT_MS = 5_000;
// A title the listing names in Turkish can only be confirmed on its own page;
// cap how many such pages one search may open.
const DIZIBAL_MAX_PAGE_CHECKS = 3;

type DizibalSuggestion = { title?: string; url?: string; meta?: string };
type DizibalSuggestResponse = { movies?: DizibalSuggestion[]; series?: DizibalSuggestion[] };
type DizibalCandidate = { title: string; url: string; year: string | null; titleScore: number };
type DizibalPlayerBox =
  | { type: "embed"; slug: string; playerOrigin: string }
  | { type: "direct"; src: string }
  | { type: "none" };
type DizibalSubtitle = { url: string; label: string; lang: string };

function dizibalBaseUrl(): string {
  return getProviderConfig("dizibal").baseUrl.replace(/\/+$/, "");
}
function dizibalReferer(): string {
  return getProviderConfig("dizibal").referer || `${dizibalBaseUrl()}/`;
}

function scoreDizibalNames(names: Array<string | null | undefined>, request: WebPlayerRequest): number {
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    best = Math.max(best, scoreMatch(name, request.title));
    if (request.originalTitle) best = Math.max(best, scoreMatch(name, request.originalTitle));
  }
  return best;
}

/**
 * Candidates from one /ara/oneri answer, best first. A listing whose year is
 * outside tolerance is never a candidate — Dizibal's search returns loose
 * matches, and a same-named title from another year is a different film.
 * Pure (no network) so it is unit-testable.
 */
function rankDizibalSuggestions(
  response: DizibalSuggestResponse | null | undefined,
  request: WebPlayerRequest,
): DizibalCandidate[] {
  // Anime FILMS are listed as one-episode anime series ("Jujutsu Kaisen 0
  // Movie" → /anime/jujutsu-kaisen-0-movie/season/1/episode/1), so a movie
  // request also looks at /anime/ entries; films come first on a tie.
  const items = request.mediaType === "movie"
    ? [...(response?.movies ?? []), ...(response?.series ?? [])]
    : response?.series ?? [];
  const wantedPath = request.mediaType === "movie" ? /\/(movie|anime)\/[^/?#]+\/?$/ : /\/(series|anime)\/[^/?#]+\/?$/;
  const candidates: DizibalCandidate[] = [];
  for (const item of items) {
    if (!item?.title || !item.url || !wantedPath.test(item.url)) continue;
    const year = item.meta?.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
    if (isYearIncompatible(year, request.year ?? null)) continue;
    candidates.push({
      title: item.title,
      url: item.url.replace(/\/+$/, ""),
      year,
      titleScore: scoreDizibalNames([item.title], request),
    });
  }
  return candidates.sort((a, b) => b.titleScore - a.titleScore);
}

/** `name` / `alternateName` of the Movie or TVSeries JSON-LD block on a title page. */
function readDizibalPageNames(html: string): string[] {
  const names: string[] = [];
  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    let data: any;
    try { data = JSON.parse(block[1]); } catch { continue; }
    const nodes: any[] = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
    for (const node of nodes) {
      if (node?.["@type"] !== "Movie" && node?.["@type"] !== "TVSeries") continue;
      for (const value of [node.name, node.alternateName].flat()) {
        if (typeof value === "string" && value.trim()) names.push(value.trim());
      }
    }
  }
  return names;
}

/** Which player a watch page mounts. Pure (no network) so it is unit-testable. */
function extractDizibalPlayerBox(html: string): DizibalPlayerBox | null {
  const type = html.match(/data-player-type="([a-z]+)"/i)?.[1]?.toLowerCase();
  if (type === "embed") {
    const slug = html.match(/data-pv="([^"]+)"/)?.[1];
    const core = html.match(/<script[^>]+src="(https:\/\/[^"/]+)\/(?:assets\/js\/core|e\/c)\.js/i)?.[1];
    return slug && core ? { type: "embed", slug, playerOrigin: core } : null;
  }
  if (type === "direct") {
    const src = html.match(/<video[^>]*\sdata-src="(https?:\/\/[^"]+)"/i)?.[1];
    return src ? { type: "direct", src: src.replace(/&amp;/g, "&") } : null;
  }
  return type === "none" ? { type: "none" } : null;
}

/**
 * The stream and subtitles out of the player page's `window.__PLAYER__` JSON.
 * Pure (no network) so it is unit-testable.
 */
function extractPilavyerPlayerConfig(html: string): { stream: string; subtitles: DizibalSubtitle[] } | null {
  const raw = html.match(/window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)?.[1];
  if (!raw) return null;
  let config: any;
  try { config = JSON.parse(raw); } catch { return null; }
  if (typeof config?.stream !== "string" || !/^https:\/\//i.test(config.stream)) return null;

  const subtitles: DizibalSubtitle[] = [];
  for (const sub of Array.isArray(config.subs) ? config.subs : []) {
    if (typeof sub?.src !== "string" || !/^https:\/\//i.test(sub.src)) continue;
    const label = typeof sub.label === "string" && sub.label.trim() ? sub.label.trim() : "Altyazı";
    const lang = typeof sub.lang === "string" && /^[a-z]{2,3}$/i.test(sub.lang) ? sub.lang.toLowerCase() : "und";
    subtitles.push({ url: sub.src, label, lang });
  }
  return { stream: config.stream, subtitles };
}

async function fetchDizibalPage(url: string): Promise<string | null> {
  try {
    const response = await dizibalGet<string>(url, {
      timeout: DIZIBAL_REQUEST_TIMEOUT_MS,
      responseType: "text",
      headers: { ...DIZIBAL_HEADERS, Accept: "text/html,*/*", Referer: dizibalReferer() },
    });
    recordObservedBaseUrl("dizibal", getResponseFinalOrigin(response));
    return typeof response.data === "string" ? response.data : null;
  } catch (error: any) {
    debugLog(`[WebPlayer:dizibal] page ${url} failed: ${error?.response?.status ?? error?.code ?? "?"}`);
    return null;
  }
}

/** The title page (movie or series) whose identity matches the request. */
async function findDizibalTitle(request: WebPlayerRequest): Promise<{ url: string; html: string | null } | null> {
  const queries = [request.title];
  if (request.originalTitle && request.originalTitle !== request.title) queries.push(request.originalTitle);

  let pageChecks = 0;
  const checked = new Set<string>();
  for (const q of queries) {
    let response: DizibalSuggestResponse | null = null;
    try {
      const reply = await dizibalGet<DizibalSuggestResponse>(`${dizibalBaseUrl()}/ara/oneri`, {
        timeout: DIZIBAL_REQUEST_TIMEOUT_MS,
        headers: { ...DIZIBAL_HEADERS, Accept: "application/json", Referer: dizibalReferer() },
        params: { q },
      });
      recordObservedBaseUrl("dizibal", getResponseFinalOrigin(reply));
      response = reply.data;
    } catch (error: any) {
      debugLog(`[WebPlayer:dizibal] search "${q}" failed: ${error?.response?.status ?? error?.code ?? "?"}`);
      continue;
    }

    for (const candidate of rankDizibalSuggestions(response, request)) {
      // The listing already names it — no need to open the page to know.
      if (candidate.titleScore >= 70) return { url: candidate.url, html: null };
      // Otherwise the listing is a Turkish name: only the page's English
      // alternateName can say whether it is the requested title.
      if (checked.has(candidate.url) || pageChecks >= DIZIBAL_MAX_PAGE_CHECKS) continue;
      checked.add(candidate.url);
      pageChecks++;
      const html = await fetchDizibalPage(candidate.url);
      if (html && scoreDizibalNames(readDizibalPageNames(html), request) >= 70) {
        return { url: candidate.url, html };
      }
    }
  }
  return null;
}

/** Some /video/bolum ids 502 or hang upstream; a HEAD tells them apart cheaply. */
async function isDizibalDirectSourceLive(src: string): Promise<boolean> {
  try {
    await axios.head(src, {
      timeout: DIZIBAL_REQUEST_TIMEOUT_MS,
      headers: { ...DIZIBAL_HEADERS, Accept: "*/*", Referer: dizibalReferer() },
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveDizibalStream(
  request: WebPlayerRequest,
): Promise<WebPlayerResult | null> {
  const title = await findDizibalTitle(request);
  if (!title) {
    debugLog("[WebPlayer:dizibal] no matching title");
    return null;
  }

  let watchHtml: string | null;
  if (/\/movie\/[^/]+$/.test(title.url)) {
    watchHtml = title.html ?? (await fetchDizibalPage(title.url));
  } else {
    // Series and anime play from an episode page; an anime film is episode 1×1.
    const season = request.mediaType === "movie" ? 1 : request.seasonNumber;
    const episode = request.mediaType === "movie" ? 1 : request.episodeNumber;
    if (!season || !episode) return null;
    watchHtml = await fetchDizibalPage(`${title.url}/season/${season}/episode/${episode}`);
  }
  const box = watchHtml ? extractDizibalPlayerBox(watchHtml) : null;
  if (!box || box.type === "none") {
    debugLog(`[WebPlayer:dizibal] no player on ${title.url}`);
    return null;
  }

  if (box.type === "direct") {
    if (!(await isDizibalDirectSourceLive(box.src))) return null;
    debugLog(`[WebPlayer:dizibal] resolved direct mp4 for ${request.title} via ${title.url}`);
    return {
      url: box.src,
      source: "direct",
      streamUrl: box.src,
      streamType: "mp4",
      referer: dizibalReferer(),
    };
  }

  try {
    const response = await dizibalGet<string>(
      `${box.playerOrigin}/assets/js/s.php?s=${encodeURIComponent(box.slug)}`,
      {
        timeout: DIZIBAL_REQUEST_TIMEOUT_MS,
        responseType: "text",
        // Origin-locked: the embed iframe sends only the site origin as Referer.
        headers: { ...DIZIBAL_HEADERS, Accept: "text/html,*/*", Referer: `${dizibalBaseUrl()}/` },
      },
    );
    const player = typeof response.data === "string" ? extractPilavyerPlayerConfig(response.data) : null;
    if (!player) return null;
    debugLog(`[WebPlayer:dizibal] resolved m3u8 for ${request.title} via ${title.url}`);
    return {
      url: player.stream,
      source: "direct",
      streamUrl: player.stream,
      streamType: "m3u8",
      referer: `${box.playerOrigin}/`,
      subtitles: player.subtitles,
    };
  } catch (error: any) {
    debugLog(`[WebPlayer:dizibal] player ${box.slug} failed: ${error?.response?.status ?? error?.code ?? "?"}`);
    return null;
  }
}

/** Resolve a third-source stream after the Dizipal CDN fails (or for proactive prefetch). */
export async function resolveDirectWebPlayerFallback(
  request: WebPlayerRequest,
): Promise<WebPlayerResult> {
  try {
    const result = await Promise.race<WebPlayerResult | null>([
      resolveDizibalStream(request),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), DIRECT_FALLBACK_TIMEOUT_MS),
      ),
    ]);
    return result ?? { url: "", source: "not_found" };
  } catch (error) {
    debugLog("[WebPlayerService] Dizibal resolution skipped:", error);
    return { url: "", source: "not_found" };
  }
}

export const __internal = {
  buildHdFilmResult,
  providerGet,
  isProviderSkipped,
  resetProviderSilence: () => providerSilence.clear(),
  resetDizipalSearchCredentials: () => {
    dizipalSearchCredentials = null;
  },
  isCloudflareChallengeStatus,
  checkVideoAvailability,
  decodeRapidrameByInterpretingDcBody,
  decodeRapidrameValueCandidates,
  extractDizibalPlayerBox,
  extractPilavyerPlayerConfig,
  extractSubtitlesFromPlayerJs,
  extractDizipalPageYear,
  extractHdFilmEmbedUrl,
  extractRapidrameParts,
  extractRapidrameStreamUrl,
  generateSearchQueries,
  isYearIncompatible,
  shouldStopSearchingAfterEmptyQueries,
  tryUnpackInlinePackerJs,
  hasStrictTitleIdentity,
  inspectRapidramePlaylist,
  isAlternateTitleSafeForDizipal,
  isDizipalUrlTitleCompatible,
  probeDizipalDirectSlug,
  parseDizipalSearchResults,
  rankDizibalSuggestions,
  readDizibalPageNames,
  scoreDizipalResult,
  scoreHdFilmResult,
  scoreStrictDizipalTitle,
  slugifyForDizipal,
};
