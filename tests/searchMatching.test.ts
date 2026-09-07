import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { foldForTitleCompare, foldNonDecomposingLetters } from "../src/utils/textFolding";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// Search used to lose titles two different ways, and both showed up to the
// viewer as "I typed the name correctly and it isn't there".
// ---------------------------------------------------------------------------

test("Turkish dotless i survives normalisation instead of becoming a space", () => {
  // The reported case: the series "Mezarlık" could not be found by typing
  // "mezarlik". NFD has no decomposition for ı (U+0131), so the `[^a-z0-9]`
  // strip deleted it and the title normalised to "mezarl k".
  assert.equal(foldForTitleCompare("Mezarlık"), "mezarlik");
  assert.equal(foldForTitleCompare("mezarlik"), "mezarlik");
  assert.equal(foldForTitleCompare("Mezarlık"), foldForTitleCompare("mezarlik"));

  // The rest of the Turkish alphabet already worked via NFD; keep it working.
  assert.equal(foldForTitleCompare("Yadigârları"), "yadigarlari");
  assert.equal(foldForTitleCompare("Aşk-ı Memnu"), "ask i memnu");
  assert.equal(foldForTitleCompare("Çukur"), "cukur");
  assert.equal(foldForTitleCompare("Şahsiyet"), "sahsiyet");
  assert.equal(foldForTitleCompare("Gönül"), "gonul");
  assert.equal(foldForTitleCompare("İstanbullu Gelin"), "istanbullu gelin");
});

test("other letters with no NFD decomposition fold instead of vanishing", () => {
  // Same class of bug, different alphabets — each of these used to be deleted.
  assert.equal(foldNonDecomposingLetters("Ələkbər"), "Elekber"); // Azerbaijani schwa (both cases)
  assert.equal(foldForTitleCompare("Ələkbər"), "elekber");
  assert.equal(foldForTitleCompare("Kærlighed"), "kaerlighed");
  assert.equal(foldForTitleCompare("Łódź"), "lodz");
  assert.equal(foldForTitleCompare("Straße"), "strasse");
});

test("folding leaves plain ASCII titles untouched", () => {
  assert.equal(foldForTitleCompare("Breaking Bad"), "breaking bad");
  assert.equal(foldForTitleCompare("  The   Matrix  "), "the matrix");
  assert.equal(foldForTitleCompare("Se7en"), "se7en");
  assert.equal(foldForTitleCompare("WALL·E"), "wall e");
});

test("search does not hide a title the viewer named just because it is unrated", () => {
  // TMDB reports vote_average 0 for anything with too few votes, so the old
  // flat `item.rating >= 6` gate deleted new releases and niche/non-English
  // titles outright. Worse, deleting them ALL left `filtered` empty, which is
  // one of the conditions that flips searchMulti to the actor-credits branch —
  // so searching for a film answered with somebody's filmography instead.
  const source = readSource("src", "api", "tmdb.ts");

  assert.equal(
    source.includes("item.title !== \"Untitled\" && item.rating >= 6"),
    false,
    "the blanket rating gate must not come back"
  );
  assert.equal(source.includes("getSearchTitleScore(query, item) > 0"), true);
  assert.equal(source.includes("SEARCH_WEAK_MATCH_MIN_RATING"), true);

  // The weak-match floor still exists, so unrelated low-quality hits stay out.
  const floor = source.match(/const SEARCH_WEAK_MATCH_MIN_RATING = (\d+)/)?.[1];
  assert.equal(floor, "6");
});

test("every TMDB title normaliser folds before stripping non-ASCII", () => {
  // A normaliser that strips first re-introduces the Mezarlık bug silently.
  const source = readSource("src", "api", "tmdb.ts");
  assert.equal(source.includes("foldForTitleCompare"), true);
  assert.equal(
    /function normalizeSearchTerm[\s\S]{0,400}?foldForTitleCompare/.test(source),
    true,
    "normalizeSearchTerm must fold"
  );
  assert.equal(
    /function normalizeTitleForMatch[\s\S]{0,400}?foldForTitleCompare/.test(source),
    true,
    "normalizeTitleForMatch must fold"
  );

  // The provider-side matcher shares the same helper rather than keeping its
  // own copy, which is how the two drifted apart in the first place.
  const player = readSource("src", "services", "WebPlayerService.ts");
  assert.equal(player.includes("foldNonDecomposingLetters"), true);
  assert.equal(player.includes('value.replace(/ı/g, "i").replace(/İ/g, "i")'), false);
});
