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

test("the cloud keeps the whole cast an entry holds", () => {
  // The table held five billed names while entries kept 20, so every upload was
  // truncated and a device hydrating from the cloud was back to five per title
  // — Stats lost ensemble leads again until a full local refetch happened to
  // finish. The cap and the entry limit must stay equal.
  const rows = readSource("src", "utils", "watchHistoryRows.ts");
  const hook = readSource("src", "hooks", "useWatchHistory.ts");
  const migrations = fs
    .readdirSync(path.join(rootPath, "supabase", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => fs.readFileSync(path.join(rootPath, "supabase", "migrations", name), "utf8"));

  const remoteLimit = readNumericConstant(rows, "WATCH_HISTORY_REMOTE_CAST_LIMIT");
  assert.equal(remoteLimit, readNumericConstant(hook, "WATCH_ENTRY_CAST_LIMIT"));
  assert.ok(remoteLimit > ENSEMBLE_LEAD_BILLING_INDEX);

  // …and the database has to allow it, or every upsert fails the CHECK.
  const constraint = [...migrations]
    .reverse()
    .map((sql) => sql.match(/user_watch_history_cast_ids_check check \(cardinality\(cast_ids\) <= (\d+)\)/i))
    .find(Boolean);
  assert.ok(constraint, "a migration must define the cast_ids cap");
  assert.ok(
    Number(constraint![1]) >= remoteLimit,
    `table caps cast at ${constraint![1]} but uploads send ${remoteLimit}`
  );
});

test("rows uploaded before the deep-cast sync are re-enriched instead of trusted", () => {
  // A row written by an older client is five names deep whatever version it
  // claims, so its version must not be taken at face value.
  const sync = readSource("src", "services", "userDataSync.ts");
  assert.match(
    sync,
    /\(e\.metadataVersion \|\| 1\) < WATCH_HISTORY_CAST_SYNC_VERSION\s*\?\s*1/,
    "a pre-cutover remote row must come back below the current metadata version"
  );
  const hook = readSource("src", "hooks", "useWatchHistory.ts");
  const rows = readSource("src", "utils", "watchHistoryRows.ts");
  assert.equal(
    readNumericConstant(hook, "METADATA_VERSION"),
    readNumericConstant(rows, "WATCH_HISTORY_CAST_SYNC_VERSION"),
    "entries must be stamped with the version the sync layer trusts"
  );
  // Deep local entries upgrade without re-downloading the whole history.
  assert.match(hook, /entry\.castIds\.length >= WATCH_ENTRY_CAST_LIMIT/);
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
