import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeSubtitleText,
  extractTimestampFromEndPart,
  normalizeSubtitleUrl,
  parseSubRip,
  parseSubtitleDocument,
  parseVttTimestamp,
  parseWebVtt
} from "../src/utils/subtitles";

test("parseVttTimestamp accepts HH:MM:SS.mmm and MM:SS.mmm", () => {
  assert.equal(parseVttTimestamp("01:02:03.500"), 3723.5);
  assert.equal(parseVttTimestamp("02:30.250"), 150.25);
});

test("parseVttTimestamp accepts SRT comma separators", () => {
  assert.equal(parseVttTimestamp("00:00:10,000"), 10);
});

test("parseVttTimestamp rejects malformed input", () => {
  assert.equal(parseVttTimestamp("not-a-time"), null);
  assert.equal(parseVttTimestamp("01:two:03"), null);
});

test("extractTimestampFromEndPart trims cue settings after the timestamp", () => {
  // Real-world VTT bug: end raw includes leading space and cue settings.
  assert.equal(extractTimestampFromEndPart(" 00:13.083 align:start"), "00:13.083");
  assert.equal(extractTimestampFromEndPart("00:13.083"), "00:13.083");
});

test("decodeSubtitleText decodes common HTML entities and br tags", () => {
  assert.equal(decodeSubtitleText("a<br/>b"), "a\nb");
  assert.equal(decodeSubtitleText("&amp;&lt;&gt;&quot;&#39;&nbsp;"), "&<>\"' ");
  assert.equal(decodeSubtitleText("<i>hello</i>"), "hello");
});

test("parseWebVtt parses a standard WEBVTT file with double-newline separators", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.000 --> 00:00:03.000",
    "Hello",
    "",
    "2",
    "00:00:04.000 --> 00:00:06.000 align:center",
    "World <i>line</i>"
  ].join("\n");

  const cues = parseWebVtt(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 3, text: "Hello" });
  assert.equal(cues[1].text, "World line");
  assert.equal(cues[1].end, 6); // cue setting "align:center" stripped
});

test("parseWebVtt handles single-newline-separated cues via line-by-line fallback", () => {
  const vtt = [
    "WEBVTT",
    "00:00:01.000 --> 00:00:03.000",
    "Hello",
    "00:00:04.000 --> 00:00:06.000",
    "World"
  ].join("\n");

  const cues = parseWebVtt(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Hello");
  assert.equal(cues[1].text, "World");
});

test("parseSubRip parses an .srt file", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Hello",
    "",
    "2",
    "00:00:04,500 --> 00:00:06,750",
    "World"
  ].join("\n");

  const cues = parseSubRip(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[1].end, 6.75);
});

test("parseSubtitleDocument prefers VTT and falls back to SRT", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,000\nHi\n";
  const cues = parseSubtitleDocument(srt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Hi");
});

test("normalizeSubtitleUrl returns absolute URLs unchanged", () => {
  assert.equal(
    normalizeSubtitleUrl("https://cdn.example.com/sub.vtt"),
    "https://cdn.example.com/sub.vtt"
  );
});

test("normalizeSubtitleUrl resolves relative URLs against the first usable base", () => {
  const out = normalizeSubtitleUrl(
    "/sub.vtt",
    null,
    undefined,
    "https://cdn.example.com/embed/abc"
  );
  assert.equal(out, "https://cdn.example.com/sub.vtt");
});

test("normalizeSubtitleUrl returns the trimmed input if no base resolves", () => {
  assert.equal(normalizeSubtitleUrl("  /sub.vtt  ", null, undefined), "/sub.vtt");
});

test("normalizeSubtitleUrl returns empty string for blank input", () => {
  assert.equal(normalizeSubtitleUrl(""), "");
  assert.equal(normalizeSubtitleUrl("   "), "");
});
