import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyViewerPersona } from "../src/services/personaClassifier";

function entries(...genreLists: string[][]) {
  return genreLists.map((genres) => ({ genres }));
}

describe("personaClassifier", () => {
  it("assigns the persona of the most watched genre (English names)", () => {
    const result = classifyViewerPersona(
      entries(["Horror"], ["Horror", "Thriller"], ["Horror"], ["Action"])
    );
    assert.equal(result, "horrorFanatic");
  });

  it("classifies Turkish genre names identically (the silent-miss bug)", () => {
    const result = classifyViewerPersona(
      entries(["Korku"], ["Korku", "Gerilim"], ["Korku"], ["Aksiyon"])
    );
    assert.equal(result, "horrorFanatic");
  });

  it("matches TMDB TV genre names, which the old rules never covered", () => {
    const result = classifyViewerPersona(
      entries(["Bilim Kurgu & Fantazi"], ["Sci-Fi & Fantasy"], ["Dram"])
    );
    assert.equal(result, "dreamer");
  });

  it("drama-dominant history gets the Drama Devotee card in either language", () => {
    assert.equal(
      classifyViewerPersona(entries(["Drama"], ["Drama", "Romance"], ["Drama"])),
      "dramaDevotee"
    );
    assert.equal(
      classifyViewerPersona(entries(["Dram"], ["Dram", "Romantik"], ["Dram"])),
      "dramaDevotee"
    );
  });

  it("the most watched genre wins over less watched ones", () => {
    const result = classifyViewerPersona(
      entries(["Komedi"], ["Komedi"], ["Komedi"], ["Korku"], ["Korku"])
    );
    assert.equal(result, "laughHunter");
  });

  it("skips unmapped genre names and classifies from the next ranked genre", () => {
    const result = classifyViewerPersona(
      entries(["Anime"], ["Anime"], ["Anime"], ["Horror"], ["Horror"])
    );
    assert.equal(result, "horrorFanatic");
  });

  it("mixed-language history for the same genre still tops correctly", () => {
    const result = classifyViewerPersona(
      entries(["Crime"], ["Suç", "Gizem"], ["Mystery"], ["Drama"])
    );
    assert.equal(result, "detective");
  });

  it("falls back to the eclectic explorer with no genre data", () => {
    assert.equal(classifyViewerPersona([]), "eclecticExplorer");
    assert.equal(classifyViewerPersona(entries([], [""])), "eclecticExplorer");
  });
});
