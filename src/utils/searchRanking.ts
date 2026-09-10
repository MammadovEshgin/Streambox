/**
 * Pure ranking helpers for TMDB multi-search.
 *
 * Extracted from the TMDB client so the "typed the name and it isn't there"
 * class of bug is unit-testable without pulling in axios, i18next or the whole
 * ~3k-line client. Everything here is a pure function of the query and the
 * records TMDB returned.
 */

import { foldForTitleCompare } from "./textFolding";

export type RankableTitle = {
  title: string;
  originalTitle?: string;
  rating: number;
};

export type RankablePerson = {
  name: string;
  known_for_department?: string | null;
  popularity?: number;
  profile_path?: string | null;
};

export function normalizeSearchTerm(value: string): string {
  // foldForTitleCompare folds letters NFD cannot decompose BEFORE the non-ASCII
  // strip. Without that, Turkish dotless i becomes a space — "Mezarlık"
  // normalised to "mezarl k" and no amount of correct spelling would match it.
  return foldForTitleCompare(value.trim());
}

/**
 * Quality floor for search results that do NOT match the typed query — the
 * incidental hits TMDB returns alongside the real one. Only applied when the
 * list already contains a title the viewer plainly named; see
 * `filterSearchCandidates`.
 */
export const SEARCH_WEAK_MATCH_MIN_RATING = 6;

/**
 * TMDB's person index contains thousands of near-empty records — crew, one-line
 * extras, duplicates — and some of them are named after famous FILMS.
 * `/search/person?query=harry potter` returns a real acting credit literally
 * named "Harry Potter": popularity 0.28, no photo, one television credit.
 *
 * Name matching alone therefore cannot decide whether the viewer meant a person
 * or a title. That stranger scored a perfect 1000 and hijacked the search, so
 * typing "harry potter" answered with their single credit and not one of the
 * films. (Typing just "harry" worked, because a one-word query cannot reach the
 * confidence needed to override a title match.)
 *
 * Prominence is the missing signal: someone a viewer could plausibly be
 * searching for has a profile photo and a non-trivial popularity score. Only a
 * prominent person may outrank a title that matches the query; a non-prominent
 * one is still used when no title matched at all, which keeps genuinely obscure
 * actors searchable.
 */
export const ACTOR_SEARCH_MIN_POPULARITY = 1;

export function isProminentActorSearchMatch(person: RankablePerson): boolean {
  return Boolean(person.profile_path) && (person.popularity ?? 0) >= ACTOR_SEARCH_MIN_POPULARITY;
}

function isConfidentActorSearchMatch(
  query: string,
  person: RankablePerson | undefined
): person is RankablePerson {
  if (!person || person.known_for_department !== "Acting") {
    return false;
  }

  const normalizedQuery = normalizeSearchTerm(query);
  const normalizedName = normalizeSearchTerm(person.name);
  if (normalizedQuery.length < 3 || normalizedName.length === 0) {
    return false;
  }

  return (
    normalizedName === normalizedQuery ||
    normalizedName.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedName)
  );
}

export function getActorSearchConfidence(query: string, person: RankablePerson | undefined): number {
  if (!isConfidentActorSearchMatch(query, person)) {
    return 0;
  }

  const normalizedQuery = normalizeSearchTerm(query);
  const normalizedName = normalizeSearchTerm(person.name);
  const queryTokenCount = normalizedQuery.split(" ").filter(Boolean).length;
  const nameTokenCount = normalizedName.split(" ").filter(Boolean).length;

  if (normalizedName === normalizedQuery) {
    return nameTokenCount >= 2 ? 1000 : 880;
  }

  if (normalizedQuery.startsWith(normalizedName) && nameTokenCount >= 2) {
    return 940;
  }

  if (normalizedName.startsWith(normalizedQuery) && normalizedQuery.length >= 4) {
    return queryTokenCount >= 2 ? 900 : 760;
  }

  return 0;
}

/**
 * Best name match among the acting people TMDB returned, ranked by confidence
 * first and popularity second.
 *
 * The old code took the single most POPULAR acting result and only then asked
 * whether it matched the query. That discarded a lower-billed exact match
 * sitting under a more popular partial one, and it settled on index noise
 * whenever the noise was the only acting row.
 */
export function pickActorSearchMatch<T extends RankablePerson>(
  query: string,
  people: T[]
): { person: T; confidence: number } | null {
  let best: { person: T; confidence: number } | null = null;

  for (const person of people) {
    if (person.known_for_department !== "Acting") continue;
    const confidence = getActorSearchConfidence(query, person);
    if (confidence <= 0) continue;

    if (
      !best
      || confidence > best.confidence
      || (confidence === best.confidence && (person.popularity ?? 0) > (best.person.popularity ?? 0))
    ) {
      best = { person, confidence };
    }
  }

  return best;
}

export function getSearchTitleScore(query: string, item: RankableTitle): number {
  const normalizedQuery = normalizeSearchTerm(query);
  if (!normalizedQuery) return 0;

  const normalizedTitle = normalizeSearchTerm(item.title);
  const normalizedOriginalTitle = normalizeSearchTerm(item.originalTitle ?? "");
  const titleCandidates = [normalizedTitle, normalizedOriginalTitle].filter(Boolean);

  if (titleCandidates.some((title) => title === normalizedQuery)) {
    return 1000;
  }

  if (titleCandidates.some((title) => title.startsWith(`${normalizedQuery} `))) {
    return 820;
  }

  // A whole-word match anywhere in the title, INCLUDING at the end. The
  // trailing-space test alone missed every title that ends with the query,
  // which is the usual shape of a localized subtitle: "Harry Potter ve Sırlar
  // Odası" scored below a bare token match for the words that name the film.
  if (
    titleCandidates.some(
      (title) => title.includes(` ${normalizedQuery} `) || title.endsWith(` ${normalizedQuery}`)
    )
  ) {
    return 620;
  }

  if (titleCandidates.some((title) => title.startsWith(normalizedQuery))) {
    return 520;
  }

  // Every word of the query appears in the title, in any order. This is what
  // rescues a cross-language search: with the UI in English, TMDB answers a
  // Turkish query with the ENGLISH title, so none of the tiers above can fire
  // even though TMDB matched the film on its Turkish translation. Scoring it
  // above zero is what keeps it out of the weak-match quality gate.
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length > 1) {
    const covered = titleCandidates.some((title) => {
      const titleTokens = new Set(title.split(" ").filter(Boolean));
      return queryTokens.every((token) => titleTokens.has(token));
    });
    if (covered) {
      return 420;
    }
  }

  return 0;
}

export function hasConfidentTitleSearchMatch(query: string, items: RankableTitle[]): boolean {
  return items.some((item) => getSearchTitleScore(query, item) >= 820);
}

export function getBestTitleSearchScore(query: string, items: RankableTitle[]): number {
  return items.reduce((best, item) => Math.max(best, getSearchTitleScore(query, item)), 0);
}

export function rankTitleSearchResults<T extends RankableTitle>(query: string, items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, titleScore: getSearchTitleScore(query, item) }))
    .sort((left, right) => {
      if (left.titleScore !== right.titleScore) {
        return right.titleScore - left.titleScore;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * Apply the quality floor ONLY when the list already contains a title the
 * viewer plainly named.
 *
 * TMDB reports rating 0 for anything short of a vote threshold, so an
 * unconditional floor silently deleted new releases, niche titles, and every
 * result whose only match was a translated title the caller cannot see —
 * including films the providers can happily play. When nothing scores, whatever
 * TMDB returned IS the answer, and the floor would be deleting the only
 * candidates there are.
 */
export function filterSearchCandidates<T extends RankableTitle>(query: string, candidates: T[]): T[] {
  const hasNamedTitle = candidates.some((item) => getSearchTitleScore(query, item) > 0);
  if (!hasNamedTitle) {
    return candidates;
  }

  return candidates.filter(
    (item) => getSearchTitleScore(query, item) > 0 || item.rating >= SEARCH_WEAK_MATCH_MIN_RATING
  );
}

export type ActorCreditsDecisionInput = {
  query: string;
  page: number;
  /** Null when TMDB matched nobody confidently. */
  actor: { confidence: number; prominent: boolean; creditCount: number } | null;
  rankedTitles: RankableTitle[];
};

/**
 * Whether a search for `query` should answer with an actor's filmography
 * instead of the matching titles.
 *
 * Titles win unless the person is someone a viewer could plausibly have meant.
 * `prominent` is what stops TMDB's person-index noise from replacing the Harry
 * Potter films with the filmography of an unrelated stranger of the same name.
 */
export function shouldAnswerWithActorCredits({
  query,
  page,
  actor,
  rankedTitles,
}: ActorCreditsDecisionInput): boolean {
  if (!actor || actor.creditCount === 0) {
    return false;
  }

  if (rankedTitles.length === 0) {
    return true;
  }

  const bestTitleScore = getBestTitleSearchScore(query, rankedTitles);

  if (page === 1 && actor.prominent && actor.confidence >= 880 && bestTitleScore < 1000) {
    return true;
  }

  return page === 1 && actor.confidence >= 880 && !hasConfidentTitleSearchMatch(query, rankedTitles);
}
