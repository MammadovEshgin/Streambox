import assert from "node:assert/strict";
import test from "node:test";

import { decodeHtmlEntities } from "../src/utils/htmlEntities";

test("listing titles decode the entities HDFilm writes", () => {
  assert.equal(decodeHtmlEntities("L&eacute;on: The Professional"), "Léon: The Professional");
  assert.equal(decodeHtmlEntities("Harry Potter and the Philosopher&#039;s Stone"), "Harry Potter and the Philosopher's Stone");
  assert.equal(decodeHtmlEntities("Fast &amp; Furious 6"), "Fast & Furious 6");
  assert.equal(decodeHtmlEntities("A&ccedil;lık Oyunları"), "Açlık Oyunları");
  assert.equal(decodeHtmlEntities("&Ouml;l&uuml;ler &Uuml;lkesi"), "Ölüler Ülkesi");
  assert.equal(decodeHtmlEntities("Star Wars: Visions Presents &ndash; The Ninth Jedi"), "Star Wars: Visions Presents – The Ninth Jedi");
  assert.equal(decodeHtmlEntities("Alien&#xB3;"), "Alien³");
});

test("text that only looks like an entity is left alone", () => {
  assert.equal(decodeHtmlEntities("Tom & Jerry"), "Tom & Jerry");
  assert.equal(decodeHtmlEntities("&notanentity; stays"), "&notanentity; stays");
  // Decoded once: an escaped entity becomes the entity's text, not its character.
  assert.equal(decodeHtmlEntities("&amp;quot;"), "&quot;");
});
