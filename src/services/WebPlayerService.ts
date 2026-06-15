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
   * Set only on HDFilm-derived `direct` results: the original HDFilm page URL.
   * If the native stream fails (broken segment, geo block, expired token, etc.)
   * PlayerScreen can drop back to loading this page in a WebView so the user
   * still has a chance to watch via the provider's on-page JWPlayer.
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

type NormalizedTitle = {
  text: string;
  compact: string;
  tokens: string[];
};

const TITLE_INITIAL_STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to", "with"]);

function normalizeTitle(value: string): NormalizedTitle {
  const text = value
    .toLowerCase()
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
    if (result.resultYear === targetYear) {
      bestScore += 50;
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
      // Safety net: if the native stream fails at runtime (broken segment,
      // expired token, regional block), PlayerScreen drops back to loading
      // this page in a WebView so playback can still be attempted.
      webViewFallbackUrl: pageUrl,
      qualityWarning
    };
  }

  // Decoder couldn't extract a stream — fall back to the on-page JWPlayer via
  // WebView. This is the only remaining reason to enter the WebView path; over
  // time we should reduce how often this happens by improving extraction.
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
  const safeOriginalTitle = isAlternateTitleSafeForDizipal(title, originalTitle) ? originalTitle : undefined;
  const queries = generateSearchQueries(title, year, safeOriginalTitle);
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
    if (qi >= 4) break;
  }

  if (allResults.size === 0) return null;

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
    .filter((entry) => entry.score >= 80 && isDizipalUrlTitleCompatible(entry.href, title, safeOriginalTitle))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  return {
    url: scored[0].href,
    qualityWarning: scored[0].qualityWarning,
    title: scored[0].title,
    resultYear: scored[0].resultYear,
    score: scored[0].score
  };
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

function extractDizipalTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url, getDizipalBaseUrl());
    const segments = parsed.pathname.split("/").filter(Boolean);
    const rawSlug = segments[segments.length - 1] ?? "";
    const cleanedSlug = decodeURIComponent(rawSlug)
      .replace(/-\d+-sezon-\d+-bolum$/i, "")
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

function reverseString(value: string): string {
  return value.split("").reverse().join("");
}

/**
 * Final byte de-scramble shared by every Rapidrame obfuscation scheme:
 * each char is shifted back by `399756995 % (i + 5)`.
 */
function unmixRapidrameBytes(value: string): string {
  let unmix = "";
  for (let index = 0; index < value.length; index += 1) {
    const nextCode = (value.charCodeAt(index) - (399756995 % (index + 5)) + 256) % 256;
    unmix += String.fromCharCode(nextCode);
  }
  return unmix;
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
 */
function decodeRapidrameValueCandidates(valueParts: string[]): string[] {
  const joined = valueParts.join("");
  return RAPIDRAME_PRE_UNMIX_TRANSFORMS.map((transform) => {
    try {
      return unmixRapidrameBytes(transform(joined));
    } catch {
      return "";
    }
  });
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

function extractRapidrameStreamUrl(embedHtmlInput: string): string | null {
  // Unpack any inline packer.js block first. For the older /video/embed/ flow
  // this is a no-op (no packed block). For the newer /rplayer/ flow it's what
  // makes the `s_* = dc_*(…)` assignment visible to the regex below.
  const embedHtml = tryUnpackInlinePackerJs(embedHtmlInput);
  const sourceVariable = embedHtml.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*(s_[A-Za-z0-9_]+)/)?.[1];
  if (!sourceVariable) {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }

  const variableIndex = embedHtml.indexOf(`var ${sourceVariable}`);
  if (variableIndex === -1) {
    return normalizeExtractedMediaUrl(extractM3u8FromEmbedHtml(embedHtml));
  }

  const variableSnippet = embedHtml.slice(variableIndex, variableIndex + 2200);
  const arrayLiteral = extractJsonArrayLiteral(variableSnippet);
  if (!arrayLiteral) return null;

  try {
    const parts = JSON.parse(arrayLiteral);
    if (!Array.isArray(parts) || parts.some((part) => typeof part !== "string")) {
      return null;
    }

    // Try every known Rapidrame obfuscation scheme and keep the first candidate
    // that normalizes to a real http(s) URL (the provider rotates the scheme).
    for (const candidate of decodeRapidrameValueCandidates(parts)) {
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
    const response = await axios.get<string>(absoluteUrl, {
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

  if (!isDizipalUrlTitleCompatible(targetUrl, request.title, request.originalTitle)) {
    debugLog("[WebPlayer] Dizipal rejected mismatched page:", targetUrl, "for", request.title);
    return null;
  }

  const result = await fetchDizipalStreamUrl(targetUrl);
  if (result) return { pageUrl: targetUrl, stream: result.stream, embedUrl: result.embedUrl, qualityWarning };

  const playable = await hasPlayableDizipalVideo(targetUrl);
  if (playable) return { pageUrl: targetUrl, stream: null, embedUrl: null, qualityWarning };

  return null;
}

export async function resolveWebPlayerUrl(request: WebPlayerRequest): Promise<WebPlayerResult> {
  if (request.videoId) {
    return {
      url: request.videoId,
      source: "youtube_embed"
    };
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
          return buildHdFilmResult(
            episodeResult.url,
            episodeResult.qualityWarning,
            episodeResult.nativeFallback
          );
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
                return buildHdFilmResult(
                  episodeResult.url,
                  episodeResult.qualityWarning,
                  episodeResult.nativeFallback
                );
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
      tmdbId: request.imdbId?.startsWith("tt") ? undefined : request.imdbId ? String(request.imdbId) : undefined,
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

export const __internal = {
  buildHdFilmResult,
  decodeRapidrameValueCandidates,
  extractHdFilmEmbedUrl,
  extractRapidrameStreamUrl,
  hasStrictTitleIdentity,
  inspectRapidramePlaylist,
  isAlternateTitleSafeForDizipal,
  isDizipalUrlTitleCompatible,
  scoreDizipalResult,
  scoreStrictDizipalTitle
};
