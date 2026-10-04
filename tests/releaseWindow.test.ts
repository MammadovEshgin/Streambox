import assert from "node:assert/strict";
import test from "node:test";

import { isPastCinemaWindow, readReleaseWindow } from "../src/api/releaseWindow";

const NOW = new Date("2026-10-05T12:00:00Z");

function releases(...entries: Array<[country: string, type: number, date: string]>) {
  return {
    results: entries.map(([iso, type, date]) => ({
      iso_3166_1: iso,
      release_dates: [{ type, release_date: `${date}T00:00:00.000Z` }],
    })),
  };
}

test("readReleaseWindow takes the earliest cinema and home dates across countries", () => {
  const window = readReleaseWindow(
    releases(["US", 3, "2026-07-15"], ["TR", 3, "2026-07-10"], ["US", 4, "2026-11-15"], ["DE", 5, "2026-11-01"], ["FR", 1, "2026-06-01"])
  );
  assert.deepEqual(window, { theatrical: "2026-07-10", home: "2026-11-01", listed: true });
});

test("a cinema film with no home release is hidden for 90 days", () => {
  // Digger and Resident Evil (2026): in cinemas, on no provider.
  assert.equal(isPastCinemaWindow(readReleaseWindow(releases(["US", 3, "2026-09-30"])), NOW), false);
  assert.equal(isPastCinemaWindow(readReleaseWindow(releases(["US", 3, "2026-07-06"])), NOW), true);
});

test("a cinema film shows once its digital release is out, before 90 days pass", () => {
  // Coyote vs. Acme: cinemas 2026-08-20, digital 2026-09-29, on the providers on 2026-10-05.
  const window = readReleaseWindow(releases(["US", 3, "2026-08-20"], ["US", 4, "2026-09-29"]));
  assert.equal(isPastCinemaWindow(window, NOW), true);
});

test("a scheduled digital date in the future does not show the film early", () => {
  // Verity: cinemas 2026-09-30, digital 2026-10-27, on no provider on 2026-10-05.
  const window = readReleaseWindow(releases(["US", 3, "2026-09-30"], ["US", 4, "2026-10-27"]));
  assert.equal(isPastCinemaWindow(window, NOW), false);
});

test("a streaming premiere shows from its release day, and not before", () => {
  assert.equal(isPastCinemaWindow(readReleaseWindow(releases(["US", 4, "2026-10-02"])), NOW), true);
  assert.equal(isPastCinemaWindow(readReleaseWindow(releases(["US", 4, "2026-10-20"])), NOW), false);
});

test("festival-only films are hidden; films TMDB has no dates for are kept", () => {
  assert.equal(isPastCinemaWindow(readReleaseWindow(releases(["FR", 1, "2026-05-20"])), NOW), false);
  assert.equal(isPastCinemaWindow(readReleaseWindow({ results: [] }), NOW), true);
});
