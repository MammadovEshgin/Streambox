import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUDIO_PREFERENCE,
  getAudioTrackLabel,
  isOriginalAudioTrack,
  pickPreferredAudioTrack,
  resolveAudioTrackLanguage,
  type AudioTrackLike,
} from "../src/utils/audioTracks";

// The exact rendition list HDFilmCehennemi serves for a DUAL title — note the
// empty language codes (the manifest carries NAME but no LANGUAGE) and that the
// Turkish dub is the one flagged DEFAULT=YES upstream.
const HDFILM_DUAL: AudioTrackLike[] = [
  { id: "0", language: "", label: "Turkish" },
  { id: "1", language: "", label: "Original Audio" },
];

test("dual stream defaults to the original soundtrack, not the provider's dub", () => {
  const picked = pickPreferredAudioTrack(HDFILM_DUAL, DEFAULT_AUDIO_PREFERENCE);
  assert.equal(picked?.label, "Original Audio");
});

test("an explicit language preference wins when the stream carries it", () => {
  const picked = pickPreferredAudioTrack(HDFILM_DUAL, { kind: "language", language: "tr" });
  assert.equal(picked?.label, "Turkish");
});

test("a language preference the stream lacks falls back to original audio", () => {
  const picked = pickPreferredAudioTrack(HDFILM_DUAL, { kind: "language", language: "de" });
  assert.equal(picked?.label, "Original Audio");
});

test("single-track streams are left alone", () => {
  assert.equal(pickPreferredAudioTrack([{ id: "0", language: "en", label: "English" }]), null);
  assert.equal(pickPreferredAudioTrack([]), null);
});

test("returns null rather than guessing when no track is identifiable", () => {
  const tracks: AudioTrackLike[] = [
    { id: "0", language: "", label: "Audio 1" },
    { id: "1", language: "", label: "Audio 2" },
  ];
  assert.equal(pickPreferredAudioTrack(tracks, DEFAULT_AUDIO_PREFERENCE), null);
});

test("Dizipal-style 'Türkçe + English' picks English (no track says 'Original')", () => {
  const tracks: AudioTrackLike[] = [
    { id: "0", language: "", label: "Türkçe" },
    { id: "1", language: "", label: "English" },
  ];
  assert.equal(pickPreferredAudioTrack(tracks, DEFAULT_AUDIO_PREFERENCE)?.label, "English");
});

test("multi-dub streams pick the first non-Turkish rendition", () => {
  const tracks: AudioTrackLike[] = [
    { id: "0", language: "", label: "Türkçe" },
    { id: "1", language: "", label: "Deutsch" },
    { id: "2", language: "", label: "English" },
  ];
  assert.equal(pickPreferredAudioTrack(tracks, DEFAULT_AUDIO_PREFERENCE)?.label, "Deutsch");
  // …and an explicit preference still overrides the heuristic.
  assert.equal(
    pickPreferredAudioTrack(tracks, { kind: "language", language: "en" })?.label,
    "English"
  );
});

test("an all-Turkish track list is left on the player's own choice", () => {
  const tracks: AudioTrackLike[] = [
    { id: "0", language: "", label: "Türkçe Dublaj" },
    { id: "1", language: "tr", label: "Türkçe" },
  ];
  assert.equal(pickPreferredAudioTrack(tracks, DEFAULT_AUDIO_PREFERENCE), null);
});

test("language resolution prefers the manifest code and ignores placeholders", () => {
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "en-US", label: "Whatever" }), "en");
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "und", label: "Turkish" }), "tr");
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "", label: "Original Audio" }), "");
});

test("Turkish-labelled tracks resolve regardless of spelling", () => {
  // "İngilizce" lowercases to i + combining dot, so a plain "ing" test fails —
  // the regression this guards against.
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "", label: "İngilizce" }), "en");
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "", label: "Türkçe" }), "tr");
  assert.equal(resolveAudioTrackLanguage({ id: "0", language: "", label: "Turkce Dublaj" }), "tr");
});

test("original-audio detection matches both English and Turkish wording", () => {
  assert.ok(isOriginalAudioTrack({ id: "0", language: "", label: "Original Audio" }));
  assert.ok(isOriginalAudioTrack({ id: "0", language: "", label: "Orijinal Ses" }));
  assert.ok(!isOriginalAudioTrack({ id: "0", language: "", label: "Turkish" }));
});

test("menu labels degrade gracefully when the manifest names nothing", () => {
  assert.equal(getAudioTrackLabel({ id: "0", language: "", label: "Turkish" }, 0), "Turkish");
  assert.equal(getAudioTrackLabel({ id: "0", language: "fr", label: "" }, 1), "FR");
  assert.equal(getAudioTrackLabel({ id: "0", language: "", label: "" }, 1), "Audio 2");
});
