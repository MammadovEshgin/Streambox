import assert from "node:assert/strict";
import test from "node:test";

import {
  isForcedSubtitle,
  normalizeSubtitleLanguage,
  pickDefaultSubtitle,
  type SubtitleOptionLike,
} from "../src/utils/subtitleSelection";

// Track lists captured from the live providers on 2026-08-02. Note the mixed
// code systems (HDFilm emits both "en" and "eng"; Dizipal emits "eng"/"tur")
// and HDFilm's "Forced" track, whose lang parses out of the filename as "for" —
// which is not a language at all.
const HDFILM_TRACKS: SubtitleOptionLike[] = [
  { label: "English", lang: "en" },
  { label: "Forced", lang: "for" },
  { label: "French", lang: "fr" },
  { label: "Portuguese", lang: "pt" },
  { label: "Spanish", lang: "es" },
  { label: "Turkish", lang: "tr" },
];

const DIZIPAL_TRACKS: SubtitleOptionLike[] = [
  { label: "Turkish", lang: "tur" },
  { label: "English", lang: "eng" },
];

test("Turkish viewer hearing original English audio gets Turkish subtitles", () => {
  const picked = pickDefaultSubtitle(HDFILM_TRACKS, { appLanguage: "tr", audioLanguage: "en" });
  assert.equal(picked?.label, "Turkish");
});

test("English viewer hearing English audio gets no subtitles", () => {
  assert.equal(pickDefaultSubtitle(HDFILM_TRACKS, { appLanguage: "en", audioLanguage: "en" }), null);
});

test("English viewer hearing a Turkish dub gets English subtitles", () => {
  const picked = pickDefaultSubtitle(HDFILM_TRACKS, { appLanguage: "en", audioLanguage: "tr" });
  assert.equal(picked?.label, "English");
});

test("three-letter provider codes resolve (Dizipal 'tur'/'eng')", () => {
  const picked = pickDefaultSubtitle(DIZIPAL_TRACKS, { appLanguage: "tr", audioLanguage: "en" });
  assert.equal(picked?.label, "Turkish");
  assert.equal(
    pickDefaultSubtitle(DIZIPAL_TRACKS, { appLanguage: "en", audioLanguage: "tr" })?.label,
    "English"
  );
});

test("the Forced track is never auto-selected", () => {
  // It carries a handful of cues for signs only; as a primary subtitle it looks
  // like the subtitles are broken.
  const forcedOnly: SubtitleOptionLike[] = [
    { label: "Forced", lang: "for" },
    { label: "Turkish", lang: "tr" },
  ];
  assert.equal(
    pickDefaultSubtitle(forcedOnly, { appLanguage: "tr", audioLanguage: "en" })?.label,
    "Turkish"
  );
  // …and when the only candidate is forced, stay off rather than show it.
  assert.equal(
    pickDefaultSubtitle([{ label: "Forced", lang: "for" }], { appLanguage: "tr", audioLanguage: "en" }),
    null
  );
  assert.ok(isForcedSubtitle({ label: "Forced", lang: "for" }));
  assert.ok(!isForcedSubtitle({ label: "English", lang: "en" }));
});

test("'for' is treated as no language, not as a real code", () => {
  assert.equal(normalizeSubtitleLanguage({ label: "Forced", lang: "for" }), "");
});

test("unknown audio language leaves subtitles alone", () => {
  assert.equal(pickDefaultSubtitle(HDFILM_TRACKS, { appLanguage: "tr", audioLanguage: "" }), null);
});

test("a stream with no track in the app language stays off", () => {
  const tracks: SubtitleOptionLike[] = [{ label: "French", lang: "fr" }];
  assert.equal(pickDefaultSubtitle(tracks, { appLanguage: "tr", audioLanguage: "en" }), null);
});

test("language normalization handles labels, locales and 639-2 codes", () => {
  assert.equal(normalizeSubtitleLanguage({ label: "", lang: "eng" }), "en");
  assert.equal(normalizeSubtitleLanguage({ label: "", lang: "en-US" }), "en");
  assert.equal(normalizeSubtitleLanguage({ label: "Türkçe", lang: "" }), "tr");
  assert.equal(normalizeSubtitleLanguage({ label: "İngilizce", lang: "und" }), "en");
  assert.equal(normalizeSubtitleLanguage({ label: "", lang: "" }), "");
});

test("empty track lists are safe", () => {
  assert.equal(pickDefaultSubtitle([], { appLanguage: "tr", audioLanguage: "en" }), null);
});
