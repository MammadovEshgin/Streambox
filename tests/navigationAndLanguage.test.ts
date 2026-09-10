import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// Back from a detail screen must return to where you came from.
//
// React Navigation's `navigate(name)` does NOT push when a route of that name
// is already in the stack — it pops back to the existing instance and destroys
// everything above it. Opening an actor, tapping See All, and opening a film
// from that grid therefore collapsed the stack back onto the MovieDetail the
// journey started from, and one more Back landed on Discover instead of the
// actor page. `push` always adds a new screen, so Back unwinds step by step.
// ---------------------------------------------------------------------------

/**
 * Screens that can be reached FROM a detail screen, and so can be asked to open
 * a route that is already somewhere below them in the stack.
 */
const NESTED_SCREENS = [
  "ActorDetailScreen",
  "AzClassicsGridScreen",
  "DiscoverGridScreen",
  "FranchiseTimelineScreen",
  "MovieDetailScreen",
  "ProfileScreen",
  "ProfileSeeAllScreen",
  "SearchResultsScreen",
  "SeriesDetailScreen",
  "StatsScreen",
  "WatchedGridScreen",
];

/** Routes that can legitimately appear more than once in one stack. */
const REPEATABLE_ROUTES = [
  "MovieDetail",
  "SeriesDetail",
  "ActorDetail",
  "AzClassicDetail",
  "DiscoverGrid",
  "WatchedGrid",
  "ProfileSeeAll",
];

for (const screen of NESTED_SCREENS) {
  test(`${screen} pushes repeatable routes instead of collapsing the stack`, () => {
    const source = readSource("src", "screens", `${screen}.tsx`);

    for (const route of REPEATABLE_ROUTES) {
      assert.equal(
        source.includes(`navigation.navigate("${route}"`),
        false,
        `${screen} must use navigation.push("${route}") — navigate() pops back to an existing instance`
      );
    }
  });
}

test("the actor page's See All pushes its grid", () => {
  // The reported path: actor → See All → a film → Back landed on Discover.
  const source = readSource("src", "screens", "ActorDetailScreen.tsx");
  assert.match(source, /navigation\.push\("DiscoverGrid"/);
});

test("stack roots may still use navigate — nothing sits below them", () => {
  // Guard against an over-eager sweep turning the tab roots into push()
  // machines, which would let Back walk through duplicate feeds.
  for (const root of ["HomeScreen", "MoviesScreen", "SeriesScreen"]) {
    const source = readSource("src", "screens", `${root}.tsx`);
    assert.match(source, /navigation\.navigate\("(MovieDetail|SeriesDetail|DiscoverGrid)"/);
  }
});

// ---------------------------------------------------------------------------
// Switching language must not resolve content in the language just left.
//
// i18next.changeLanguage is async. The settings store is not, so for a render
// or two after a switch `i18n.resolvedLanguage` still reported the OLD value.
// Anything that read the language from i18next in that window fetched and
// cached under the wrong key: posters stayed Turkish under an English UI, and
// every switch was followed by a stretch of duplicated loading.
// ---------------------------------------------------------------------------

test("content requests and cache keys read the synchronous content language", () => {
  const contentLanguage = readSource("src", "localization", "contentLanguage.ts");
  assert.match(contentLanguage, /export function setActiveContentLanguage/);
  assert.match(contentLanguage, /export function getActiveContentLanguage/);

  const tmdb = readSource("src", "api", "tmdb.ts");
  assert.match(tmdb, /getLanguageLocale\(getActiveContentLanguage\(\)\)/);
  assert.equal(
    tmdb.includes("i18n.resolvedLanguage"),
    false,
    "the TMDB client must not read the language from i18next"
  );

  const hydration = readSource("src", "services", "mediaHydration.ts");
  assert.match(hydration, /return getActiveContentLanguage\(\);/);
  assert.equal(hydration.includes("i18n.resolvedLanguage"), false);

  const movieOfDay = readSource("src", "services", "movieOfDayService.ts");
  assert.equal(movieOfDay.includes("i18n.resolvedLanguage"), false);
});

test("the settings store publishes the language before it re-renders", () => {
  const settings = readSource("src", "settings", "AppSettingsContext.tsx");
  // Both the persist path and the boot hydrate path must publish, and each must
  // do so BEFORE the setSettings that re-renders every screen.
  const publishBeforeRender = /setActiveContentLanguage\((next|fallback)\.language\);\s*[\r\n]+\s*setSettings\(\1\);/g;
  assert.equal(
    (settings.match(publishBeforeRender) ?? []).length,
    3,
    "persist + both hydrate branches must publish the language before setSettings"
  );
});

test("screens key their content cache off settings, not i18next", () => {
  for (const screen of ["ProfileScreen", "ProfileSeeAllScreen", "StatsScreen", "WatchedGridScreen"]) {
    const source = readSource("src", "screens", `${screen}.tsx`);
    assert.equal(
      source.includes("translationI18n.resolvedLanguage"),
      false,
      `${screen} must not derive its cache key from i18next's lagging value`
    );
    assert.match(source, /resolvedContentLanguage/);
  }
});
