import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const rootPath = path.resolve(process.cwd());

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(rootPath, ...segments), "utf8");
}

function readNumericConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = (\\d+)`));
  assert.ok(match, `${name} must be declared as a numeric constant`);
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Stats' "most watched actors" counted from the cast list stored on each watch
// history entry, and that list was the top FIVE billed names. Ensembles broke
// it completely: Cate Blanchett is credited 13th on The Fellowship of the Ring,
// so the trilogy never counted towards her and never appeared in the list you
// get by tapping her row — the two ends of the same truncation.
// ---------------------------------------------------------------------------

/** Cate Blanchett's billing position on TMDB for The Fellowship of the Ring. */
const ENSEMBLE_LEAD_BILLING_INDEX = 12;

test("a watch-history entry remembers enough cast to cover an ensemble lead", () => {
  const source = readSource("src", "hooks", "useWatchHistory.ts");
  const limit = readNumericConstant(source, "WATCH_ENTRY_CAST_LIMIT");

  assert.ok(
    limit > ENSEMBLE_LEAD_BILLING_INDEX,
    `top-${limit} billing cannot reach a lead credited at index ${ENSEMBLE_LEAD_BILLING_INDEX}`
  );
  assert.equal(source.includes("cast.slice(0, 5)"), false, "the top-5 truncation must not come back");
});

test("the TMDB details fetch supplies at least as much cast as an entry stores", () => {
  // The entry can only remember what the details call returned, so a details
  // limit below the entry limit silently re-introduces the truncation.
  const tmdb = readSource("src", "api", "tmdb.ts");
  const hook = readSource("src", "hooks", "useWatchHistory.ts");

  const detailsLimit = readNumericConstant(tmdb, "DETAILS_CAST_LIMIT");
  const entryLimit = readNumericConstant(hook, "WATCH_ENTRY_CAST_LIMIT");

  assert.ok(
    detailsLimit >= entryLimit,
    `details fetch keeps ${detailsLimit} cast members but an entry wants ${entryLimit}`
  );
  assert.ok(detailsLimit > ENSEMBLE_LEAD_BILLING_INDEX);
  assert.equal(tmdb.includes(".slice(0, 12)\n    .map(normalizeCastMember)"), false);
});

test("the metadata version was bumped so existing entries are re-enriched", () => {
  // Without a bump, every title logged before the change keeps its top-5 cast
  // and the Stats counts stay wrong for the titles that motivated the fix.
  const source = readSource("src", "hooks", "useWatchHistory.ts");
  assert.ok(readNumericConstant(source, "METADATA_VERSION") >= 6);
  assert.ok(
    source.includes("entry.metadataVersion < METADATA_VERSION"),
    "legacy entries must still be detected by version"
  );
});

test("a cloud row cut short by the table's cast cap is re-enriched instead of trusted", () => {
  // user_watch_history holds five billed names. A synced device used to take a
  // full row's metadata version at face value, so its titles kept five names
  // forever and Stats never saw an ensemble lead billed below them.
  const rows = readSource("src", "utils", "watchHistoryRows.ts");
  const sync = readSource("src", "services", "userDataSync.ts");

  assert.equal(readNumericConstant(rows, "WATCH_HISTORY_REMOTE_CAST_LIMIT"), 5);
  assert.match(
    sync,
    /coerceNumberArray\(e\.castIds\)\.length >= WATCH_HISTORY_REMOTE_CAST_LIMIT\s*\?\s*1/,
    "a full remote cast list must come back below the current metadata version"
  );
});

test("the TMDB details fetch keeps one slot per person", () => {
  const tmdb = readSource("src", "api", "tmdb.ts");
  assert.match(tmdb, /function selectBilledCast[\s\S]{0,900}?new Map<number/);
  assert.match(tmdb, /cast: selectBilledCast\(data\.credits\?\.cast\)/);
});

test("a cast list never credits the same person twice", () => {
  // TMDB lists an actor once per credited role. Storing both wasted one of the
  // few slots available AND made the Stats tally exceed the number of titles it
  // was meant to summarise.
  const hook = readSource("src", "hooks", "useWatchHistory.ts");
  assert.match(hook, /function topCast[\s\S]{0,600}?new Set<number>\(\)/);

  // The counter guards the same invariant for entries stored before the fix.
  const topActors = readSource("src", "components", "stats", "TopActors.tsx");
  assert.match(topActors, /countedInEntry/);
  assert.match(topActors, /if \(countedInEntry\.has\(id\)\) continue;/);
});

test("tapping an actor filters the same history the count was taken from", () => {
  // The count and the drill-down list must read the same field, or the number
  // will not match the grid it opens.
  const topActors = readSource("src", "components", "stats", "TopActors.tsx");
  const grid = readSource("src", "screens", "WatchedGridScreen.tsx");

  assert.match(topActors, /entry\.castIds/);
  assert.match(grid, /e\.castIds\.includes\(actorId\)/);
});
