import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAzClassicDisplayTitle,
  getAzClassics,
  getSimilarAzClassics,
  scoreAzClassicSimilarity,
  type AzClassicMovie,
} from "../src/api/azClassics";

function makeMovie(partial: Partial<AzClassicMovie> & { id: string }): AzClassicMovie {
  return {
    title: "Untitled",
    year: 1975,
    releaseDate: null,
    genres: [],
    runtimeMinutes: null,
    synopsis: null,
    posterPath: "/p.jpg",
    tmdbId: null,
    youtubeId: null,
    cast: [],
    crew: [],
    ...partial,
  };
}

describe("getAzClassicDisplayTitle", () => {
  it("prefers the Azerbaijani originalTitle when present", () => {
    const movie = makeMovie({ id: "az-x", title: "Nasimi", originalTitle: "Nəsimi" });
    assert.equal(getAzClassicDisplayTitle(movie), "Nəsimi");
  });

  it("falls back to English when originalTitle is absent or blank", () => {
    assert.equal(getAzClassicDisplayTitle(makeMovie({ id: "az-y", title: "Ulduz" })), "Ulduz");
    assert.equal(
      getAzClassicDisplayTitle(makeMovie({ id: "az-z", title: "Sevil", originalTitle: "   " })),
      "Sevil"
    );
  });
});

describe("scoreAzClassicSimilarity", () => {
  const director = { name: "Hüseyn Seyidzadə", role: "Director", department: "Directing", photoPath: null };
  const actor = { name: "Nodar Şaşıqoğlu", character: null, photoPath: null };

  it("scores a shared director far above a shared genre", () => {
    const source = makeMovie({ id: "a", genres: ["Drama"], crew: [director] });
    const sharedDirector = makeMovie({ id: "b", genres: ["War"], crew: [director] });
    const sharedGenre = makeMovie({ id: "c", genres: ["Drama"], crew: [] });
    assert.ok(
      scoreAzClassicSimilarity(source, sharedDirector) > scoreAzClassicSimilarity(source, sharedGenre)
    );
  });

  it("rewards shared lead cast", () => {
    const source = makeMovie({ id: "a", cast: [actor] });
    const shared = makeMovie({ id: "b", cast: [actor] });
    const none = makeMovie({ id: "c", cast: [] });
    assert.ok(scoreAzClassicSimilarity(source, shared) > scoreAzClassicSimilarity(source, none));
  });

  it("returns 0 for a film compared with itself", () => {
    const movie = makeMovie({ id: "a", genres: ["Drama"], crew: [director] });
    assert.equal(scoreAzClassicSimilarity(movie, movie), 0);
  });

  it("adds a same-era nudge for nearby release years", () => {
    const source = makeMovie({ id: "a", genres: ["Drama"], year: 1975 });
    const near = makeMovie({ id: "b", genres: ["Drama"], year: 1977 });
    const far = makeMovie({ id: "c", genres: ["Drama"], year: 1930 });
    assert.ok(scoreAzClassicSimilarity(source, near) > scoreAzClassicSimilarity(source, far));
  });
});

describe("getSimilarAzClassics (real catalog)", () => {
  const catalog = getAzClassics();
  const withSignal = catalog.find((m) => m.crew.some((c) => /director/i.test(c.role ?? "")) && m.genres.length > 0);

  it("returns only other real catalog films, never the source", () => {
    const source = withSignal ?? catalog[0];
    const similar = getSimilarAzClassics(source.id);
    const ids = new Set(catalog.map((m) => m.id));
    assert.ok(!similar.some((m) => m.id === source.id), "source must be excluded");
    assert.ok(similar.every((m) => ids.has(m.id)), "results must come from the AZ catalog");
    assert.ok(similar.length <= 12);
  });

  it("returns [] for an unknown id", () => {
    assert.deepEqual(getSimilarAzClassics("az-does-not-exist"), []);
  });
});
