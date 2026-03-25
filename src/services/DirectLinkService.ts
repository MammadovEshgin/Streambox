import axios from "axios";

import type { MediaType } from "../api/tmdb";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const QUALITY_LABEL_REGEX = /(?:^|[^0-9])(2160|1440|1080|720|480|360)p(?:[^0-9]|$)/i;
const HLS_RESOLUTION_REGEX = /RESOLUTION=(\d+)x(\d+)/i;
const HLS_FRAMERATE_REGEX = /FRAME-RATE=([0-9.]+)/i;

const BLOCKED_QUALITY_MARKERS = [
  "cam", "hdcam", "ts", "telesync", "screener",
  "hc", "hardcoded", "hardcoded sub", "hardcoded subtitle"
] as const;

const PREFERRED_QUALITY_MARKERS = ["bluray", "web-dl", "webrip", "1080p", "720p"] as const;
const MIN_VALID_HEIGHT = 720;
const MAX_FRAME_RATE_SPREAD = 6;
const ADDON_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type StreamFormat = "hls" | "mp4";

export type SubtitleTrack = {
  id: string;
  language: string;
  label: string;
  url: string;
  isDefault?: boolean;
};

export type StreamResolveRequest = {
  mediaType: MediaType;
  tmdbId?: string | null;
  imdbId?: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
};

export type StreamProviderConfig = {
  id: string;
  urlTemplate: string;
  responseMode?: "auto" | "json" | "html";
};

export type QualityOption = {
  label: string;
  height: number;
  url: string;
};

function normalizeUrl(url: string): string {
  return url.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").trim();
}

function extractSubtitleTracks(payload: unknown): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  const visited = new Set<unknown>();

  function walk(value: unknown) {
    if (value === null || value === undefined || typeof value === "string" || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const record = value as Record<string, unknown>;
    const rawUrl = record.url ?? record.file ?? record.src;
    if (typeof rawUrl === "string" && /\.(vtt|srt|ttml)(?:\?|$)/i.test(rawUrl)) {
      tracks.push({
        id: `${tracks.length + 1}`,
        url: normalizeUrl(rawUrl),
        label:
          (typeof record.label === "string" && record.label.trim()) ||
          (typeof record.lang === "string" && record.lang.trim()) ||
          (typeof record.language === "string" && record.language.trim()) ||
          "Subtitle",
        language:
          (typeof record.lang === "string" && record.lang.trim()) ||
          (typeof record.language === "string" && record.language.trim()) ||
          "und",
        isDefault: Boolean(record.default)
      });
    }
    Object.values(record).forEach(walk);
  }
  walk(payload);
  return tracks;
}

export type StreamCandidate = {
  providerId: string;
  url: string;
  format: StreamFormat;
  qualityLabel: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  latencyMs: number;
  score: number;
  subtitles: SubtitleTrack[];
  headers?: Record<string, string>;
  qualityOptions?: QualityOption[];
};

export type StreamResolveResult = {
  primary: StreamCandidate;
  fallbacks: StreamCandidate[];
  attemptedProviders: string[];
};

type HlsManifestMetadata = {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  frameRates: number[];
  qualityLabel: string | null;
};

// ---------------------------------------------------------------------------
// Stremio addon protocol types
// ---------------------------------------------------------------------------
type StremioStreamEntry = {
  name?: string;
  title?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  type?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    headers?: Record<string, string>;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
  };
};

type StremioStreamResponse = {
  streams: StremioStreamEntry[];
};

// ---------------------------------------------------------------------------
// Stremio addon instances (free, no API key)
// ---------------------------------------------------------------------------
type AddonInstance = {
  id: string;
  baseUrl: string;
  /** Minimum quality in name to accept (filters out 360p garbage) */
  minAcceptableQuality: number;
};

const ADDON_INSTANCES: AddonInstance[] = [
  {
    id: "nuvio",
    baseUrl: "https://nuviostreams.hayd.uk",
    minAcceptableQuality: 720
  }
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------
function parseQualityLabel(value: string): string | null {
  const match = value.match(QUALITY_LABEL_REGEX);
  if (!match?.[1]) return null;
  return `${match[1]}p`;
}

function toQualityHeight(qualityLabel: string | null): number | null {
  if (!qualityLabel) return null;
  const numeric = Number.parseInt(qualityLabel.replace(/\D/g, ""), 10);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function containsBlockedMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return BLOCKED_QUALITY_MARKERS.some((marker) => normalized.includes(marker));
}

function countPreferredMarkers(value: string): number {
  const normalized = value.toLowerCase();
  return PREFERRED_QUALITY_MARKERS.reduce((acc, marker) => {
    return normalized.includes(marker) ? acc + 1 : acc;
  }, 0);
}

function meetsMinimumQuality(height: number | null, context: string): boolean {
  if (height && height >= MIN_VALID_HEIGHT) return true;
  return countPreferredMarkers(context) > 0;
}

function scoreCandidate(candidate: Pick<StreamCandidate, "format" | "height" | "qualityLabel" | "url">): number {
  const heightFromLabel = toQualityHeight(candidate.qualityLabel);
  const effectiveHeight = candidate.height ?? heightFromLabel ?? 0;
  const preferredBonus = countPreferredMarkers(candidate.url) * 20;
  const formatBonus = candidate.format === "hls" ? 500 : 10;
  return effectiveHeight + preferredBonus + formatBonus;
}

function isFrameRateConsistent(frameRates: number[]): boolean {
  if (frameRates.length <= 1) return true;
  const min = Math.min(...frameRates);
  const max = Math.max(...frameRates);
  return max - min <= MAX_FRAME_RATE_SPREAD;
}

function parseHlsManifestMetadata(manifest: string): HlsManifestMetadata {
  const lines = manifest.split(/\r?\n/);
  let bestWidth: number | null = null;
  let bestHeight: number | null = null;
  const frameRates: number[] = [];

  for (const line of lines) {
    if (!line.includes("#EXT-X-STREAM-INF")) continue;

    const resolutionMatch = line.match(HLS_RESOLUTION_REGEX);
    if (resolutionMatch?.[1] && resolutionMatch[2]) {
      const width = Number.parseInt(resolutionMatch[1], 10);
      const height = Number.parseInt(resolutionMatch[2], 10);
      if (Number.isFinite(width) && Number.isFinite(height) && (bestHeight === null || height > bestHeight)) {
        bestWidth = width;
        bestHeight = height;
      }
    }

    const frameRateMatch = line.match(HLS_FRAMERATE_REGEX);
    if (frameRateMatch?.[1]) {
      const frameRate = Number.parseFloat(frameRateMatch[1]);
      if (Number.isFinite(frameRate)) frameRates.push(frameRate);
    }
  }

  const roundedFrameRates = frameRates.map((v) => Number(v.toFixed(2)));
  const frameRate = roundedFrameRates.length > 0 ? Math.max(...roundedFrameRates) : null;
  const qualityLabel = bestHeight ? `${bestHeight}p` : null;

  return { width: bestWidth, height: bestHeight, frameRate, frameRates: roundedFrameRates, qualityLabel };
}

// ---------------------------------------------------------------------------
// Subtitle extraction from HLS master playlist
// ---------------------------------------------------------------------------
function extractSubtitlesFromHlsManifest(manifest: string): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  const seen = new Set<string>();

  // More robust line-by-line parsing
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.includes("TYPE=SUBTITLES")) continue;

    const nameMatch = line.match(/NAME="([^"]*)"/);
    const langMatch = line.match(/LANGUAGE="([^"]*)"/);
    const uriMatch = line.match(/URI="([^"]*)"/);
    const defaultMatch = line.match(/DEFAULT=(YES|NO)/);
    const forcedMatch = line.match(/FORCED=(YES|NO)/);

    if (!uriMatch?.[1]) continue;

    // Skip forced subtitle tracks (these are often hardcoded-style burn-in cues)
    if (forcedMatch?.[1] === "YES") continue;

    const label = nameMatch?.[1] ?? "Subtitle";
    const language = langMatch?.[1] ?? "und";
    const url = uriMatch[1];

    // Skip hardcoded / forced subtitle indicators in label
    if (/\[forced\]/i.test(label)) continue;

    const dedupeKey = `${language}:${label}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    tracks.push({
      id: `sub-${tracks.length + 1}`,
      label,
      language,
      url,
      isDefault: defaultMatch?.[1] === "YES"
    });
  }

  return tracks;
}

// ---------------------------------------------------------------------------
// Known provider headers (injected when behaviorHints is absent)
// ---------------------------------------------------------------------------
const UA_HEADER =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const KNOWN_PROVIDER_HEADERS: Array<{ pattern: RegExp; headers: Record<string, string> }> = [
  {
    pattern: /vixsrc\.to/i,
    headers: { Referer: "https://vixsrc.to/", "User-Agent": UA_HEADER }
  },
  {
    pattern: /vidcloud/i,
    headers: { Referer: "https://vidcloud.to/" }
  }
];

function inferProviderHeaders(url: string): Record<string, string> {
  for (const entry of KNOWN_PROVIDER_HEADERS) {
    if (entry.pattern.test(url)) return { ...entry.headers };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Stremio stream entry → StreamCandidate conversion
// ---------------------------------------------------------------------------
function getFormatFromUrl(url: string, nameHint?: string): StreamFormat {
  const lower = url.toLowerCase();
  const hint = (nameHint ?? "").toLowerCase();
  // HLS indicators in URL
  if (lower.includes(".m3u8") || lower.includes("playlist") || lower.includes("mpegurl")) return "hls";
  // Known HLS providers by name
  if (hint.includes("mp4hydra") || hint.includes("hls") || hint.includes("vixsrc")) return "hls";
  // URL path clues
  if (lower.includes("/playlist/") || lower.includes("/hls/") || lower.includes("/stream/")) return "hls";
  // Generic CDN URLs without extension are treated as HLS to trigger manifest enrichment
  const hasExtension = /\.(mp4|mkv|avi|webm|ts)(\?|$)/i.test(url);
  if (!hasExtension && url.startsWith("http")) return "hls";
  return "mp4";
}

function stremioEntryToCandidate(
  entry: StremioStreamEntry,
  addonId: string,
  latencyMs: number,
  minQuality: number
): StreamCandidate | null {
  const url = entry.url;
  if (!url) return null;

  // Skip torrent streams
  if (entry.infoHash) return null;
  // Skip external URLs (open in browser)
  if (entry.externalUrl && !url) return null;

  const nameAndTitle = `${entry.name ?? ""} ${entry.title ?? ""}`;

  // Filter blocked quality markers (CAM, TS, screener, hardcoded subs)
  if (containsBlockedMarker(nameAndTitle)) return null;

  // Extract quality from name like "MP4Hydra #1 - 1080p"
  const qualityLabel = parseQualityLabel(nameAndTitle) ?? parseQualityLabel(url);
  const height = toQualityHeight(qualityLabel);

  // Filter out sources below minimum acceptable quality
  if (height !== null && height < minQuality) return null;

  // Detect format
  const format = getFormatFromUrl(url, nameAndTitle);

  // Extract custom headers (Referer etc.) from behaviorHints, with provider-specific fallback
  const headers: Record<string, string> = { ...inferProviderHeaders(url) };
  if (entry.behaviorHints?.headers) {
    Object.assign(headers, entry.behaviorHints.headers);
  }
  if (entry.behaviorHints?.proxyHeaders?.request) {
    Object.assign(headers, entry.behaviorHints.proxyHeaders.request);
  }

  // Extract subtitles from entry payload
  const subtitles = extractSubtitleTracks(entry);

  // Build quality options from detected height so the UI can show the settings icon
  const qualityOptions: QualityOption[] | undefined =
    height === 720 || height === 1080
      ? [{ label: `${height}p`, height, url }]
      : undefined;

  const candidate: StreamCandidate = {
    providerId: addonId,
    url,
    format,
    qualityLabel,
    width: null,
    height,
    frameRate: null,
    latencyMs,
    score: 0,
    subtitles,
    qualityOptions,
    headers: Object.keys(headers).length > 0 ? headers : undefined
  };

  return { ...candidate, score: scoreCandidate(candidate) };
}

// ---------------------------------------------------------------------------
// Fetch streams from a single Stremio addon
// ---------------------------------------------------------------------------
function buildStremioStreamPath(request: StreamResolveRequest): string {
  const { mediaType, tmdbId, imdbId, seasonNumber, episodeNumber } = request;

  // Prefer IMDb ID (native to Stremio protocol), fall back to tmdb: prefix
  const id = imdbId ?? `tmdb:${tmdbId}`;

  if (mediaType === "tv" && seasonNumber && episodeNumber) {
    return `/stream/series/${id}:${seasonNumber}:${episodeNumber}.json`;
  }

  if (mediaType === "movie") {
    return `/stream/movie/${id}.json`;
  }

  // Fallback for tv without season/episode
  return `/stream/series/${id}:1:1.json`;
}

async function fetchAddonStreams(
  addon: AddonInstance,
  request: StreamResolveRequest
): Promise<StreamCandidate[]> {
  const path = buildStremioStreamPath(request);
  const url = `${addon.baseUrl}${path}`;
  const startedAt = Date.now();

  const response = await axios.get<StremioStreamResponse>(url, {
    timeout: ADDON_TIMEOUT_MS,
    headers: {
      Accept: "application/json",
      "User-Agent": "StreamBox/1.0"
    }
  });

  const latencyMs = Date.now() - startedAt;
  const streams = response.data?.streams;
  if (!Array.isArray(streams)) return [];

  const candidates: StreamCandidate[] = [];
  for (const entry of streams) {
    const candidate = stremioEntryToCandidate(entry, addon.id, latencyMs, addon.minAcceptableQuality);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// HLS manifest enrichment (subtitle + quality parsing)
// ---------------------------------------------------------------------------
function resolveRelativeUrl(baseUrl: string, relativeUrl: string): string {
  if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
    return relativeUrl;
  }
  try {
    return new URL(relativeUrl, baseUrl).toString();
  } catch {
    // If URL parsing fails, try manual resolution
    const baseOrigin = baseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] ?? "";
    if (relativeUrl.startsWith("/")) {
      return `${baseOrigin}${relativeUrl}`;
    }
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
    return `${basePath}${relativeUrl}`;
  }
}

function extractQualityOptionsFromHls(manifest: string, masterUrl: string): QualityOption[] {
  const options: QualityOption[] = [];
  const lines = manifest.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes("#EXT-X-STREAM-INF")) continue;

    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
    if (!resMatch?.[2]) continue;

    const height = Number.parseInt(resMatch[2], 10);
    if (!Number.isFinite(height)) continue;
    if (height !== 720 && height !== 1080) continue;

    // Scan forward to find the URL (skipping other tags)
    let urlLine = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (next.startsWith("#")) {
        // Stop if we hit another STREAM-INF or MEDIA block, missing the URL
        if (next.includes("#EXT-X-STREAM-INF") || next.includes("#EXT-X-MEDIA")) break;
        continue; // skip other tags like #EXT-X-FRAME-RATE
      }
      urlLine = next;
      break;
    }

    if (urlLine) {
      options.push({
        label: `${height}p`,
        height,
        url: resolveRelativeUrl(masterUrl, urlLine)
      });
    }
  }

  // Sort highest first
  return options.sort((a, b) => b.height - a.height);
}

async function fetchHlsManifest(url: string, headers: Record<string, string>): Promise<string | null> {
  // Try twice with increasing timeout
  for (const timeout of [10000, 15000]) {
    try {
      const { data } = await axios.get<string>(url, {
        timeout,
        responseType: "text",
        headers: {
          ...headers,
          Accept: "*/*",
          "User-Agent": "StreamBox/1.0"
        }
      });
      if (typeof data === "string" && data.includes("#EXTM3U")) {
        return data;
      }
    } catch {
      // Retry with longer timeout
    }
  }
  return null;
}

async function enrichHlsCandidate(candidate: StreamCandidate): Promise<StreamCandidate> {
  const masterUrl = candidate.url;
  const manifest = await fetchHlsManifest(masterUrl, candidate.headers ?? {});

  if (!manifest) return candidate;

  // Parse quality metadata
  const metadata = parseHlsManifestMetadata(manifest);

  // Parse subtitle tracks (only English and Turkish)
  const allSubtitles = extractSubtitlesFromHlsManifest(manifest);
  const filteredSubtitles = allSubtitles
    .filter((s) => {
      const lang = s.language.toLowerCase();
      const lbl = s.label.toLowerCase();
      const isEng = lang.startsWith("eng") || lang.startsWith("en") || lbl.includes("english") || lbl === "en";
      const isTur = lang === "tur" || lang.startsWith("tr") || lbl.includes("turkish") || lbl.includes("türk");
      return isEng || isTur;
    })
    .map((s) => ({
      ...s,
      url: resolveRelativeUrl(masterUrl, s.url)
    }));

  // Extract quality rendition URLs (only 720p and 1080p)
  const hlsQualityOptions = extractQualityOptionsFromHls(manifest, masterUrl);

  // Merge with any quality options already known from stream title
  const qualityOptions = hlsQualityOptions.length > 0 ? hlsQualityOptions : (candidate.qualityOptions ?? []);

  // Keep the master URL for direct play to ensure audio and subtitle tracks are correctly negotiated
  const playUrl = masterUrl;
  const playHeight = metadata.height;
  const playLabel = playHeight ? `${playHeight}p` : metadata.qualityLabel;

  // Build quality options list starting with an 'Auto' entry
  const finalQualityOptions: QualityOption[] = [];
  if (qualityOptions.length > 0) {
    finalQualityOptions.push({
      label: "Auto (Best)",
      height: 0,
      url: masterUrl
    });
    finalQualityOptions.push(...qualityOptions);
  }

  const enriched: StreamCandidate = {
    ...candidate,
    url: playUrl,
    width: metadata.width ?? candidate.width,
    height: playHeight ?? candidate.height,
    frameRate: metadata.frameRate ?? candidate.frameRate,
    qualityLabel: playLabel ?? candidate.qualityLabel,
    subtitles: filteredSubtitles.length > 0 ? filteredSubtitles : candidate.subtitles,
    qualityOptions: finalQualityOptions.length > 0 ? finalQualityOptions : undefined
  };

  return { ...enriched, score: scoreCandidate(enriched) };
}

// ---------------------------------------------------------------------------
// Dedup + rank
// ---------------------------------------------------------------------------
function dedupeCandidates(candidates: StreamCandidate[]): StreamCandidate[] {
  const seen = new Set<string>();
  const deduped: StreamCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    deduped.push(candidate);
  }

  return deduped;
}

function rankCandidates(candidates: StreamCandidate[]): StreamCandidate[] {
  return candidates
    .slice()
    .sort((a, b) => (b.score === a.score ? a.latencyMs - b.latencyMs : b.score - a.score));
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------
export async function resolveDirectLink(
  request: StreamResolveRequest
): Promise<StreamResolveResult> {
  const attemptedProviders: string[] = [];
  const allCandidates: StreamCandidate[] = [];

  // Query all addon instances in parallel
  const results = await Promise.allSettled(
    ADDON_INSTANCES.map((addon) => fetchAddonStreams(addon, request))
  );

  for (const [index, result] of results.entries()) {
    const addonId = ADDON_INSTANCES[index]?.id ?? `addon-${index}`;
    attemptedProviders.push(addonId);
    if (result.status === "fulfilled") {
      allCandidates.push(...result.value);
    }
  }

  const unique = dedupeCandidates(allCandidates);

  if (unique.length === 0) {
    throw new Error(
      "No playable stream found for this title. All stream providers were attempted."
    );
  }

  // DEBUG LOGGING
  console.log("== RAW UNIQUE CANDIDATES ==");
  unique.slice(0, 3).forEach((c, idx) => {
    console.log(`[Cand ${idx}] URL: ${c.url}`);
    console.log(`      Format: ${c.format}`);
    console.log(`      Subtitles: ${c.subtitles.length}`);
  });

  // Enrich HLS candidates with subtitle + quality data in parallel
  // This fetches the master playlist and changes the URL to a specific 1080p/720p rendition
  const enriched = await Promise.all(
    unique.map((c) => (c.format === "hls" ? enrichHlsCandidate(c) : Promise.resolve(c)))
  );

  // DEBUG LOGGING
  console.log("== ENRICHED CANDIDATES ==");
  enriched.slice(0, 3).forEach((c, idx) => {
    console.log(`[Cand ${idx}] Options: ${(c.qualityOptions || []).length}`);
    console.log(`      Subtitles: ${c.subtitles.length}`);
  });

  // Keep all candidates — don't filter aggressively since we need fallbacks
  const ranked = rankCandidates(enriched);
  const primary = ranked[0];
  const fallbacks = ranked.slice(1);

  return {
    primary,
    fallbacks,
    attemptedProviders
  };
}

// ---------------------------------------------------------------------------
// Legacy exports (preserved for env-based config compat)
// ---------------------------------------------------------------------------
export function getConfiguredProvidersFromEnv(): StreamProviderConfig[] {
  return [];
}

// ---------------------------------------------------------------------------
// Test internals (preserved for existing test suite)
// ---------------------------------------------------------------------------
const STREAM_URL_REGEX = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;

function extractStreamCandidatesFromPayload(
  payload: unknown,
  providerId: string,
  initialLatencyMs: number
): StreamCandidate[] {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (!serialized) return [];

  const subtitleTracks = extractSubtitleTracks(payload);
  const matches = Array.from(serialized.matchAll(STREAM_URL_REGEX));

  return matches
    .map((match) => {
      const rawUrl = match[0];
      if (!rawUrl) return null;
      const normalizedUrl = normalizeUrl(rawUrl);
      const format = getFormatFromUrl(normalizedUrl);
      if (!format) return null;

      const index = match.index ?? 0;
      const context = serialized.slice(
        Math.max(0, index - 120),
        Math.min(serialized.length, index + rawUrl.length + 120)
      );
      const qualityLabel = parseQualityLabel(`${normalizedUrl} ${context}`);
      const height = toQualityHeight(qualityLabel);

      const candidate: StreamCandidate = {
        providerId,
        url: normalizedUrl,
        format,
        qualityLabel,
        width: null,
        height,
        frameRate: null,
        latencyMs: initialLatencyMs,
        score: 0,
        subtitles: subtitleTracks
      };

      return { ...candidate, score: scoreCandidate(candidate) };
    })
    .filter((c): c is StreamCandidate => c !== null);
}

export const __internal = {
  parseHlsManifestMetadata,
  extractStreamCandidatesFromPayload,
  isFrameRateConsistent,
  meetsMinimumQuality,
  containsBlockedMarker,
  dedupeCandidates,
  rankCandidates,
  scoreCandidate
};

