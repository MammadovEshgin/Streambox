/**
 * Subtitle parsing utilities — pure, side-effect-free.
 *
 * Extracted from PlayerScreen so they're testable in isolation. The player
 * supports WebVTT (.vtt) and SubRip (.srt) side-loaded subtitle files; both use
 * "HH:MM:SS.mmm --> HH:MM:SS.mmm" cue timing lines with the formats differing
 * mainly in newline conventions and optional cue identifiers.
 */

export type ParsedSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export function decodeSubtitleText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function parseVttTimestamp(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  const parts = trimmed.split(":").map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return null;
}

/**
 * Extract the timestamp portion from the end-part of a VTT/SRT timing line.
 * After splitting "00:10.000 --> 00:13.083 align:start" by "-->",
 * endRaw is " 00:13.083 align:start". We need just "00:13.083".
 * Using `.split(" ")[0]` fails when there's a leading space (produces "").
 */
export function extractTimestampFromEndPart(endRaw: string): string {
  const trimmed = endRaw.trim();
  // Take everything up to the first space (cue settings come after)
  const spaceIdx = trimmed.indexOf(" ");
  return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
}

export function parseWebVtt(content: string): ParsedSubtitleCue[] {
  // Normalize all line ending variants: \r\n, \r (old Mac), \n
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // First try splitting by double newlines (standard VTT)
  const blocks = normalized.split(/\n{2,}/);

  // If we only get 1-2 blocks but there are multiple --> timestamps,
  // the file uses single-newline separation — parse line-by-line instead
  const arrowCount = (normalized.match(/-->/g) || []).length;
  if (blocks.length <= 2 && arrowCount > 1) {
    return parseWebVttLineByLine(normalized);
  }

  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;
    if (lines[0].toUpperCase().startsWith("WEBVTT")) continue;
    if (lines[0].startsWith("NOTE")) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
    if (start == null || end == null) continue;

    const text = decodeSubtitleText(lines.slice(timeLineIndex + 1).join("\n")).trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

/** Fallback parser for VTT files that use single-newline separation between cues. */
export function parseWebVttLineByLine(normalized: string): ParsedSubtitleCue[] {
  const lines = normalized.split("\n");
  const cues: ParsedSubtitleCue[] = [];
  let i = 0;

  // Skip WEBVTT header
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.toUpperCase().startsWith("WEBVTT") || trimmed === "" || trimmed.startsWith("NOTE")) {
      i++;
      continue;
    }
    break;
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Skip empty lines and numeric cue IDs
    if (!trimmed || /^\d+$/.test(trimmed)) {
      i++;
      continue;
    }

    // Look for a timestamp line
    if (trimmed.includes("-->")) {
      const [startRaw, endRaw] = trimmed.split("-->");
      const start = parseVttTimestamp(startRaw);
      const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
      i++;

      if (start == null || end == null) continue;

      // Collect text lines until next timestamp or empty line
      const textLines: string[] = [];
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (!nextTrimmed || nextTrimmed.includes("-->") || /^\d+$/.test(nextTrimmed)) break;
        textLines.push(nextTrimmed);
        i++;
      }

      const text = decodeSubtitleText(textLines.join("\n")).trim();
      if (text) {
        cues.push({ start, end, text });
      }
    } else {
      i++;
    }
  }

  return cues;
}

export function parseSubRip(content: string): ParsedSubtitleCue[] {
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    const start = parseVttTimestamp(startRaw);
    const end = parseVttTimestamp(extractTimestampFromEndPart(endRaw ?? ""));
    if (start == null || end == null) continue;

    const text = decodeSubtitleText(lines.slice(timeLineIndex + 1).join("\n")).trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

/**
 * Try WebVTT first; if it yields nothing, fall back to SubRip.
 * VTT and SRT have nearly-identical cue structures so this is permissive.
 */
export function parseSubtitleDocument(content: string): ParsedSubtitleCue[] {
  const vttCues = parseWebVtt(content);
  if (vttCues.length > 0) return vttCues;
  return parseSubRip(content);
}

/**
 * Resolve a possibly-relative subtitle URL against an ordered list of bases.
 * The first base that successfully constructs a URL wins. Returns the trimmed
 * input unchanged if every base fails (e.g. all are nullish or invalid).
 */
export function normalizeSubtitleUrl(url: string, ...bases: Array<string | null | undefined>): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";

  for (const base of bases) {
    if (!base) continue;
    try {
      return new URL(trimmed, base).toString();
    } catch {
      // Try next base.
    }
  }

  return trimmed;
}
