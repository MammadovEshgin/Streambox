import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  azClassicToMediaItem,
  getAzClassicById,
  getAzClassicDisplayTitle,
  getAzClassics,
  getAzClassicsAsMediaItems,
} from "../src/api/azClassics";

const bareTmdbPath = /^\/[\w./-]+\.(jpg|jpeg|png|webp)$/i;

describe("azClassics catalog", () => {
  const catalog = getAzClassics();

  it("loads a non-empty catalog", () => {
    assert.ok(catalog.length > 100, `expected >100 films, got ${catalog.length}`);
  });

  it("every film has the required shape", () => {
    for (const film of catalog) {
      assert.equal(typeof film.id, "string");
      assert.ok(film.id.startsWith("az-"), `bad id ${film.id}`);
      assert.equal(typeof film.title, "string");
      assert.ok(film.title.length > 0);
      assert.ok(film.year === null || typeof film.year === "number");
      assert.ok(Array.isArray(film.genres));
      assert.ok(Array.isArray(film.cast));
      assert.ok(Array.isArray(film.crew));
      assert.ok(film.youtubeId === null || typeof film.youtubeId === "string");
    }
  });

  it("image paths are bare TMDB paths, never full URLs", () => {
    for (const film of catalog) {
      if (film.posterPath !== null) {
        assert.match(film.posterPath, bareTmdbPath, `poster ${film.id}: ${film.posterPath}`);
      }
      for (const person of [...film.cast, ...film.crew]) {
        if (person.photoPath !== null) {
          assert.match(person.photoPath, bareTmdbPath, `photo ${film.id}: ${person.photoPath}`);
        }
      }
    }
  });

  it("has no duplicate ids", () => {
    const ids = new Set(catalog.map((f) => f.id));
    assert.equal(ids.size, catalog.length);
  });

  it("never assigns the same YouTube video to two films", () => {
    const videos = catalog.map((f) => f.youtubeId).filter((v): v is string => Boolean(v));
    assert.equal(new Set(videos).size, videos.length);
  });

  it("has a healthy share of playable films", () => {
    const playable = catalog.filter((f) => f.youtubeId).length;
    assert.ok(playable / catalog.length > 0.7, `only ${playable}/${catalog.length} playable`);
  });
});

describe("getAzClassicById", () => {
  it("returns the matching film", () => {
    const first = getAzClassics()[0];
    assert.equal(getAzClassicById(first.id)?.title, first.title);
  });

  it("returns undefined for an unknown id", () => {
    assert.equal(getAzClassicById("az-does-not-exist"), undefined);
  });
});

describe("azClassicToMediaItem", () => {
  it("maps a film into the MediaItem shape", () => {
    const film = getAzClassics().find((f) => f.posterPath && f.year) ?? getAzClassics()[0];
    const item = azClassicToMediaItem(film);
    assert.equal(item.id, film.id);
    // Rails/cards display the native (Azerbaijani) name when available.
    assert.equal(item.title, getAzClassicDisplayTitle(film));
    assert.equal(item.mediaType, "movie");
    assert.equal(item.posterPath, film.posterPath);
    assert.equal(typeof item.year, "string");
    assert.equal(item.backdropPath, null);
  });

  it("maps the whole catalog without throwing", () => {
    const items = getAzClassicsAsMediaItems();
    assert.equal(items.length, getAzClassics().length);
  });
});
