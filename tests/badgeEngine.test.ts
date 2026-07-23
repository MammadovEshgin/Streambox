import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateBadges, selectStripBadgeIds, type BadgeHistoryEntry } from "../src/services/badgeEngine";

let nextId = 1;

function movie(overrides: Partial<BadgeHistoryEntry> = {}): BadgeHistoryEntry {
  return {
    id: nextId++,
    mediaType: "movie",
    historyKind: "title",
    genres: [],
    year: "2015",
    watchPrecision: "day",
    watchedAt: Date.UTC(2026, 4, 10, 12),
    ...overrides,
  };
}

function getStatus(entries: BadgeHistoryEntry[], id: string) {
  const status = evaluateBadges(entries).find((item) => item.id === id);
  assert.ok(status, `missing badge status: ${id}`);
  return status;
}

describe("badgeEngine", () => {
  it("counts watched movies for the milestone ladder (titles only, movies only)", () => {
    const entries = [
      ...Array.from({ length: 10 }, () => movie()),
      movie({ mediaType: "tv" }),
      movie({ historyKind: "season", mediaType: "tv" }),
    ];
    assert.equal(getStatus(entries, "rookie").earned, true);
    assert.equal(getStatus(entries, "rookie").current, 10);
    assert.equal(getStatus(entries, "regular").earned, false);
  });

  it("genre badges match localized genre names (en + tr)", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => movie({ genres: ["Horror"] })),
      ...Array.from({ length: 5 }, () => movie({ genres: ["Korku", "Gerilim"] })),
    ];
    const status = getStatus(entries, "fearCollector");
    assert.equal(status.current, 10);
    assert.equal(status.earned, true);
  });

  it("crime and mystery share one bucket", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => movie({ genres: ["Crime"] })),
      ...Array.from({ length: 5 }, () => movie({ genres: ["Gizem"] })),
    ];
    assert.equal(getStatus(entries, "caseClosed").earned, true);
  });

  it("marathon day needs 3 day-precision logs on the same calendar day", () => {
    const sameDay = Date.UTC(2026, 2, 14, 15);
    const earned = [
      movie({ watchedAt: sameDay }),
      movie({ watchedAt: sameDay + 60_000 }),
      movie({ watchedAt: sameDay + 120_000 }),
    ];
    assert.equal(getStatus(earned, "marathonDay").earned, true);

    // Month-precision imports collapse onto one date and must NOT count.
    const imported = [
      movie({ watchedAt: sameDay, watchPrecision: "month" }),
      movie({ watchedAt: sameDay, watchPrecision: "month" }),
      movie({ watchedAt: sameDay, watchPrecision: "month" }),
    ];
    assert.equal(getStatus(imported, "marathonDay").earned, false);
  });

  it("time traveler counts distinct decades; old soul counts pre-1980 films", () => {
    const entries = [
      movie({ year: "1955" }),
      movie({ year: "1968" }),
      movie({ year: "1979" }),
      movie({ year: "1985" }),
      movie({ year: "1999" }),
      movie({ year: "2010" }),
    ];
    assert.equal(getStatus(entries, "timeTraveler").earned, true);
    assert.equal(getStatus(entries, "oldSoul").current, 3);
  });

  it("director's circle tracks the most-watched director", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => movie({ directorIds: [525] })),
      movie({ directorIds: [1032] }),
    ];
    const status = getStatus(entries, "directorsCircle");
    assert.equal(status.current, 5);
    assert.equal(status.earned, true);
  });

  it("season slayer never double counts whole-show and per-season logs", () => {
    const entries: BadgeHistoryEntry[] = [
      // Whole show logged with 62 episodes...
      movie({ mediaType: "tv", historyKind: "title", sourceTmdbId: 1396, episodeCount: 62 }),
      // ...and two seasons of the SAME show logged separately.
      movie({ mediaType: "tv", historyKind: "season", sourceTmdbId: 1396, episodeCount: 7 }),
      movie({ mediaType: "tv", historyKind: "season", sourceTmdbId: 1396, episodeCount: 13 }),
      // A different show tracked only by seasons.
      movie({ mediaType: "tv", historyKind: "season", sourceTmdbId: 66732, episodeCount: 8 }),
    ];
    assert.equal(getStatus(entries, "seasonSlayer").current, 70);
  });

  it("october rites counts horror watched in October only", () => {
    const october = Date.UTC(2025, 9, 20, 12);
    const entries = [
      ...Array.from({ length: 5 }, () => movie({ genres: ["Korku"], watchedAt: october })),
      movie({ genres: ["Horror"], watchedAt: Date.UTC(2025, 6, 20, 12) }),
      movie({ genres: ["Horror"], watchedAt: october, watchPrecision: "none" }),
    ];
    assert.equal(getStatus(entries, "octoberRites").current, 5);
    assert.equal(getStatus(entries, "octoberRites").earned, true);
  });

  it("hundred hours sums runtime minutes across all history entries", () => {
    const entries = [
      ...Array.from({ length: 50 }, () => movie({ runtimeMinutes: 120 })),
      movie({ mediaType: "tv", historyKind: "season", runtimeMinutes: 45 }),
    ];
    const status = getStatus(entries, "hundredHours");
    assert.equal(status.current, 6045);
    assert.equal(status.earned, true);
  });

  it("the strip shows only the highest earned ladder tier plus other earned badges", () => {
    const entries = [
      ...Array.from({ length: 30 }, () => movie()),
      ...Array.from({ length: 10 }, () => movie({ genres: ["Comedy"] })),
    ];
    const strip = selectStripBadgeIds(evaluateBadges(entries));
    assert.equal(strip[0], "regular");
    assert.ok(strip.includes("laughTrack"));
    assert.ok(!strip.includes("rookie"));
    assert.ok(!strip.includes("firstReel"));
  });

  it("empty history earns nothing", () => {
    const progress = evaluateBadges([]);
    assert.ok(progress.every((status) => !status.earned));
    assert.deepEqual(selectStripBadgeIds(progress), []);
  });
});
