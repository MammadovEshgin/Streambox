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
import { resolveDirectLink } from "./DirectLinkService";
import { getProviderConfig } from "./providerConfigService";
import { getTurkishAlternativeTitle } from "../api/tmdb";
import { isTvBuild } from "../utils/tv";

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
  source: "hdfilm" | "dizipal" | "dizipal_embed" | "dizipal_direct" | "youtube_embed" | "direct" | "not_found";
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
   * Populated when `source === "not_found"` — short human-readable trace of which
   * providers were attempted and why each failed. Used by TV builds to surface a
   * diagnostic line beneath the "Not Available" screen so a black-box failure is
   * actually actionable.
   */
  diagnostics?: string[];
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

export function scoreMatch(resultText: string, target: string, year?: string | number | null): number {
  if (!resultText || !target) return 0;
  const normalizedResult = resultText.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
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

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function generateSearchQueries(title: string, year?: string | null, originalTitle?: string): string[] {
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

  // 0. Original-language title — highest priority for non-English sources
  if (originalTitle) {
    add(originalTitle);
    if (year) add(`${originalTitle} ${year}`);
  }

  // 1. English title — highest-fidelity match
  add(title);

  // 2. Title + year for disambiguation
  if (year) add(`${title} ${year}`);

  // 3. Clean punctuation that search engines may choke on
  const cleanTitle = title
    .replace(/['''\u2019]/g, "")         // strip apostrophes (Don't → Dont)
    .replace(/[:,\u201C\u201D"!?.,]/g, " ") // replace separators with space
    .replace(/[&]/g, "and")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (year) add(`${cleanTitle} ${year}`);
  add(cleanTitle);

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

  return queries;
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
    const response = await axios.get<{ results?: string[] }>(
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
    const response = await axios.get<string>(pageUrl, {
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

  // Year handling: when we know the target year, year match is critical for disambiguation.
  // Two movies with the same title (e.g. "Dune" 1984 vs 2021) must be separated decisively.
  if (targetYear && result.resultYear) {
    if (result.resultYear === targetYear) {
      bestScore += 50; // strong boost for correct year
    } else if (bestScore >= 80) {
      // High title match but WRONG year — penalize heavily so year-matching results always win
      bestScore -= 40;
    } else if (bestScore >= 50) {
      // Medium title match with wrong year — moderate penalty
      bestScore -= 20;
    }
  }

  return bestScore;
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
  const queries = generateSearchQueries(title, year, originalTitle);
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
    if (qi >= 4) break;
  }

  if (allResults.size === 0) return null;

  const scored = [...allResults.entries()]
    .map(([href, result]) => ({
      href,
      titleScore: Math.max(
        scoreHdFilmResult(result, title, year),
        originalTitle ? scoreHdFilmResult(result, originalTitle, year) : 0
      ),
      qualityWarning: detectQualityWarning(result)
    }))
    .filter((entry) => entry.titleScore >= 50)
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
    const response = await axios.get<string>(pageUrl, {
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

    const nativeFallback = hasRapidrame ? await getCachedHdFilmNativeFallback(pageUrl, html) : null;

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
  if (nativeFallback && (nativeFallback.preferNative || isTvBuild())) {
    return {
      url: nativeFallback.streamUrl,
      source: "direct",
      streamUrl: nativeFallback.streamUrl,
      streamType: nativeFallback.streamType,
      poster: nativeFallback.poster,
      referer: nativeFallback.referer,
      embedUrl: nativeFallback.referer,
      subtitles: nativeFallback.subtitles,
      qualityWarning
    };
  }

  return {
    url: pageUrl,
    source: "hdfilm",
    qualityWarning,
    ...(nativeFallback
      ? {
          streamUrl: nativeFallback.streamUrl,
          streamType: nativeFallback.streamType,
          poster: nativeFallback.poster,
          referer: nativeFallback.referer,
          embedUrl: nativeFallback.referer,
          subtitles: nativeFallback.subtitles
        }
      : {})
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
    const response = await axios.get<string>(seriesPageUrl, {
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

async function queryDizipal(query: string, mediaType: "movie" | "tv"): Promise<SearchResult[]> {
  try {
    const response = await axios.get<DizipalSearchResponse>(`${getDizipalBaseUrl()}/ajax-search`, {
      timeout: 6000,
      params: { q: query },
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Referer: getDizipalReferer()
      }
    });

    const rawResults = Array.isArray(response.data?.results) ? response.data.results : [];
    if (!response.data?.success || rawResults.length === 0) {
      return [];
    }

    return rawResults
      .filter((result) => {
        const type = (result.type ?? "").toLowerCase();
        return mediaType === "movie" ? type.includes("film") : type.includes("dizi");
      })
      .map((result) => ({
        href: result.url ?? "",
        text: `${result.title ?? ""} ${result.year ?? ""}`.trim().toLowerCase(),
        title: result.title ?? "",
        resultYear: result.year ? String(result.year) : ""
      }))
      .filter((result) => result.href.length > 0);
  } catch {
    return [];
  }
}

async function searchDizipal(title: string, mediaType: "movie" | "tv", year?: string | null, originalTitle?: string): Promise<MatchResult | null> {
  const queries = generateSearchQueries(title, year, originalTitle);
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
      const s1 = scoreHdFilmResult(r, title, year);
      const s2 = originalTitle ? scoreHdFilmResult(r, originalTitle, year) : 0;
      return Math.max(s1, s2);
    }));
    if (bestSoFar >= 120) break;
    if (qi >= 4) break;
  }

  if (allResults.size === 0) return null;

  const scored = [...allResults.entries()]
    .map(([href, result]) => ({
      href,
      score: Math.max(
        scoreHdFilmResult(result, title, year),
        originalTitle ? scoreHdFilmResult(result, originalTitle, year) : 0
      ),
      qualityWarning: detectQualityWarning(result)
    }))
    .filter((entry) => entry.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  return { url: scored[0].href, qualityWarning: scored[0].qualityWarning };
}

function extractDizipalCfg(html: string): string | null {
  const match = html.match(/id=["']videoContainer["'][^>]*data-cfg=["']([^"']+)["']/i);
  if (match?.[1]) return match[1];

  return html.match(/data-cfg=["']([^"']+)["']/i)?.[1] ?? null;
}

function normalizeDizipalEmbedUrl(embedUrl: string, pageUrl: string, baseUrl: string): string | null {
  const trimmed = (embedUrl ?? "").trim();
  if (!trimmed) return null;

  return (
    toAbsoluteUrl(pageUrl, trimmed) ??
    toAbsoluteUrl(baseUrl, trimmed) ??
    toAbsoluteUrl(getDizipalBaseUrl(), trimmed)
  );
}

async function fetchDizipalPageHtml(pageUrl: string): Promise<string | null> {
  try {
    const response = await axios.get<string>(pageUrl, {
      timeout: 7000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: getDizipalReferer()
      }
    });

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

function getCachedHdFilmNativeFallback(pageUrl: string, pageHtml: string) {
  const cacheKey = pageUrl;
  const cached = hdfilmNativeFallbackCache.get(cacheKey);
  if (cached) return cached;

  const task = resolveHdFilmNativeFallback(pageUrl, pageHtml);
  hdfilmNativeFallbackCache.set(cacheKey, task);

  if (hdfilmNativeFallbackCache.size > HDFILM_NATIVE_FALLBACK_CACHE_LIMIT) {
    const oldestKey = hdfilmNativeFallbackCache.keys().next().value;
    if (oldestKey) hdfilmNativeFallbackCache.delete(oldestKey);
  }

  return task;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64Binary(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9+/=]/g, "");
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    if (char === "=") break;
    const index = BASE64_CHARS.indexOf(char);
    if (index === -1) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

function rot13(value: string): string {
  return value.replace(/[a-zA-Z]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function decodeRapidrameValue(valueParts: string[]): string {
  let result = decodeBase64Binary(valueParts.join(""));
  result = rot13(result);
  result = result.split("").reverse().join("");

  let unmix = "";
  for (let index = 0; index < result.length; index += 1) {
    const nextCode = (result.charCodeAt(index) - (399756995 % (index + 5)) + 256) % 256;
    unmix += String.fromCharCode(nextCode);
  }

  return unmix;
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

function extractRapidrameStreamUrl(embedHtml: string): string | null {
  const sourceVariable = embedHtml.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*(s_[A-Za-z0-9_]+)/)?.[1];
  if (!sourceVariable) return null;

  const variableIndex = embedHtml.indexOf(`var ${sourceVariable}`);
  if (variableIndex === -1) return null;

  const variableSnippet = embedHtml.slice(variableIndex, variableIndex + 2200);
  const arrayLiteral = extractJsonArrayLiteral(variableSnippet);
  if (!arrayLiteral) return null;

  try {
    const parts = JSON.parse(arrayLiteral);
    if (!Array.isArray(parts) || parts.some((part) => typeof part !== "string")) {
      return null;
    }

    const decoded = decodeRapidrameValue(parts);
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function extractHdFilmEmbedUrl(pageHtml: string, pageUrl: string): string | null {
  const iframeMatch = pageHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch?.[1] && /rapidrame|hdfilmcehennemi\.mobi|rplayer|vidmoly|closeload|fastplayer/i.test(iframeMatch[1])) {
    return toAbsoluteUrl(pageUrl, iframeMatch[1]);
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

async function shouldPreferNativeForRapidrameStream(streamUrl: string, referer: string): Promise<boolean> {
  try {
    const response = await axios.get<string>(streamUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
        Referer: referer
      },
      transformResponse: [(data) => (typeof data === "string" ? data : String(data ?? ""))]
    });

    const playlist = response.data;
    if (!playlist || !playlist.includes("#EXTM3U")) return false;

    const hasVariantPlaylist = /#EXT-X-STREAM-INF/i.test(playlist);
    const hasMediaSegments = /#EXTINF/i.test(playlist);
    const usesDisguisedImageSegments = /https?:\/\/[^\s#]+\/image\d*[^/\s#]*\.jpg(?:[?#][^\s#]*)?/i.test(playlist);

    // Normal HDFilm titles first expose a master playlist with CODECS/variant metadata.
    // Some newer uploads expose the media playlist directly with TS bytes hidden behind
    // .jpg segment URLs. JWPlayer can mark those as ready while Android WebView shows
    // a black video surface, so route that narrow shape through the native HLS player.
    return !hasVariantPlaylist && hasMediaSegments && usesDisguisedImageSegments;
  } catch {
    return false;
  }
}

async function resolveHdFilmNativeFallback(pageUrl: string, pageHtml: string): Promise<DizipalStreamInfo | null> {
  const embedUrl = extractHdFilmEmbedUrl(pageHtml, pageUrl);
  if (!embedUrl) return null;

  try {
    const response = await axios.get<string>(embedUrl, {
      timeout: 8000,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: pageUrl
      }
    });

    const streamUrl = extractRapidrameStreamUrl(response.data);
    if (!streamUrl) return null;
    const preferNative = await shouldPreferNativeForRapidrameStream(streamUrl, embedUrl);

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

function extractSubtitlesFromPlayerJs(html: string): SubtitleTrack[] {
  const match = html.match(/playerjsSubtitle\s*=\s*"([^"]+)"/);
  if (!match?.[1]) return [];

  const subs: SubtitleTrack[] = [];
  const parts = match[1].split(",");
  for (const part of parts) {
    const m = part.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
    if (m) {
      const label = m[1];
      const url = m[2];
      const langMatch = url.match(/_([a-z]{2,3})\.vtt/i);
      subs.push({ url, label, lang: langMatch?.[1] ?? label.toLowerCase().slice(0, 3) });
    }
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
      ...extractSubtitlesFromPlayerJs(html),
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
      referer: embedOrigin + "/",
      subtitles: uniqueSubs
    };
  } catch (e) {
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
      const embedOrigin = new URL(embedUrl).origin + "/";
      return {
        streamUrl: m3u8,
        streamType: "m3u8",
        poster: "",
        referer: embedOrigin,
        subtitles: subs
      };
    }

    const apiResult = await resolveViaGetVideoApi(embedUrl, html);
    if (apiResult) return apiResult;

    return null;
  } catch (e) {
    return null;
  }
}

type DizipalStreamResult = {
  stream: DizipalStreamInfo | null;
  embedUrl: string | null;
};

async function fetchDizipalStreamUrl(pageUrl: string): Promise<DizipalStreamResult | null> {
  try {
    const html = await fetchDizipalPageHtml(pageUrl);
    if (!html) return null;

    const cfg = extractDizipalCfg(html);
    if (!cfg) return null;

    const pageOrigin = new URL(pageUrl).origin;
    const baseUrl = pageOrigin.includes("dizipal") ? pageOrigin : getDizipalBaseUrl();

    let csrfToken = "";
    try {
      const tokenResp = await axios.get<string>(`${baseUrl}/ajax-token`, {
        timeout: 6000,
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "X-Requested-With": "XMLHttpRequest",
          Referer: pageUrl
        }
      });
      csrfToken = typeof tokenResp.data === "string" ? tokenResp.data.trim() : String(tokenResp.data).trim();
    } catch (e) {
      return null;
    }

    const configResp = await axios.post<{
      success?: boolean;
      config?: { v?: string; t?: string; p?: string };
    }>(
      `${baseUrl}/ajax-player-config`,
      `cfg=${encodeURIComponent(cfg)}`,
      {
        timeout: 6000,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: pageUrl,
          Cookie: `_ct=${csrfToken}`
        }
      }
    );

    const config = configResp.data?.config;
    if (!configResp.data?.success || !config?.v) return null;

    const streamType = (config.t ?? "").toLowerCase();

    if (streamType === "m3u8" || streamType === "mp4") {
      return {
        stream: {
          streamUrl: config.v,
          streamType,
          poster: config.p ?? "",
          referer: `${baseUrl}/`,
          subtitles: []
        },
        embedUrl: null
      };
    }

    if (streamType === "embed" || streamType === "iframe") {
      const normalizedEmbedUrl = normalizeDizipalEmbedUrl(config.v, pageUrl, baseUrl);
      if (!normalizedEmbedUrl) return null;

      const embedStream = await resolveEmbedToM3u8(normalizedEmbedUrl, pageUrl);
      if (embedStream) {
        return {
          stream: embedStream,
          embedUrl: normalizedEmbedUrl
        };
      }

      return {
        stream: null,
        embedUrl: normalizedEmbedUrl
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function hasPlayableDizipalVideo(pageUrl: string): Promise<boolean> {
  const html = await fetchDizipalPageHtml(pageUrl);
  if (!html) return false;

  const cfg = extractDizipalCfg(html);
  const hasPlayerShell =
    /id=["']videoContainer["']/i.test(html) &&
    /id=["']playerCover["']|id=["']mainPlayer["']|id=["']playerContent["']/i.test(html);

  return Boolean(cfg) && hasPlayerShell;
}

function matchesDizipalEpisodeUrl(url: string, seasonNumber: number, episodeNumber: number): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes(`/bolum/`) && normalized.includes(`${seasonNumber}-sezon-${episodeNumber}-bolum`);
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
        .filter((href): href is string => Boolean(href && href.includes("/bolum/")))
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

  const result = await fetchDizipalStreamUrl(targetUrl);
  if (result) return { pageUrl: targetUrl, stream: result.stream, embedUrl: result.embedUrl, qualityWarning };

  const playable = await hasPlayableDizipalVideo(targetUrl);
  if (playable) return { pageUrl: targetUrl, stream: null, embedUrl: null, qualityWarning };

  return null;
}

function toDirectStreamResult(directResult: Awaited<ReturnType<typeof resolveDirectLink>>): WebPlayerResult | null {
  if (!directResult || !directResult.primary) return null;
  const { primary } = directResult;
  const referer = primary.headers?.Referer || primary.headers?.referer || "";
  return {
    url: primary.url,
    source: "direct",
    streamUrl: primary.url,
    streamType: primary.format === "hls" ? "m3u8" : "mp4",
    referer,
    subtitles: (primary.subtitles || []).map((s: any) => ({
      url: s.url,
      label: s.label,
      lang: s.language,
    })),
    qualityOptions: primary.qualityOptions,
  };
}

function toDizipalDirectResult(
  dizipalResult: NonNullable<Awaited<ReturnType<typeof resolvePlayableDizipalUrl>>>
): WebPlayerResult {
  const { pageUrl, stream, embedUrl, qualityWarning } = dizipalResult;
  if (!stream) {
    throw new Error("toDizipalDirectResult requires a native stream");
  }
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

/**
 * TV resolver: native-stream only.
 *
 * Android TV has no usable WebView playback flow — JWPlayer iframes and the
 * HDFilm runtime-discovery handoff both depend on focus/touch behaviour that
 * doesn't exist on a remote. Returning a `hdfilm` / `dizipal` / `dizipal_embed`
 * source on TV would surface a WebView the user can't interact with.
 *
 * So on TV we reorder the chain to put providers that deliver clean
 * MP4/HLS URLs first, and skip everything WebView-only:
 *   1. Stremio addons (DirectLinkService) — always native, no WebView. Most reliable on TV.
 *   2. Dizipal — but ONLY when its player config yielded a native HLS URL.
 *   3. HDFilm — but ONLY when checkVideoAvailability surfaced a native fallback URL.
 *   4. Turkish alt-title retry against the same native-only paths above.
 */
async function resolveTvNativeUrl(request: WebPlayerRequest): Promise<WebPlayerResult> {
  const isSeries = request.mediaType !== "movie";
  const diagnostics: string[] = [];

  try {
    const directResult = await resolveDirectLink({
      title: request.title,
      mediaType: request.mediaType,
      tmdbId: request.tmdbId,
      imdbId: request.imdbId?.startsWith("tt") ? request.imdbId : undefined,
      seasonNumber: request.seasonNumber,
      episodeNumber: request.episodeNumber,
    });
    const directStream = toDirectStreamResult(directResult);
    if (directStream) return directStream;
    diagnostics.push("Stremio: no playable candidates");
  } catch (error) {
    debugLog("[WebPlayerService][TV] Direct resolution skipped:", error);
    diagnostics.push(`Stremio: ${error instanceof Error ? error.message : "unavailable"}`);
  }

  const dizipalResult = await resolvePlayableDizipalUrl(request);
  if (dizipalResult?.stream) return toDizipalDirectResult(dizipalResult);
  diagnostics.push(dizipalResult ? "Dizipal: found page but no native stream" : "Dizipal: no match");

  const hdfilmMatch = await findBestHdFilmMatch(request.title, request.castNames ?? [], request.year, request.originalTitle);
  if (hdfilmMatch) {
    if (isSeries && request.seasonNumber && request.episodeNumber) {
      const episodeResult = await resolvePlayableSeriesEpisodeUrl(hdfilmMatch.url, request.seasonNumber, request.episodeNumber);
      if (episodeResult?.nativeFallback) {
        const result = buildHdFilmResult(episodeResult.url, episodeResult.qualityWarning, episodeResult.nativeFallback);
        if (result.source === "direct") return result;
      }
      diagnostics.push(episodeResult ? "HDFilm: episode found but no native fallback" : "HDFilm: episode lookup failed");
    } else if (!isSeries) {
      const videoCheck = await checkVideoAvailability(hdfilmMatch.url);
      if (videoCheck.nativeFallback) {
        const result = buildHdFilmResult(hdfilmMatch.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
        if (result.source === "direct") return result;
      }
      diagnostics.push(videoCheck.available ? "HDFilm: page available but no native fallback (non-rapidrame embed)" : "HDFilm: page check failed");
    }
  } else {
    diagnostics.push("HDFilm: no match");
  }

  if (request.tmdbId) {
    try {
      const altTitle = await getTurkishAlternativeTitle(request.tmdbId, request.mediaType);
      if (altTitle && altTitle !== request.title && altTitle !== request.originalTitle) {
        diagnostics.push(`Retry with TR title "${altTitle}"`);
        const retryRequest: WebPlayerRequest = { ...request, title: altTitle, originalTitle: undefined };
        const altDizipal = await resolvePlayableDizipalUrl(retryRequest);
        if (altDizipal?.stream) return toDizipalDirectResult(altDizipal);

        const altHdfilm = await findBestHdFilmMatch(altTitle, request.castNames ?? [], request.year);
        if (altHdfilm) {
          if (isSeries && request.seasonNumber && request.episodeNumber) {
            const episodeResult = await resolvePlayableSeriesEpisodeUrl(altHdfilm.url, request.seasonNumber, request.episodeNumber);
            if (episodeResult?.nativeFallback) {
              const result = buildHdFilmResult(episodeResult.url, episodeResult.qualityWarning, episodeResult.nativeFallback);
              if (result.source === "direct") return result;
            }
          } else if (!isSeries) {
            const videoCheck = await checkVideoAvailability(altHdfilm.url);
            if (videoCheck.nativeFallback) {
              const result = buildHdFilmResult(altHdfilm.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
              if (result.source === "direct") return result;
            }
          }
        }
      }
    } catch {
      /* silent — alt-title is best-effort */
    }
  }

  return { url: "", source: "not_found", diagnostics };
}

export async function resolveWebPlayerUrl(request: WebPlayerRequest): Promise<WebPlayerResult> {
  if (request.videoId) {
    return {
      url: request.videoId,
      source: "youtube_embed"
    };
  }

  if (isTvBuild()) {
    return resolveTvNativeUrl(request);
  }

  // 1. HDFilm — find the single best match, check if video is available
  const isSeries = request.mediaType !== "movie";
  const hdfilmMatch = await findBestHdFilmMatch(request.title, request.castNames ?? [], request.year, request.originalTitle);

  if (hdfilmMatch) {
    if (isSeries) {
      if (request.seasonNumber && request.episodeNumber) {
        const episodeResult = await resolvePlayableSeriesEpisodeUrl(
          hdfilmMatch.url,
          request.seasonNumber,
          request.episodeNumber
        );
        if (episodeResult) {
          return buildHdFilmResult(episodeResult.url, episodeResult.qualityWarning, episodeResult.nativeFallback);
        }
      } else {
        return { url: hdfilmMatch.url, source: "hdfilm", qualityWarning: hdfilmMatch.qualityWarning };
      }
    } else {
      const videoCheck = await checkVideoAvailability(hdfilmMatch.url);
      if (videoCheck.available) {
        return buildHdFilmResult(hdfilmMatch.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
      }
    }
  }

  // 2. Dizipal — fallback
  {
    const dizipalResult = await resolvePlayableDizipalUrl(request);
    if (dizipalResult) {
      const { pageUrl, stream, embedUrl, qualityWarning } = dizipalResult;
      if (stream) {
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

      if (embedUrl) {
        return {
          url: embedUrl,
          source: "dizipal_embed",
          embedUrl,
          qualityWarning,
        };
      }
      return { url: pageUrl, source: "dizipal", qualityWarning };
    }
  }

  // 2b. Retry Turkish sources with alternative title from TMDB
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
                return buildHdFilmResult(episodeResult.url, episodeResult.qualityWarning, episodeResult.nativeFallback);
              }
            }
          } else {
            const videoCheck = await checkVideoAvailability(hdRetry.url);
            if (videoCheck.available) {
              return buildHdFilmResult(hdRetry.url, videoCheck.qualityWarning, videoCheck.nativeFallback);
            }
          }
        }

        const dizipalRetry = await searchDizipal(altTitle, request.mediaType, request.year);
        if (dizipalRetry) {
          const retryRequest: WebPlayerRequest = { ...request, title: altTitle, originalTitle: undefined };
          const dizipalResult = await resolvePlayableDizipalUrl(retryRequest);
          if (dizipalResult) {
            const { pageUrl, stream, embedUrl, qualityWarning } = dizipalResult;
            if (stream) {
              return {
                url: pageUrl, source: "dizipal_direct",
                streamUrl: stream.streamUrl, streamType: stream.streamType,
                poster: stream.poster, referer: stream.referer || "",
                embedUrl: embedUrl ?? undefined, subtitles: stream.subtitles, qualityWarning,
              };
            }
            if (embedUrl) return { url: embedUrl, source: "dizipal_embed", embedUrl, qualityWarning };
            return { url: pageUrl, source: "dizipal", qualityWarning };
          }
        }
      }
    } catch { /* silent */ }
  }

  // 3. Try Direct Scrapers (Consumet & Stremio Addons) final fallback for best quality
  try {
    const directResult = await resolveDirectLink({
      title: request.title,
      mediaType: request.mediaType,
      tmdbId: request.tmdbId,
      imdbId: request.imdbId?.startsWith("tt") ? request.imdbId : undefined,
      seasonNumber: request.seasonNumber,
      episodeNumber: request.episodeNumber
    });

    if (directResult && directResult.primary) {
      const { primary } = directResult;
      // Extract referer from headers if available
      const referer = primary.headers?.Referer || primary.headers?.referer || "";

      return {
        url: primary.url,
        source: "direct",
        streamUrl: primary.url,
        streamType: primary.format === "hls" ? "m3u8" : "mp4",
        referer,
        subtitles: (primary.subtitles || []).map((s: any) => ({
          url: s.url,
          label: s.label,
          lang: s.language
        })),
        qualityOptions: primary.qualityOptions
      };
    }
  } catch (error) {
    debugLog("[WebPlayerService] Direct resolution skipped:", error);
  }

  return { url: "", source: "not_found" };
}
