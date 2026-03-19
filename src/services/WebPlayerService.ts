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

export type WebPlayerRequest = {
  mediaType: "movie" | "tv";
  title: string;
  imdbId?: string | null;
  year?: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  castNames?: string[];
  videoId?: string | null;
  isAzClassic?: boolean;
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
};

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

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
};

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

function scoreMatch(resultText: string, target: string, year?: string | null): number {
  const normalizedResult = resultText.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  let score = 0;
  if (normalizedResult === normalizedTarget) score = 100;
  else if (normalizedResult.startsWith(normalizedTarget)) score = 90;
  else if (normalizedResult.includes(normalizedTarget)) score = 75;
  else {
    const targetWords = normalizedTarget.split(/\s+/).filter(Boolean);
    const resultWords = normalizedResult.split(/\s+/).filter(Boolean);
    if (targetWords.length > 0) {
      score = Math.round(
        (targetWords.filter((word) => resultWords.includes(word)).length / targetWords.length) * 60
      );
    }
  }

  // Boost for year match
  if (year && resultText.includes(year)) {
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

function generateSearchQueries(title: string, year?: string | null): string[] {
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

  if (year) {
    add(`${title} ${year}`);
  }
  
  if (title.includes(":")) add(title.split(":")[0].trim());
  if (title.includes(" - ")) add(title.split(" - ")[0].trim());

  const cleanTitle = title
    .replace(/[:''\u2019\u201C\u201D"]/g, "")
    .replace(/[&]/g, "and")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (year) {
    add(`${cleanTitle} ${year}`);
  }

  add(cleanTitle);
  add(title);

  const significantWords = cleanTitle.split(/\s+/).filter((word) => word.length >= 2);
  if (significantWords.length > 4) add(significantWords.slice(0, 4).join(" "));
  if (significantWords.length > 3) add(significantWords.slice(0, 3).join(" "));

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
      `${getHdfilmBaseUrl()}/search?q=${encodeURIComponent(query)}`,
      {
        timeout: 6000,
        headers: {
          "X-Requested-With": "fetch",
          Accept: "application/json",
          "User-Agent": UA,
          Referer: getHdfilmReferer()
        }
      }
    );

    const rawResults = response.data?.results;
    if (!Array.isArray(rawResults) || rawResults.length === 0) return [];

    return rawResults
      .map((html) => ({ href: extractHref(html) ?? "", text: extractText(html) }))
      .filter((result) => result.href.length > 0);
  } catch {
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

async function searchHdFilmCehennemiCandidates(title: string, castNames: string[], year?: string | null): Promise<string[]> {
  const queries = generateSearchQueries(title, year);
  const allResults = new Map<string, SearchResult>();

  for (const query of queries) {
    const results = await queryHdFilm(query);
    for (const result of results) {
      if (!allResults.has(result.href)) allResults.set(result.href, result);
    }

    const currentScored = [...allResults.values()].map(r => scoreMatch(r.text, title, year));
    if (currentScored.some(s => s >= 85) || queries.indexOf(query) >= 2) {
      break;
    }
  }

  if (allResults.size === 0) return [];

  const scored = [...allResults.entries()]
    .map(([href, result]) => ({ href, text: result.text, titleScore: scoreMatch(result.text, title, year) }))
    .filter((result) => result.titleScore > 15)
    .sort((a, b) => b.titleScore - a.titleScore);

  if (scored.length === 0) return [];
  
  // Return top candidates to try, prioritized by cast if available
  const topCandidates = scored.slice(0, 3);
  if (castNames.length > 0) {
    const scoredWithCast = await Promise.all(topCandidates.map(async c => ({
      href: c.href,
      castMatches: await verifyCast(c.href, castNames)
    })));
    return scoredWithCast.sort((a, b) => b.castMatches - a.castMatches).map(c => c.href);
  }

  return topCandidates.map(s => s.href);
}

async function hasActualVideo(pageUrl: string): Promise<boolean> {
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
    const hasRapidrame = /rapidrame|rapid/i.test(html);
    const hasAlternativeLink = /alternative-link|class=["']server|data-link|data-video/i.test(html);
    const hasPlayerIframe = /iframe[^>]+src=[^>]+(rplayer|vidmoly|closeload|fastplayer|filemoon|voe|streamwish|dood|mixdrop|streamtape)/i.test(html);

    return hasRapidrame || hasAlternativeLink || hasPlayerIframe || html.includes('kePlayerTitle');
  } catch {
    return false;
  }
}

function matchesSeriesEpisodeUrl(url: string, seasonNumber: number, episodeNumber: number): boolean {
  const normalized = url.toLowerCase();
  
  const seasonRegex = new RegExp(`(sezon[/-]?${seasonNumber}\\b|\\b${seasonNumber}[/-]?sezon|\\bs${seasonNumber}\\b)`, 'i');
  const episodeRegex = new RegExp(`(bolum[/-]?${episodeNumber}\\b|\\b${episodeNumber}[/-]?bolum|\\be${episodeNumber}\\b|ep[/-]?${episodeNumber}\\b)`, 'i');

  return seasonRegex.test(normalized) && episodeRegex.test(normalized);
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
    console.log(`[WebPlayer] Error fetching series page: ${seriesPageUrl}`, e?.message || String(e));
    return null;
  }
}

async function resolvePlayableSeriesEpisodeUrl(
  seriesPageUrl: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<string | null> {
  try {
    const episodeUrl = await findSeriesEpisodeUrl(seriesPageUrl, seasonNumber, episodeNumber);
    if (!episodeUrl) return null;

    const videoAvailable = await hasActualVideo(episodeUrl);
    if (!videoAvailable) return null;

    return episodeUrl;
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
        text: `${result.title ?? ""} ${result.year ?? ""}`.trim().toLowerCase()
      }))
      .filter((result) => result.href.length > 0);
  } catch {
    return [];
  }
}

async function searchDizipal(title: string, mediaType: "movie" | "tv"): Promise<string | null> {
  const queries = generateSearchQueries(title);

  for (const query of queries) {
    const results = await queryDizipal(query, mediaType);
    if (results.length === 0) continue;

    const scored = results
      .map((result, index) => ({
        href: result.href,
        score: Math.max(scoreMatch(result.text, title), scoreMatch(result.text, query)) - index
      }))
      .sort((left, right) => right.score - left.score);

    return scored[0]?.href ?? null;
  }

  return null;
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
};

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

async function findAzClassicYoutubeVideoId(title: string, year?: string | null): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${title} ${year || ""}`);
    const searchUrl = `https://www.youtube.com/@AzerbaijanfilmStudio/search?query=${query}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "az,en;q=0.9"
      },
      timeout: 8000
    });

    const html = response.data;
    const videoIdMatch = html.match(/"videoId":"([^"]+)"/);
    if (videoIdMatch) return videoIdMatch[1];

    const watchMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];

    return null;
  } catch (e) {
    return null;
  }
}

type DizipalResolveResult = {
  pageUrl: string;
  stream: DizipalStreamInfo | null;
  embedUrl: string | null;
};

async function resolvePlayableDizipalUrl(request: WebPlayerRequest): Promise<DizipalResolveResult | null> {
  const dizipalUrl = await searchDizipal(request.title, request.mediaType);
  if (!dizipalUrl) return null;

  let targetUrl = dizipalUrl;

  if (request.mediaType === "tv" && request.seasonNumber && request.episodeNumber) {
    const episodeUrl = await findDizipalEpisodeUrl(
      dizipalUrl,
      request.seasonNumber,
      request.episodeNumber
    );
    if (!episodeUrl) return null;
    targetUrl = episodeUrl;
  } else if (request.mediaType === "tv") return null;

  const result = await fetchDizipalStreamUrl(targetUrl);
  if (result) return { pageUrl: targetUrl, stream: result.stream, embedUrl: result.embedUrl };

  const playable = await hasPlayableDizipalVideo(targetUrl);
  if (playable) return { pageUrl: targetUrl, stream: null, embedUrl: null };

  return null;
}

export async function resolveWebPlayerUrl(request: WebPlayerRequest): Promise<WebPlayerResult> {
  if (request.videoId) {
    return {
      url: request.videoId,
      source: "youtube_embed"
    };
  }

  if (request.isAzClassic) {
    const youtubeId = await findAzClassicYoutubeVideoId(request.title, request.year);
    if (youtubeId) {
      return {
        url: youtubeId,
        source: "youtube_embed"
      };
    }
  }

  const isSeries = request.mediaType !== "movie";
  if (isSeries) {
    const candidates = await searchHdFilmCehennemiCandidates(request.title, request.castNames ?? [], request.year);
    for (const hdfilmUrl of candidates) {
      if (request.seasonNumber && request.episodeNumber) {
        const episodeUrl = await resolvePlayableSeriesEpisodeUrl(
          hdfilmUrl,
          request.seasonNumber,
          request.episodeNumber
        );
        if (episodeUrl) return { url: episodeUrl, source: "hdfilm" };
      } else return { url: hdfilmUrl, source: "hdfilm" };
    }

    const dizipalResult = await resolvePlayableDizipalUrl(request);
    if (dizipalResult) {
      const { pageUrl, stream, embedUrl } = dizipalResult;
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
        };
      }

      if (embedUrl) {
        return {
          url: embedUrl,
          source: "dizipal_embed",
          embedUrl,
        };
      }
      return { url: pageUrl, source: "dizipal" };
    }
  } else {
    const candidates = await searchHdFilmCehennemiCandidates(request.title, request.castNames ?? [], request.year);
    for (const hdfilmUrl of candidates) {
      const videoAvailable = await hasActualVideo(hdfilmUrl);
      if (videoAvailable) return { url: hdfilmUrl, source: "hdfilm" };
    }

    const dizipalResult = await resolvePlayableDizipalUrl(request);
    if (dizipalResult) {
      const { pageUrl, stream, embedUrl } = dizipalResult;
      if (stream) {
        return {
          url: pageUrl,
          source: "dizipal_direct",
          streamUrl: stream.streamUrl,
          streamType: stream.streamType,
          poster: stream.poster,
          referer: stream.referer,
          embedUrl: embedUrl ?? undefined,
          subtitles: stream.subtitles,
        };
      }

      if (embedUrl) {
        return {
          url: embedUrl,
          source: "dizipal_embed",
          embedUrl,
        };
      }
      return { url: pageUrl, source: "dizipal" };
    }
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
    console.error("[WebPlayerService] Direct resolution failed:", error);
  }

  return { url: "", source: "not_found" };
}
