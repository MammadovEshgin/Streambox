import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSearchCandidates,
  getActorSearchConfidence,
  getSearchTitleScore,
  isProminentActorSearchMatch,
  pickActorSearchMatch,
  rankTitleSearchResults,
  shouldAnswerWithActorCredits,
  type RankablePerson,
  type RankableTitle,
} from "../src/utils/searchRanking";

// ---------------------------------------------------------------------------
// Fixtures taken verbatim from live TMDB responses (2026-09-11).
// ---------------------------------------------------------------------------

/**
 * `/search/person?query=harry potter` really returns this. Two rows, one of
 * them an acting credit whose name is EXACTLY the film franchise: no photo,
 * popularity 0.28, one television credit to its name.
 */
const HARRY_POTTER_PEOPLE: RankablePerson[] = [
  { name: "Harry Potter", known_for_department: "Crew", popularity: 0.2786, profile_path: null },
  { name: "Harry Potter", known_for_department: "Acting", popularity: 0.2761, profile_path: null },
];

const TOM_HANKS_PEOPLE: RankablePerson[] = [
  { name: "Tom Hanks", known_for_department: "Acting", popularity: 15.6846, profile_path: "/xndWFsBlClOJFRdhSt4NBwiPq2o.jpg" },
];

/** `/search/multi?query=harry potter` — the films are all there. */
const HARRY_POTTER_TITLES: RankableTitle[] = [
  { title: "Harry Potter", rating: 0 },
  { title: "Harry Potter and the Chamber of Secrets", rating: 7.707 },
  { title: "Harry Potter and the Prisoner of Azkaban", rating: 8.011 },
  { title: "Harry Potter and the Goblet of Fire", rating: 7.802 },
  { title: "Harry Potter and the Philosopher's Stone", rating: 7.903 },
];

/** The same search with the UI in Turkish: localized titles, English originals. */
const HARRY_POTTER_TITLES_TR: RankableTitle[] = [
  { title: "Harry Potter ve Sırlar Odası", originalTitle: "Harry Potter and the Chamber of Secrets", rating: 7.7 },
  { title: "Harry Potter ve Azkaban Tutsağı", originalTitle: "Harry Potter and the Prisoner of Azkaban", rating: 8.011 },
  { title: "Harry Potter ve Felsefe Taşı", originalTitle: "Harry Potter and the Philosopher's Stone", rating: 7.903 },
];

/** `/search/multi?query=tom hanks` — documentaries ABOUT him, not by title. */
const TOM_HANKS_TITLES: RankableTitle[] = [
  { title: "World War II with Tom Hanks", rating: 8 },
  { title: "Tom Hanks: The Nomad", rating: 5.5 },
  { title: "The Moonwalkers: A Journey with Tom Hanks", rating: 8 },
];

// ---------------------------------------------------------------------------
// The reported bug: "harry" finds the films, "harry potter" finds nothing.
// ---------------------------------------------------------------------------

test("searching a film by its full name answers with the films, not a same-named stranger", () => {
  const match = pickActorSearchMatch("harry potter", HARRY_POTTER_PEOPLE);

  // The name match itself is real and maximal — that is exactly why name
  // matching alone could not be trusted to make this decision.
  assert.ok(match);
  assert.equal(match.confidence, 1000);
  assert.equal(isProminentActorSearchMatch(match.person), false);

  const ranked = rankTitleSearchResults("harry potter", HARRY_POTTER_TITLES);
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "harry potter",
      page: 1,
      actor: { confidence: match.confidence, prominent: false, creditCount: 1 },
      rankedTitles: ranked,
    }),
    false,
    "a person with no photo and popularity 0.28 must not outrank the films"
  );
});

test("the same query under a Turkish UI behaves identically", () => {
  const ranked = rankTitleSearchResults("harry potter", HARRY_POTTER_TITLES_TR);

  assert.equal(
    shouldAnswerWithActorCredits({
      query: "harry potter",
      page: 1,
      actor: { confidence: 1000, prominent: false, creditCount: 1 },
      rankedTitles: ranked,
    }),
    false
  );
  assert.equal(ranked[0].title, "Harry Potter ve Sırlar Odası");
});

test("a single-word query still finds the films (this half never broke)", () => {
  const ranked = rankTitleSearchResults("harry", HARRY_POTTER_TITLES);
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "harry",
      page: 1,
      actor: { confidence: 760, prominent: true, creditCount: 30 },
      rankedTitles: ranked,
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// …without breaking actor search, which is what the override exists for.
// ---------------------------------------------------------------------------

test("searching a real actor by name still answers with their filmography", () => {
  const match = pickActorSearchMatch("tom hanks", TOM_HANKS_PEOPLE);
  assert.ok(match);
  assert.equal(match.confidence, 1000);
  assert.equal(isProminentActorSearchMatch(match.person), true);

  // TMDB returns documentaries whose titles START with his name, so this is a
  // case where a prominent person has to beat an 820-scoring title.
  assert.equal(getSearchTitleScore("tom hanks", TOM_HANKS_TITLES[1]), 820);
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "tom hanks",
      page: 1,
      actor: { confidence: match.confidence, prominent: true, creditCount: 90 },
      rankedTitles: rankTitleSearchResults("tom hanks", TOM_HANKS_TITLES),
    }),
    true
  );
});

test("an actor whose name matches nothing in the title list still wins", () => {
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "cate blanchett",
      page: 1,
      actor: { confidence: 1000, prominent: true, creditCount: 80 },
      rankedTitles: [],
    }),
    true
  );
});

test("a film titled exactly after a person keeps the film", () => {
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "tom hanks",
      page: 1,
      actor: { confidence: 1000, prominent: true, creditCount: 90 },
      rankedTitles: [{ title: "Tom Hanks", rating: 6.4 }],
    }),
    false,
    "an exact title match (1000) outranks even a prominent person"
  );
});

test("actor credits never take over a later page of title results", () => {
  assert.equal(
    shouldAnswerWithActorCredits({
      query: "tom hanks",
      page: 2,
      actor: { confidence: 1000, prominent: true, creditCount: 90 },
      rankedTitles: rankTitleSearchResults("tom hanks", TOM_HANKS_TITLES),
    }),
    false
  );
});

test("the best name match wins even when a more popular partial match sits above it", () => {
  // The old code took the most popular ACTING row and only then asked whether
  // it matched, so an exact match below a popular partial one was discarded.
  const people: RankablePerson[] = [
    { name: "Chris Evans Jr", known_for_department: "Acting", popularity: 40, profile_path: "/a.jpg" },
    { name: "Chris Evans", known_for_department: "Acting", popularity: 12, profile_path: "/b.jpg" },
  ];
  const match = pickActorSearchMatch("chris evans", people);
  assert.equal(match?.person.name, "Chris Evans");
  assert.equal(match?.confidence, 1000);
});

test("crew records are never treated as actor matches", () => {
  const crewOnly: RankablePerson[] = [
    { name: "Harry Potter", known_for_department: "Crew", popularity: 9, profile_path: "/a.jpg" },
  ];
  assert.equal(pickActorSearchMatch("harry potter", crewOnly), null);
  assert.equal(getActorSearchConfidence("harry potter", crewOnly[0]), 0);
});

// ---------------------------------------------------------------------------
// The quality floor must not delete the only results there are.
// ---------------------------------------------------------------------------

test("a cross-language query keeps the film TMDB matched on its translation", () => {
  // UI in English, query in Turkish: TMDB matched the alternative title but
  // hands back the ENGLISH one, so nothing scores. The unconditional rating
  // floor used to delete anything under 6 here — including titles the
  // providers can play.
  const candidates: RankableTitle[] = [
    { title: "Rosemary's Baby", rating: 7.8 },
    { title: "Some Obscure Turkish Drama", rating: 0 },
  ];
  assert.equal(getSearchTitleScore("Rosemary'nin Bebeği", candidates[0]), 0);
  assert.deepEqual(filterSearchCandidates("Rosemary'nin Bebeği", candidates), candidates);
});

test("the floor still prunes incidental junk once a real match is present", () => {
  const candidates: RankableTitle[] = [
    { title: "Inception", rating: 8.4 },
    { title: "Some Unrelated Cheapie", rating: 2.1 },
    { title: "A Well-Regarded Bystander", rating: 7.4 },
  ];
  const kept = filterSearchCandidates("inception", candidates).map((item) => item.title);
  assert.deepEqual(kept, ["Inception", "A Well-Regarded Bystander"]);
});

test("an unrated title the viewer named by name is never pruned", () => {
  const candidates: RankableTitle[] = [
    { title: "Inception", rating: 8.4 },
    { title: "Inception: The Cobol Job", rating: 0 },
  ];
  assert.equal(filterSearchCandidates("inception", candidates).length, 2);
});

test("token coverage scores a match the prefix tiers cannot see", () => {
  // "potter deathly hallows" — every word present, none of them a prefix.
  const item: RankableTitle = { title: "Harry Potter and the Deathly Hallows: Part 2", rating: 8 };
  assert.equal(getSearchTitleScore("potter deathly hallows", item), 420);
  // Words that ARE contiguous in the title keep their higher, existing tier.
  assert.equal(getSearchTitleScore("deathly hallows", item), 620);
});

test("title ranking puts the exact match first", () => {
  const ranked = rankTitleSearchResults("harry potter", HARRY_POTTER_TITLES);
  assert.equal(ranked[0].title, "Harry Potter");
  assert.equal(getSearchTitleScore("harry potter", ranked[1]), 820);
});

test("Turkish spelling still folds so it can be typed either way", () => {
  const item: RankableTitle = { title: "Harry Potter ve Sırlar Odası", rating: 7.7 };
  // The words that actually name the film sit at the END of the title, which
  // the whole-word tier used to miss entirely.
  assert.equal(getSearchTitleScore("sirlar odasi", item), 620);
  assert.equal(getSearchTitleScore("Sırlar Odası", item), 620);
  assert.equal(
    getSearchTitleScore("sirlar odasi", item),
    getSearchTitleScore("Sırlar Odası", item)
  );
});
